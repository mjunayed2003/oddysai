import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { analyzeInputSchema, runMatchAnalysis } from "@/lib/ai-analysis.server";

const ALLOWED_ORIGINS = new Set([
  "https://oddysai.com",
  "https://www.oddysai.com",
  "https://bet-iq-ai-insights.lovable.app",
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const isDev = process.env.NODE_ENV !== "production";
  const allow = ALLOWED_ORIGINS.has(origin) || (isDev && /^http:\/\/localhost(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": allow ? origin : "https://oddysai.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin",
  };
}

const PAID_PLANS = ["basic", "pro", "elite"] as const;
const ACTIVE_STATUSES = ["active", "trialing"] as const;
const PAYMENTS_DISABLED_FOR_ANALYSIS = false;

// Hard safety cap even when payments are disabled — protects AI balance from abuse.
const FREE_HOURLY_CAP = 60;

// In-memory analysis cache (per Worker isolate). Keyed on match + odds snapshot.
// Live games change quickly → short TTL. Pre-match is stable → longer TTL.
type CacheEntry = { value: unknown; expiresAt: number };
const ANALYSIS_CACHE = new Map<string, CacheEntry>();
const LIVE_TTL_MS = 60 * 1000; // 60s for live
const PREMATCH_TTL_MS = 10 * 60 * 1000; // 10min for pre-match
const CACHE_MAX_ENTRIES = 500;

function cacheKey(input: { matchId: string; oddsHome?: number | null; oddsDraw?: number | null; oddsAway?: number | null }) {
  const round = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) : "");
  return `${input.matchId}|${round(input.oddsHome)}|${round(input.oddsDraw)}|${round(input.oddsAway)}`;
}

function getCached(key: string): unknown | null {
  const hit = ANALYSIS_CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    ANALYSIS_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: unknown, ttl: number) {
  if (ANALYSIS_CACHE.size >= CACHE_MAX_ENTRIES) {
    // simple FIFO eviction of oldest entry
    const firstKey = ANALYSIS_CACHE.keys().next().value;
    if (firstKey) ANALYSIS_CACHE.delete(firstKey);
  }
  ANALYSIS_CACHE.set(key, { value, expiresAt: Date.now() + ttl });
}

const json = (status: number, body: unknown, request: Request) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });

export const Route = createFileRoute("/api/analyze-match")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        // 1. Auth: Bearer token required
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return json(401, { error: "Missing bearer token" }, request);
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) return json(401, { error: "Missing bearer token" }, request);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json(500, { error: "Server is not configured" }, request);
        }

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return json(401, { error: "Invalid token" }, request);
        }
        const userId = claims.claims.sub;

        // 2. Subscription/unlock gate.
        if (!PAYMENTS_DISABLED_FOR_ANALYSIS) {
          // Per-match one-time unlock takes precedence.
          let hasUnlock = false;
          try {
            const body = await request.clone().json().catch(() => ({} as any));
            const matchId = String(body?.matchId ?? "");
            if (matchId) {
              const { count } = await supabase
                .from("analysis_unlocks")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq("match_id", matchId);
              hasUnlock = (count ?? 0) > 0;
            }
          } catch (e) {
            console.error("unlock lookup failed:", e);
          }
          if (!hasUnlock) {
            const { data: sub, error: subErr } = await supabase
              .from("subscriptions")
              .select("plan, status, current_period_end")
              .eq("user_id", userId)
              .maybeSingle();
            if (subErr) {
              console.error("subscription lookup failed:", subErr);
              return json(500, { error: "Subscription lookup failed" }, request);
            }
            const planOk = sub && PAID_PLANS.includes(sub.plan as typeof PAID_PLANS[number]);
            const statusOk = sub && ACTIVE_STATUSES.includes(sub.status as typeof ACTIVE_STATUSES[number]);
            const periodOk = !sub?.current_period_end || new Date(sub.current_period_end) > new Date();
            if (!planOk || !statusOk || !periodOk) {
              return json(402, {
                error: "Unlock this match for €5.99 to view the full AI analysis.",
                code: "unlock_required",
              }, request);
            }

            const HOURLY_LIMITS: Record<string, number> = { basic: 10, pro: 30, elite: 100 };
            const limit = HOURLY_LIMITS[sub!.plan as string] ?? 10;
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: quota, error: quotaErr } = await supabaseAdmin.rpc("consume_ai_quota", {
              _user_id: userId,
              _limit: limit,
            });
            if (quotaErr) {
              console.error("quota check failed:", quotaErr);
              return json(500, { error: "Quota check failed" }, request);
            }
            const quotaRow = Array.isArray(quota) ? quota[0] : quota;
            if (!quotaRow?.allowed) {
              return json(429, {
                error: "Hourly AI quota exceeded. Please try again later.",
                code: "rate_limited",
                used: quotaRow?.used,
                limit: quotaRow?.hourly_limit,
              }, request);
            }
          }
        }

        // 3. Validate input
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON body" }, request);
        }
        const parsed = analyzeInputSchema.safeParse(payload);
        if (!parsed.success) {
          return json(400, { error: "Invalid input", issues: parsed.error.issues }, request);
        }

        // 3.5. Cache hit? Skip AI call entirely (saves money on repeat analyses
        // of the same match — common when multiple users analyze hot fixtures
        // or one user retries quickly).
        const isLive = String(parsed.data.matchId).startsWith("af-");
        const ttl = isLive ? LIVE_TTL_MS : PREMATCH_TTL_MS;
        const key = cacheKey(parsed.data);
        const cached = getCached(key);
        if (cached) {
          return json(200, cached, request);
        }

        // 3.6. Safety hard cap (per user, per hour) even when payments are
        // disabled — protects AI balance from abuse / runaway scripts.
        if (PAYMENTS_DISABLED_FOR_ANALYSIS) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: quota } = await supabaseAdmin.rpc("consume_ai_quota", {
              _user_id: userId,
              _limit: FREE_HOURLY_CAP,
            });
            const quotaRow = Array.isArray(quota) ? quota[0] : quota;
            if (quotaRow && !quotaRow.allowed) {
              return json(429, {
                error: "Hourly analysis limit reached. Please try again later.",
                code: "rate_limited",
                used: quotaRow.used,
                limit: quotaRow.hourly_limit,
              }, request);
            }
          } catch (e) {
            // Fail open — never block analysis on a quota tracking error.
            console.error("safety quota check failed:", e);
          }
        }

        // 4. Run analysis
        try {
          const result = await runMatchAnalysis(parsed.data);
          setCached(key, result, ttl);
          return json(200, result, request);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Analysis failed";
          console.error("analyze-match error:", message);
          const unavailable = message.includes("not configured");
          return json(
            unavailable ? 503 : 500,
            {
              error: unavailable
                ? "Analysis service is temporarily unavailable. Please try again later."
                : "Analysis could not be completed. Please try again later.",
              code: "analysis_unavailable",
            },
            request,
          );
        }
      },
    },
  },
});
