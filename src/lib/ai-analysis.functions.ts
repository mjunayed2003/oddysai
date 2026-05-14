import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { analyzeInputSchema, runMatchAnalysis } from "./ai-analysis.server";
import type { AIAnalysisResult } from "./types";

const PAID_PLANS = ["basic", "pro", "elite"] as const;
const ACTIVE_STATUSES = ["active", "trialing"] as const;

// Per-plan hourly safety cap for paid users (abuse protection only).
// Effectively unlimited for normal usage.
const HOURLY_LIMITS: Record<string, number> = {
  basic: 200,
  pro: 500,
  elite: 1000,
};

// Free-tier daily preview budget (resets every day in UTC).
// Set to 0: every analysis now requires either an active paid subscription
// or a per-match one-time unlock. No free previews.
const FREE_PREVIEW_DAILY_LIMIT = 0;

// Payments are LIVE — analyses are gated by per-match one-time unlocks
// (€5.99 via Stripe). Subscription tiers are also accepted for legacy users.
const PAYMENTS_DISABLED_FOR_ANALYSIS = false;

// Cache TTL is now dynamic based on kickoff distance — see ttlForKickoff().
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANALYSIS_TIMEOUT_MS = 35_000;

// Phase 1: dynamic TTL based on time-to-kickoff. Live games change quickly,
// pre-match analyses are stable for hours.
function ttlMsForKickoff(kickoffIso: string): number {
  const t = Date.parse(kickoffIso);
  if (!Number.isFinite(t)) return 30 * 60 * 1000;
  const diffMs = t - Date.now();
  if (diffMs < 0) return 60 * 1000;                    // live or finished — 60s
  if (diffMs < 2 * 60 * 60 * 1000) return 30 * 60 * 1000; // <2h to KO — 30 min
  return 6 * 60 * 60 * 1000;                            // pre-match — 6h
}

// Phase 1: odds fingerprint — bucket each odd to 2 decimals so trivial
// rounding doesn't invalidate the cache, but real odds movement does.
function oddsFingerprint(input: { oddsHome?: number | null; oddsDraw?: number | null; oddsAway?: number | null }): string {
  const r = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n.toFixed(2) : "");
  return `${r(input.oddsHome)}|${r(input.oddsDraw)}|${r(input.oddsAway)}`;
}

// Phase 1: in-isolate single-flight map. Concurrent requests for the same
// match+odds wait on a single AI generation instead of N parallel ones.
const inFlight = new Map<string, Promise<AIAnalysisResult>>();

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function dayStartIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function countUsage(userId: string, kind: "ai_preview" | "ai_analysis", sinceIso: string) {
  const { count, error } = await supabaseAdmin
    .from("api_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", sinceIso);

  if (error) throw error;
  return count ?? 0;
}

async function recordUsage(userId: string, kind: "ai_preview" | "ai_analysis") {
  const { error } = await supabaseAdmin.from("api_usage").insert({ user_id: userId, kind, cost: 0 });
  if (error) console.error("usage record failed:", error);
}

type AnalysisRow = {
  match_id: string;
  summary: string;
  form_analysis: string | null;
  injuries_impact: string | null;
  motivation: string | null;
  h2h_summary: string | null;
  odds_movement: string | null;
  best_market: string;
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  confidence: number;
  risk: "low" | "medium" | "high";
  value_bet: boolean;
  suggested_stake_pct: number | null;
  suggested_stake_amount: number | null;
  reasoning: string | null;
};

function rowToResult(row: AnalysisRow & { created_at?: string }, bankroll = 0, maxStakePct = 5): AIAnalysisResult {
  const riskPctMap = { low: 1, medium: 2.5, high: 5 } as const;
  const suggestedStakePct = Math.min(maxStakePct, riskPctMap[row.risk]);
  const suggestedStakeAmount = bankroll > 0
    ? Math.round(bankroll * (suggestedStakePct / 100) * 100) / 100
    : Number(row.suggested_stake_amount ?? 0);

  return {
    matchId: row.match_id,
    summary: row.summary,
    formAnalysis: row.form_analysis ?? "",
    injuriesImpact: row.injuries_impact ?? "",
    motivation: row.motivation ?? "",
    h2hSummary: row.h2h_summary ?? "",
    oddsMovement: row.odds_movement ?? "",
    bestMarket: row.best_market,
    probHome: Number(row.prob_home ?? 0),
    probDraw: Number(row.prob_draw ?? 0),
    probAway: Number(row.prob_away ?? 0),
    confidence: row.confidence,
    risk: row.risk,
    valueBet: row.value_bet,
    suggestedStakePct,
    suggestedStakeAmount,
    reasoning: row.reasoning ?? "",
    warning:
      "AI analysis is informational only. Betting involves risk and no outcome is guaranteed. Never wager more than you can afford to lose. 18+ only.",
    cached: true,
    cachedAt: row.created_at,
  };
}

function rowIsUsable(row: AnalysisRow): boolean {
  const pSum = Number(row.prob_home) + Number(row.prob_draw) + Number(row.prob_away);
  return Number.isFinite(pSum)
    && pSum >= 95
    && pSum <= 105
    && Number(row.confidence) > 0
    && !!row.summary?.trim()
    && !!row.reasoning?.trim();
}

export const generateMatchAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => analyzeInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let sub: { plan: string; status: string; current_period_end: string | null } | null = null;
    let isPaidActive = true;
    let hasMatchUnlock = false;

    if (!PAYMENTS_DISABLED_FOR_ANALYSIS) {
      // Per-match one-time unlock takes precedence — if present, allow the
      // analysis without checking subscription state.
      const { count: unlockCount, error: unlockErr } = await supabase
        .from("analysis_unlocks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("match_id", data.matchId);
      if (unlockErr) {
        console.error("unlock lookup failed:", unlockErr);
      } else {
        hasMatchUnlock = (unlockCount ?? 0) > 0;
      }

      const { data: subscription, error } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("subscription lookup failed:", error);
        throw new Error("Subscription lookup failed");
      }

      sub = subscription;
      // Only the per-match one-time unlock grants analysis access.
      // Subscriptions do not unlock analyses — they're purchased per match.
      isPaidActive = hasMatchUnlock;
    }

    const matchIsUuid = UUID_RE.test(data.matchId);
    const oddsFp = oddsFingerprint(data);
    const ttlMs = ttlMsForKickoff(data.kickoff);

    // 1) Quota gating BEFORE cache lookup — with the shared cache, unpaid
    // users could otherwise fetch cached premium analyses indefinitely and
    // bypass their free daily preview budget.
    if (!PAYMENTS_DISABLED_FOR_ANALYSIS && !isPaidActive) {
      try {
        const used = await countUsage(userId, "ai_preview", dayStartIso());
        if (used >= FREE_PREVIEW_DAILY_LIMIT) {
          const err = new Error(
            `You've used your ${FREE_PREVIEW_DAILY_LIMIT} free AI analyses for today. Unlock this match to continue.`,
          );
          (err as Error & { code?: string }).code = "upgrade_required";
          throw err;
        }
      } catch (err) {
        if (err instanceof Error && (err as Error & { code?: string }).code === "upgrade_required") throw err;
        console.error("free preview check failed:", err);
        throw new Error("Quota check failed");
      }
    }

    // 2) Cache: shared across ALL users. Match an analysis with the same
    // odds fingerprint that hasn't expired yet (or, for legacy rows without
    // expires_at, fall back to created_at + dynamic TTL).
    if (matchIsUuid) {
      const cutoffIso = new Date(Date.now() - ttlMs).toISOString();
      // SECURITY: read cache via service-role client. The `analyses` table is
      // owner-locked at the RLS layer so the user-scoped client can only see
      // its own rows; the shared cache must therefore be read server-side.
      const { data: cached, error: cacheError } = await supabaseAdmin
        .from("analyses")
        .select(
          "match_id, summary, form_analysis, injuries_impact, motivation, h2h_summary, odds_movement, best_market, prob_home, prob_draw, prob_away, confidence, risk, value_bet, suggested_stake_pct, suggested_stake_amount, reasoning, created_at, expires_at, odds_fingerprint",
        )
        .eq("match_id", data.matchId)
        .or(`expires_at.gt.${new Date().toISOString()},and(expires_at.is.null,created_at.gte.${cutoffIso})`)
        .order("created_at", { ascending: false })
        .limit(5);

      if (cacheError) {
        console.error("cache lookup failed:", cacheError);
      } else if (cached?.length) {
        const exactMatch = cached.find((r) => (r as { odds_fingerprint?: string | null }).odds_fingerprint === oddsFp);
        const fallbackMatch = !oddsFp.replace(/[|]/g, "") ? cached[0] : undefined;
        const hit = exactMatch ?? fallbackMatch;
        if (hit && rowIsUsable(hit as AnalysisRow)) {
          // Cache hit still consumes the free-preview budget so unpaid users
          // can't bypass the daily limit by re-requesting popular matches.
          if (!PAYMENTS_DISABLED_FOR_ANALYSIS && !isPaidActive) {
            await recordUsage(userId, "ai_preview");
          }
          return rowToResult(hit as AnalysisRow, data.bankroll ?? 0, data.maxStakePct ?? 5);
        }
      }
    }

    // 3) Paid hourly cap (abuse protection only).
    if (!PAYMENTS_DISABLED_FOR_ANALYSIS && isPaidActive) {
      const planKey = sub?.plan ?? (hasMatchUnlock ? "unlock" : "");
      const limit = HOURLY_LIMITS[planKey as string] ?? (hasMatchUnlock ? 100 : 10);
      try {
        const used = await countUsage(userId, "ai_analysis", new Date(Date.now() - 60 * 60 * 1000).toISOString());
        if (used >= limit) {
          const err = new Error(`Hourly AI analysis limit reached (${limit}/hour). Try again later.`);
          (err as Error & { code?: string }).code = "rate_limited";
          throw err;
        }
      } catch (err) {
        if (err instanceof Error && (err as Error & { code?: string }).code === "rate_limited") throw err;
        console.error("rate-limit check failed:", err);
        throw new Error("Rate-limit check failed");
      }
    }

    // 3) Single-flight: dedupe concurrent generations for the same match+odds.
    // The first request runs the AI, all others await the same Promise.
    const inflightKey = `${data.matchId}|${oddsFp}`;
    const existing = inFlight.get(inflightKey);
    let result: AIAnalysisResult;
    if (existing) {
      result = await existing;
    } else {
      const p = withTimeout(
        runMatchAnalysis(data),
        ANALYSIS_TIMEOUT_MS,
        "Not enough data available: backend analysis timed out",
      );
      inFlight.set(inflightKey, p);
      try {
        result = await p;
      } finally {
        inFlight.delete(inflightKey);
      }
    }

    if (!PAYMENTS_DISABLED_FOR_ANALYSIS && !result.fallback) {
      if (isPaidActive) {
        await recordUsage(userId, "ai_analysis");
      } else {
        await recordUsage(userId, "ai_preview");
      }
    }

    // Persist analysis (best-effort) with cache metadata + dynamic expiry.
    if (matchIsUuid && !result.fallback) {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      // SECURITY: write via service-role so owner-locked RLS can't drop the
      // shared-cache row (and so we don't depend on the user's INSERT policy).
      const { error: insertError } = await supabaseAdmin.from("analyses").insert({
        match_id: result.matchId,
        user_id: userId,
        summary: result.summary,
        form_analysis: result.formAnalysis,
        injuries_impact: result.injuriesImpact,
        motivation: result.motivation,
        h2h_summary: result.h2hSummary,
        odds_movement: result.oddsMovement,
        best_market: result.bestMarket,
        prob_home: result.probHome,
        prob_draw: result.probDraw,
        prob_away: result.probAway,
        confidence: result.confidence,
        risk: result.risk,
        value_bet: result.valueBet,
        suggested_stake_pct: result.suggestedStakePct,
        suggested_stake_amount: result.suggestedStakeAmount,
        reasoning: result.reasoning,
        odds_fingerprint: oddsFp,
        expires_at: expiresAt,
      });
      if (insertError) {
        console.error("Failed to save analysis:", insertError);
      }
    } else if (!matchIsUuid) {
      console.warn("Skipping analysis save: matchId is not a UUID", result.matchId);
    }

    return result;
  });

