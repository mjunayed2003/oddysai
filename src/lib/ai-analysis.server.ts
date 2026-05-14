import { z } from "zod";
import type { AIAnalysisResult } from "./types";
import { getSportMonksH2H, getSportMonksOdds, getSportMonksFixtureContext } from "./sportmonks.server";
import { aiRouter } from "./ai/router";
import { AIProviderError } from "./ai/types";

const AF_BASE = "https://v3.football.api-sports.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

const FALLBACK_WARNING =
  "AI analysis is informational only. Betting involves risk and no outcome is guaranteed. Never wager more than you can afford to lose. 18+ only.";

export const analyzeInputSchema = z.object({
  matchId: z.string().min(1).max(120),
  homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120),
  league: z.string().min(1).max(120),
  kickoff: z.string().min(1).max(64),
  oddsHome: z.number().nullable().optional(),
  oddsDraw: z.number().nullable().optional(),
  oddsAway: z.number().nullable().optional(),
  bankroll: z.number().min(0).max(10_000_000).optional(),
  maxStakePct: z.number().min(0.1).max(25).optional(),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

async function af<T>(path: string, params: Record<string, string | number>): Promise<T | null> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return null;
  const url = new URL(`${AF_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "x-apisports-key": key }, signal: ctrl.signal });
    if (!res.ok) {
      console.error(`API-Football ${path} ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { response: T };
    return json.response;
  } catch (err) {
    console.error(`API-Football ${path} threw`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface TeamSearchHit { team: { id: number; name: string } }
interface AFFixtureSummary {
  fixture: { id: number; date: string; venue?: { id?: number | null; name?: string | null; city?: string | null } };
  league: { name: string; id?: number; season?: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}
interface AFStandingRow {
  rank: number;
  team: { id: number; name: string };
  points: number;
  goalsDiff: number;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  form?: string;
}
interface AFTeamStats {
  fixtures?: {
    played?: { home?: number; away?: number; total?: number };
    wins?: { home?: number; away?: number; total?: number };
    draws?: { home?: number; away?: number; total?: number };
    loses?: { home?: number; away?: number; total?: number };
  };
  goals?: {
    for?: { total?: { home?: number; away?: number; total?: number }; average?: { home?: string; away?: string; total?: string } };
    against?: { total?: { home?: number; away?: number; total?: number }; average?: { home?: string; away?: string; total?: string } };
  };
}

interface AFLineupRow {
  team: { id: number; name: string };
  formation?: string | null;
  startXI?: Array<{ player?: { id?: number; name?: string; pos?: string } }>;
}

type AFOddsRow = {
  fixture: { id: number };
  bookmakers: Array<{
    bets: Array<{ id?: number; name: string; values: Array<{ value: string; odd: string }> }>;
  }>;
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(women|woman|w|fc|cf|sc|ac|club|de|da|do|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function fuzzyNameMatch(a: string, b: string) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

async function findTeamId(name: string): Promise<number | null> {
  const r = await af<TeamSearchHit[]>("/teams", { search: name.slice(0, 20) });
  if (!r?.length) return null;
  const want = normalizeName(name);
  const exact = r.find((t) => normalizeName(t.team.name) === want);
  const fuzzy = r.find((t) => fuzzyNameMatch(t.team.name, name));
  return (exact ?? fuzzy ?? r[0]).team.id;
}

function apiFootballFixtureId(matchId: string): number | null {
  const raw = matchId.startsWith("af-") ? matchId.slice(3) : "";
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getFixtureById(matchId: string): Promise<AFFixtureSummary | null> {
  const fixtureId = apiFootballFixtureId(matchId);
  if (!fixtureId) return null;
  const r = await af<AFFixtureSummary[]>("/fixtures", { id: fixtureId });
  return r?.[0] ?? null;
}

function summarizeFormDetailed(matches: AFFixtureSummary[], teamId: number) {
  const sliced = matches.slice(0, 5);
  const rows = sliced.map((m) => {
    const isHome = m.teams.home.id === teamId;
    const us = isHome ? m.goals.home : m.goals.away;
    const them = isHome ? m.goals.away : m.goals.home;
    const opp = isHome ? m.teams.away.name : m.teams.home.name;
    const result = us == null || them == null ? "?" : us > them ? "W" : us < them ? "L" : "D";
    return { result, score: `${us ?? "-"}-${them ?? "-"}`, opp, venue: isHome ? "H" : "A", us, them };
  });
  const wins = rows.filter((r) => r.result === "W").length;
  const draws = rows.filter((r) => r.result === "D").length;
  const losses = rows.filter((r) => r.result === "L").length;
  const goalsFor = rows.reduce((s, r) => s + (r.us ?? 0), 0);
  const goalsAgainst = rows.reduce((s, r) => s + (r.them ?? 0), 0);
  return {
    last5: rows.map((r) => ({ result: r.result, score: r.score, opp: r.opp, venue: r.venue })),
    record: `${wins}W-${draws}D-${losses}L`,
    goalsFor,
    goalsAgainst,
    goalsForAvg: rows.length ? Math.round((goalsFor / rows.length) * 100) / 100 : null,
    goalsAgainstAvg: rows.length ? Math.round((goalsAgainst / rows.length) * 100) / 100 : null,
  };
}

function sportKeysForLeague(league?: string) {
  const l = (league ?? "").toLowerCase();
  if (/premier league|england/.test(l)) return ["soccer_epl"];
  if (/la liga|spain/.test(l)) return ["soccer_spain_la_liga"];
  if (/serie a|italy/.test(l)) return ["soccer_italy_serie_a"];
  if (/bundesliga|germany/.test(l)) return ["soccer_germany_bundesliga"];
  if (/ligue 1|france/.test(l)) return ["soccer_france_ligue_one"];
  if (/champions league|uefa/.test(l)) return ["soccer_uefa_champs_league"];
  return [];
}

const MATCH_WINNER_BET_ALIASES = new Set([
  "match winner",
  "1x2",
  "full time result",
  "fulltime result",
  "match result",
  "match odds",
  "winner",
  "result",
  "ft 1x2",
]);

function normalizeMarketText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMatchWinnerBet(bet: { id?: number; name?: string }) {
  const name = normalizeMarketText(bet.name ?? "");
  return bet.id === 1 || MATCH_WINNER_BET_ALIASES.has(name) || name.includes("match winner") || name.includes("1x2");
}

function extractApiFootballOdds(row?: AFOddsRow | null) {
  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;
  for (const bm of row?.bookmakers ?? []) {
    for (const bet of bm.bets ?? []) {
      if (!isMatchWinnerBet(bet)) continue;
      for (const v of bet.values ?? []) {
        const label = normalizeMarketText(v.value ?? "");
        const odd = Number(v.odd);
        if (!Number.isFinite(odd) || odd <= 1) continue;
        if (home == null && ["home", "1", "home team"].includes(label)) home = odd;
        else if (draw == null && ["draw", "x", "tie"].includes(label)) draw = odd;
        else if (away == null && ["away", "2", "away team"].includes(label)) away = odd;
      }
    }
  }
  return { home, draw, away };
}

async function gatherOddsSnapshot(home: string, away: string, league?: string) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;
  const sportKeys = sportKeysForLeague(league);
  if (!sportKeys.length) return null;
  for (const sk of sportKeys) {
    const u = new URL(`${ODDS_BASE}/sports/${sk}/odds`);
    u.searchParams.set("apiKey", key);
    u.searchParams.set("regions", "eu,uk");
    u.searchParams.set("markets", "h2h");
    u.searchParams.set("oddsFormat", "decimal");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    let events: Array<{
      home_team: string; away_team: string;
      bookmakers: Array<{ title: string; last_update: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }> }>;
    }> = [];
    try {
      const res = await fetch(u, { signal: ctrl.signal });
      if (!res.ok) continue;
      events = await res.json();
    } catch (err) {
      console.error(`Odds snapshot ${sk} failed`, err instanceof Error ? err.message : err);
      continue;
    } finally {
      clearTimeout(timer);
    }
    const match = events.find(
      (e) =>
        (fuzzyNameMatch(e.home_team, home) && fuzzyNameMatch(e.away_team, away)) ||
        (fuzzyNameMatch(e.home_team, away) && fuzzyNameMatch(e.away_team, home)),
    );
    if (!match) continue;
    const books = (match.bookmakers ?? []).slice(0, 6).map((b) => {
      const m = b.markets.find((x) => x.key === "h2h");
      const get = (n: string) => m?.outcomes.find((o) => fuzzyNameMatch(o.name, n))?.price ?? 0;
      return { book: b.title, home: get(match.home_team), draw: m?.outcomes.find((o) => normalizeName(o.name) === "draw")?.price ?? 0, away: get(match.away_team) };
    });
    if (!books.length) continue;
    const avg = (k: "home" | "draw" | "away") => books.reduce((s, b) => s + (b[k] || 0), 0) / books.length;
    return { books, avg: { home: avg("home"), draw: avg("draw"), away: avg("away") } };
  }
  return null;
}

// JSON schema mirrors the UI fields rendered by the analyzer page.
const analysisSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 40, maxLength: 600, description: "Match Overview: 2-3 sentence neutral overview." },
    formAnalysis: { type: "string", minLength: 30, maxLength: 600, description: "Recent form for both teams. Reference W/D/L letters and scorelines." },
    homeAwayAnalysis: { type: "string", minLength: 20, maxLength: 500, description: "Home vs away performance trends. Note venue advantage if visible in data." },
    tacticalAngle: { type: "string", minLength: 20, maxLength: 500, description: "Tactical / playing style angle. Press, possession, transitions, set pieces." },
    motivation: { type: "string", minLength: 20, maxLength: 500, description: "League standings, cup stakes, derby context, manager pressure." },
    h2hSummary: { type: "string", minLength: 20, maxLength: 500, description: "Head-to-head pattern from recent meetings." },
    injuriesImpact: { type: "string", minLength: 20, maxLength: 500, description: "Notable injuries / suspensions and their tactical impact. Say 'Not enough data available.' if absent." },
    oddsMovement: { type: "string", minLength: 20, maxLength: 500, description: "Bookmaker spread, consensus, sharp signals. Reference snapshot if available." },
    bestMarket: { type: "string", enum: ["home", "draw", "away"], description: "Single highest-value 1X2 pick." },
    suggestedMarkets: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      description: "Concrete market suggestions with reasoning. Each must reference data points (form, odds, goals, standings, etc.). Skip markets you cannot justify.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["market", "reason", "risk", "confidence"],
        properties: {
          market: { type: "string", maxLength: 80, description: "Market name e.g. 'Over 2.5 Goals', 'BTTS Yes', 'Home -1 Asian'." },
          reason: { type: "string", minLength: 30, maxLength: 280, description: "Concrete justification referencing the data (avg goals, form record, standings, H2H scoreline, odds value)." },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "number", minimum: 1, maximum: 99 },
        },
      },
    },
    missingData: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      description: "List of data sources that were unavailable for this analysis (e.g. 'Standings', 'Head-to-head history', 'Injury reports', 'Bookmaker odds snapshot'). Be specific.",
      items: { type: "string", maxLength: 80 },
    },
    probHome: { type: "number", minimum: 1, maximum: 95 },
    probDraw: { type: "number", minimum: 1, maximum: 60 },
    probAway: { type: "number", minimum: 1, maximum: 95 },
    confidence: { type: "number", minimum: 1, maximum: 99, description: "Model confidence in bestMarket (0-100)." },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    valueBet: { type: "boolean", description: "True only when fair odds (100/prob) imply >5% edge." },
    valueSignal: { type: "string", enum: ["none", "low", "moderate", "strong"], description: "Strength of edge vs market." },
    suggestedStakePct: { type: "number", minimum: 0.5, maximum: 25 },
    dataQuality: { type: "string", enum: ["low", "medium", "high"], description: "low if most enrichment fields empty, high if form+H2H+injuries+odds all present." },
    reasoning: { type: "string", minLength: 60, maxLength: 800, description: "Explain edge calculation and stake size. Cite numbers from the data. No guarantees." },
    responsibleNote: { type: "string", minLength: 20, maxLength: 280, description: "Short responsible-gambling reminder, no guarantees." },
  },
  required: ["summary", "formAnalysis", "homeAwayAnalysis", "tacticalAngle", "injuriesImpact", "motivation", "h2hSummary", "oddsMovement", "bestMarket", "suggestedMarkets", "missingData", "probHome", "probDraw", "probAway", "confidence", "risk", "valueBet", "valueSignal", "suggestedStakePct", "dataQuality", "reasoning", "responsibleNote"],
  additionalProperties: false,
} as const;


function failAnalysis(reason: string): never {
  console.error(`AI analysis unavailable: ${reason}`);
  throw new Error(`Not enough data for reliable prediction: ${reason}`);
}

function extractJsonObject(raw: string): unknown {
  if (!raw || typeof raw !== "string") throw new Error("empty AI response");
  let cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // Repair attempts for common AI JSON glitches
    let repaired = cleaned
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    // Balance braces / brackets if truncated
    const openB = (repaired.match(/{/g) ?? []).length;
    const closeB = (repaired.match(/}/g) ?? []).length;
    const openS = (repaired.match(/\[/g) ?? []).length;
    const closeS = (repaired.match(/]/g) ?? []).length;
    if (closeS < openS) repaired += "]".repeat(openS - closeS);
    if (closeB < openB) repaired += "}".repeat(openB - closeB);
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstErr instanceof Error ? firstErr : new Error("JSON parse failed");
    }
  }
}

function safeFallbackAnalysis(data: AnalyzeInput, reason: string, missing: string[] = []): AIAnalysisResult {
  console.warn("safeFallbackAnalysis used:", reason);
  // Prefer market-derived numbers when bookmaker odds are present.
  const h = Number(data.oddsHome) > 1 ? Number(data.oddsHome) : null;
  const d = Number(data.oddsDraw) > 1 ? Number(data.oddsDraw) : null;
  const a = Number(data.oddsAway) > 1 ? Number(data.oddsAway) : null;
  let probHome = 33.34, probDraw = 33.33, probAway = 33.33;
  let bestKey: "home" | "draw" | "away" = "draw";
  if (h && d && a) {
    const inv = 1 / h + 1 / d + 1 / a;
    probHome = Math.round((1 / h / inv) * 10000) / 100;
    probDraw = Math.round((1 / d / inv) * 10000) / 100;
    probAway = Math.round((100 - probHome - probDraw) * 100) / 100;
    bestKey = probHome >= probDraw && probHome >= probAway ? "home" : probAway >= probDraw ? "away" : "draw";
  }
  const labelMap = { home: `${data.homeTeam} Win`, draw: "Draw", away: `${data.awayTeam} Win` } as const;
  return {
    matchId: data.matchId,
    summary: "Analysis could not be fully generated from available data.",
    formAnalysis: "Not enough data available.",
    homeAwayAnalysis: "Not enough data available.",
    tacticalAngle: "Not enough data available.",
    injuriesImpact: "Not enough data available.",
    motivation: "Not enough data available.",
    h2hSummary: "Not enough data available.",
    oddsMovement: (h || d || a)
      ? `Bookmaker odds: home ${h ? h.toFixed(2) : "n/a"}, draw ${d ? d.toFixed(2) : "n/a"}, away ${a ? a.toFixed(2) : "n/a"}.`
      : "Not enough data available.",
    bestMarket: labelMap[bestKey],
    probHome,
    probDraw,
    probAway,
    confidence: 50,
    risk: "medium",
    valueBet: false,
    valueSignal: "none",
    suggestedStakePct: 1,
    suggestedStakeAmount: data.bankroll ? Math.round(data.bankroll * 0.01 * 100) / 100 : 0,
    reasoning: `Fallback analysis used: ${reason}. The AI response could not be safely interpreted, so a conservative baseline is shown instead.`,
    warning: FALLBACK_WARNING,
    suggestedMarkets: [],
    suggestedMarketsDetailed: [],
    missingData: missing,
    responsibleNote: "Bet responsibly. No outcome is guaranteed.",
    dataQuality: "low",
    fallback: true,
  };
}

function hasUsableAnalysisFields(value: Partial<AIAnalysisResult> | null | undefined): boolean {
  if (!value) return false;
  const pSum = Number(value.probHome) + Number(value.probDraw) + Number(value.probAway);
  const requiredText = [
    value.summary,
    value.formAnalysis,
    value.injuriesImpact,
    value.motivation,
    value.h2hSummary,
    value.oddsMovement,
    value.reasoning,
  ];
  return Number.isFinite(pSum)
    && pSum >= 95
    && pSum <= 105
    && (value.bestMarket === "home" || value.bestMarket === "draw" || value.bestMarket === "away")
    && Number.isFinite(Number(value.confidence))
    && Number(value.confidence) > 0
    && requiredText.every((field) => typeof field === "string" && field.trim().length >= 10);
}

function marketFallbackAnalysis(data: AnalyzeInput, reason: string): AIAnalysisResult {
  const h = Number(data.oddsHome) > 1 ? Number(data.oddsHome) : null;
  const d = Number(data.oddsDraw) > 1 ? Number(data.oddsDraw) : null;
  const a = Number(data.oddsAway) > 1 ? Number(data.oddsAway) : null;
  if (!h || !d || !a) failAnalysis(reason);
  const invH = 1 / h;
  const invD = 1 / d;
  const invA = 1 / a;
  const total = invH + invD + invA;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const probHome = round2((invH / total) * 100);
  const probDraw = round2((invD / total) * 100);
  const probAway = round2(100 - probHome - probDraw);
  const entries = [{ key: "home" as const, p: probHome }, { key: "draw" as const, p: probDraw }, { key: "away" as const, p: probAway }].sort((x, y) => y.p - x.p);
  const best = entries[0].key;
  const confidence = Math.max(45, Math.min(72, Math.round(entries[0].p + 18)));
  const risk: AIAnalysisResult["risk"] = confidence >= 60 ? "medium" : "high";
  const stakePct = Math.min(data.maxStakePct ?? 5, risk === "medium" ? 2.5 : 1);
  const stakeAmount = data.bankroll ? round2(data.bankroll * (stakePct / 100)) : 0;
  const bestMarket = best === "home" ? `${data.homeTeam} Win` : best === "away" ? `${data.awayTeam} Win` : "Draw";
  return {
    matchId: data.matchId,
    summary: `${data.homeTeam} vs ${data.awayTeam} has real fixture and odds data available. Full team-form feeds were incomplete, so this is a conservative market-implied baseline rather than a high-confidence model edge.`,
    formAnalysis: "Recent form data is not complete from the sports provider for this fixture, so the prediction does not over-weight unavailable form signals.",
    injuriesImpact: "Injury data is unavailable or incomplete for this fixture; no injury advantage is assumed for either side.",
    motivation: `The match is listed in ${data.league}; motivation is treated as neutral unless standings or team-news data becomes available.`,
    h2hSummary: "Head-to-head data is unavailable or incomplete, so no H2H trend is used in the final probability split.",
    oddsMovement: `Bookmaker odds are available: home ${h.toFixed(2)}, draw ${d.toFixed(2)}, away ${a.toFixed(2)}. Probabilities are normalized from this real market snapshot.`,
    bestMarket,
    probHome,
    probDraw,
    probAway,
    confidence,
    risk,
    valueBet: false,
    suggestedStakePct: round2(stakePct),
    suggestedStakeAmount: stakeAmount,
    reasoning: `Fallback reason: ${reason}. With partial provider data, the safest output is a market-implied baseline, not a claimed value bet. Stake is kept small because form, injuries, H2H and standings are incomplete.`,
    warning: FALLBACK_WARNING,
    dataQuality: "medium",
    fallback: false,
  };
}


/**
 * Verified-data eligibility check for paid unlocks. Mirrors the signal floor
 * used inside runMatchAnalysisInner so the checkout refuses to sell premium
 * analysis for matches where we'd have to hallucinate H2H or form.
 */
export async function checkMatchUnlockEligibility(
  matchId: string,
): Promise<{ eligible: boolean; reason?: string; missing?: string[] }> {
  const fixtureId = apiFootballFixtureId(matchId);
  if (!process.env.API_FOOTBALL_KEY || !fixtureId) {
    return { eligible: false, reason: "Verified provider data is not available for this fixture" };
  }
  const fixture = await getFixtureById(matchId);
  const homeId = fixture?.teams.home.id ?? null;
  const awayId = fixture?.teams.away.id ?? null;
  if (!homeId || !awayId) {
    return { eligible: false, reason: "Team identifiers are not verified for this fixture" };
  }
  const [homeRecent, awayRecent, h2h] = await Promise.all([
    af<AFFixtureSummary[]>("/fixtures", { team: homeId, last: 5 }),
    af<AFFixtureSummary[]>("/fixtures", { team: awayId, last: 5 }),
    af<AFFixtureSummary[]>("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 5 }),
  ]);
  const missing: string[] = [];
  const hasForm = !!(homeRecent?.length && awayRecent?.length);
  const verifiedH2H = (h2h ?? []).filter(
    (m) => m.goals.home != null && m.goals.away != null,
  );
  if (!hasForm) missing.push("Recent form");
  if (verifiedH2H.length === 0) missing.push("Verified head-to-head history");
  // Require BOTH verified recent form AND at least one verified historical H2H.
  if (!hasForm || verifiedH2H.length === 0) {
    return {
      eligible: false,
      reason: `missing ${missing.join(" and ")}`,
      missing,
    };
  }
  return { eligible: true };
}

export async function runMatchAnalysis(data: AnalyzeInput): Promise<AIAnalysisResult> {
  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  const log = (m: string) => console.log(`[analyze ${reqId}] ${m}`);
  log(`start fixture=${data.matchId} ${data.homeTeam} vs ${data.awayTeam} league="${data.league}"`);
  try {
    return await runMatchAnalysisInner(data, reqId, log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`UNCAUGHT ${msg} (${Date.now() - t0}ms) — returning safe fallback`);
    return safeFallbackAnalysis(data, msg);
  }
}

async function runMatchAnalysisInner(
  data: AnalyzeInput,
  reqId: string,
  log: (m: string) => void,
): Promise<AIAnalysisResult> {
  // Provider availability is checked via the AI router; if no provider is
  // configured we fall back to a market-only analysis.
  const aiAvailable = !!(process.env.LOVABLE_API_KEY || process.env.OPENAI_API_KEY);
  if (!aiAvailable) {
    log("AI provider not configured — returning safe fallback");
    return safeFallbackAnalysis(data, "AI provider not configured");
  }

  const hasInputOdds = Number(data.oddsHome) > 1 && Number(data.oddsDraw) > 1 && Number(data.oddsAway) > 1;
  const fixtureId = apiFootballFixtureId(data.matchId);
  const canDeepEnrich = !!process.env.API_FOOTBALL_KEY && !!fixtureId;
  log(`hasInputOdds=${hasInputOdds} fixtureId=${fixtureId} canDeepEnrich=${canDeepEnrich}`);

  // Only short-circuit to the market-implied fallback when we cannot enrich
  // the prediction with provider data (no API-Football key or no af- fixture id).
  // When we DO have a valid fixture id + provider key, run the full deep path
  // even if bookmaker odds are already in the input — the AI will use the odds
  // as additional context alongside form/H2H/injuries/snapshot.
  if (hasInputOdds && !canDeepEnrich) {
    return marketFallbackAnalysis(data, "instant real-odds prediction (no provider enrichment available)");
  }

  const tFixture = Date.now();
  const exactFixture = fixtureId ? await getFixtureById(data.matchId) : null;
  log(`fixture lookup ${exactFixture ? "ok" : "miss"} in ${Date.now() - tFixture}ms`);
  if (fixtureId && !exactFixture && hasInputOdds) {
    log("exact fixture lookup failed; continuing with selected payload + odds");
  }
  const tProviders = Date.now();
  const [homeId, awayId, oddsSnap] = await Promise.all([
    exactFixture?.teams.home.id ? Promise.resolve(exactFixture.teams.home.id) : findTeamId(data.homeTeam),
    exactFixture?.teams.away.id ? Promise.resolve(exactFixture.teams.away.id) : findTeamId(data.awayTeam),
    gatherOddsSnapshot(data.homeTeam, data.awayTeam, data.league),
  ]);
  log(`team-id+odds-snapshot in ${Date.now() - tProviders}ms (homeId=${homeId} awayId=${awayId} oddsSnap=${!!oddsSnap})`);

  if (!homeId || !awayId) {
    log("team data unavailable — returning market fallback");
    return marketFallbackAnalysis(data, "team data unavailable from sports API");
  }

  const leagueId = exactFixture?.league?.id;
  const leagueSeason = exactFixture?.league?.season;

  const [homeRecent, awayRecent, h2h, injuries, awayInjuries, standings, homeTeamStats, awayTeamStats, lineups, apiOdds] = await Promise.all([
    homeId ? af<AFFixtureSummary[]>("/fixtures", { team: homeId, last: 5 }) : Promise.resolve(null),
    awayId ? af<AFFixtureSummary[]>("/fixtures", { team: awayId, last: 5 }) : Promise.resolve(null),
    homeId && awayId ? af<AFFixtureSummary[]>("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 5 }) : Promise.resolve(null),
    homeId && leagueSeason
      ? af<Array<{ player: { name: string }; team: { name: string } }>>("/injuries", { team: homeId, season: leagueSeason })
      : Promise.resolve(null),
    awayId && leagueSeason
      ? af<Array<{ player: { name: string }; team: { name: string } }>>("/injuries", { team: awayId, season: leagueSeason })
      : Promise.resolve(null),
    leagueId && leagueSeason
      ? af<Array<{ league: { standings: AFStandingRow[][] } }>>("/standings", { league: leagueId, season: leagueSeason })
      : Promise.resolve(null),
    leagueId && leagueSeason && homeId
      ? af<AFTeamStats>("/teams/statistics", { team: homeId, league: leagueId, season: leagueSeason })
      : Promise.resolve(null),
    leagueId && leagueSeason && awayId
      ? af<AFTeamStats>("/teams/statistics", { team: awayId, league: leagueId, season: leagueSeason })
      : Promise.resolve(null),
    fixtureId ? af<AFLineupRow[]>("/fixtures/lineups", { fixture: fixtureId }) : Promise.resolve(null),
    fixtureId ? af<AFOddsRow[]>("/odds", { fixture: fixtureId, bet: 1 }) : Promise.resolve(null),
  ]);
  log(`provider data fetched: form=${!!homeRecent?.length && !!awayRecent?.length} h2h=${h2h?.length ?? 0} injuries=${(injuries?.length ?? 0) + (awayInjuries?.length ?? 0)} standings=${!!standings} stats=${!!homeTeamStats || !!awayTeamStats} lineups=${lineups?.length ?? 0} oddsRows=${apiOdds?.length ?? 0}`);

  // Neutral-venue detection. Some cup competitions (Copa Argentina, finals,
  // super cups) are played at neutral grounds — in those cases we must NOT
  // apply home-advantage logic. Detect via league name heuristic.
  const leagueLower = (data.league ?? "").toLowerCase();
  const neutralVenue = /(copa argentina|copa do brasil final|libertadores final|sudamericana final|fa cup final|coppa italia final|community shield|super ?cup|supercopa|uefa super cup|trophée des champions|dfl-?supercup|carabao cup final)/.test(leagueLower);

  const flatStandings = standings?.[0]?.league?.standings?.flat() ?? [];
  const findStanding = (id: number) => flatStandings.find((row) => row.team.id === id) ?? null;
  const homeStanding = homeId ? findStanding(homeId) : null;
  const awayStanding = awayId ? findStanding(awayId) : null;

  const venueSplit = (stats: AFTeamStats | null, side: "home" | "away") => {
    if (!stats?.fixtures) return null;
    return {
      played: stats.fixtures.played?.[side] ?? null,
      wins: stats.fixtures.wins?.[side] ?? null,
      draws: stats.fixtures.draws?.[side] ?? null,
      losses: stats.fixtures.loses?.[side] ?? null,
      goalsForAvg: stats.goals?.for?.average?.[side] ?? null,
      goalsAgainstAvg: stats.goals?.against?.average?.[side] ?? null,
    };
  };

  const homeForm = homeId && homeRecent ? summarizeFormDetailed(homeRecent, homeId) : null;
  const awayForm = awayId && awayRecent ? summarizeFormDetailed(awayRecent, awayId) : null;
  // Strict historical filter: only completed past matches with a real scoreline,
  // and ALWAYS strictly before this fixture's kickoff. Never let a future or
  // unplayed fixture leak into "head-to-head history".
  const kickoffMs = (() => {
    const t = Date.parse(data.kickoff);
    return Number.isFinite(t) ? t : Date.now();
  })();
  const h2hRows = (h2h ?? [])
    .filter((m) => {
      const t = Date.parse(m.fixture.date);
      const played = m.goals.home != null && m.goals.away != null;
      return Number.isFinite(t) && t < kickoffMs && played;
    })
    .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date))
    .slice(0, 5)
    .map((m) => ({
      date: m.fixture.date.slice(0, 10),
      score: `${m.goals.home}-${m.goals.away}`,
      home: m.teams.home.name,
      away: m.teams.away.name,
    }));

  const apiOddsRow = apiOdds?.find((row) => row.fixture.id === fixtureId) ?? apiOdds?.[0] ?? null;
  const extractedOdds = extractApiFootballOdds(apiOddsRow);
  let oddH = Number(data.oddsHome) > 1 ? Number(data.oddsHome) : extractedOdds.home;
  let oddD = Number(data.oddsDraw) > 1 ? Number(data.oddsDraw) : extractedOdds.draw;
  let oddA = Number(data.oddsAway) > 1 ? Number(data.oddsAway) : extractedOdds.away;

  // SportMonks fallback enrichment — only when API-Football missed data.
  let h2hSource: "api-football" | "sportmonks" = "api-football";
  let oddsSource: "input" | "api-football" | "sportmonks" | "none" = "none";
  if (oddH || oddD || oddA) oddsSource = (Number(data.oddsHome) > 1) ? "input" : "api-football";

  const needH2H = h2hRows.length === 0;
  const needOdds = !(oddH && oddD && oddA);
  let smOddsContributed = false;
  let smH2HContributed = false;
  if (needH2H || needOdds) {
    const tSm = Date.now();
    const [smH2H, smOdds] = await Promise.all([
      needH2H ? getSportMonksH2H(data.homeTeam, data.awayTeam, kickoffMs, 5) : Promise.resolve([]),
      needOdds ? getSportMonksOdds(data.homeTeam, data.awayTeam, data.kickoff) : Promise.resolve(null),
    ]);
    log(`sportmonks fallback in ${Date.now() - tSm}ms (h2h=${smH2H.length} odds=${!!smOdds})`);
    if (needH2H && smH2H.length > 0) {
      h2hRows.push(...smH2H);
      h2hSource = "sportmonks";
      smH2HContributed = true;
    }
    if (needOdds && smOdds) {
      if (!oddH && smOdds.home) { oddH = smOdds.home; smOddsContributed = true; }
      if (!oddD && smOdds.draw) { oddD = smOdds.draw; smOddsContributed = true; }
      if (!oddA && smOdds.away) { oddA = smOdds.away; smOddsContributed = true; }
      if (oddsSource === "none" || oddsSource === "api-football") oddsSource = "sportmonks";
    } else if (needOdds && !smOdds) {
      log(`odds: SportMonks fallback returned null — odds remain unavailable for ${data.homeTeam} vs ${data.awayTeam}`);
    }
  }
  void h2hSource; void oddsSource; // retained for future telemetry

  // SportMonks unified context — venue, lineups, injuries, model prediction.
  // Used to fill gaps and to cross-verify API-Football data.
  const tCtx = Date.now();
  const smCtx = await getSportMonksFixtureContext(data.homeTeam, data.awayTeam, data.kickoff).catch(
    (err) => { log(`sportmonks context error: ${err instanceof Error ? err.message : err}`); return null; },
  );
  log(`sportmonks context in ${Date.now() - tCtx}ms (have=${!!smCtx})`);

  // Merge missing injuries from SportMonks (sidelined endpoint).
  let mergedInjuriesHome = injuries?.map((i) => ({ player: i.player.name })) ?? [];
  let mergedInjuriesAway = awayInjuries?.map((i) => ({ player: i.player.name })) ?? [];
  let smInjuriesContributed = false;
  if (smCtx) {
    if (mergedInjuriesHome.length === 0 && smCtx.injuries.home.length > 0) {
      mergedInjuriesHome = smCtx.injuries.home.map((i) => ({ player: i.player }));
      smInjuriesContributed = true;
    }
    if (mergedInjuriesAway.length === 0 && smCtx.injuries.away.length > 0) {
      mergedInjuriesAway = smCtx.injuries.away.map((i) => ({ player: i.player }));
      smInjuriesContributed = true;
    }
  }

  // Merge missing lineups from SportMonks.
  type LineupSummary = { team: string; formation: string | null; starters: number };
  let mergedLineups: LineupSummary[] = lineups?.length
    ? lineups.map((l) => ({ team: l.team.name, formation: l.formation ?? null, starters: l.startXI?.length ?? 0 }))
    : [];
  let smLineupsContributed = false;
  if (mergedLineups.length === 0 && smCtx?.lineups.length) {
    mergedLineups = smCtx.lineups;
    smLineupsContributed = true;
  }

  const hasFullOdds = !!(oddH && oddD && oddA);
  const hasAnyOdds = !!(oddH || oddD || oddA);
  const smVenueContributed = !exactFixture?.fixture.venue?.name && !!smCtx?.venue;
  const venueInfo = exactFixture?.fixture.venue?.name
    ? `${exactFixture.fixture.venue.name}${exactFixture.fixture.venue.city ? `, ${exactFixture.fixture.venue.city}` : ""}`
    : smCtx?.venue
      ? `${smCtx.venue.name}${smCtx.venue.city ? `, ${smCtx.venue.city}` : ""}`
      : null;

  // Cross-source agreement: count how many signals SportMonks confirms.
  // Used to nudge confidence up when sources agree, or flag uncertainty.
  let agreementCount = 0;
  let conflictCount = 0;
  if (smCtx) {
    if (venueInfo && smCtx.venue?.name) agreementCount++;
    if (mergedLineups.length > 0 && smCtx.lineups.length > 0) agreementCount++;
    if ((mergedInjuriesHome.length + mergedInjuriesAway.length) > 0 &&
        (smCtx.injuries.home.length + smCtx.injuries.away.length) > 0) agreementCount++;
    // Odds agreement: SportMonks favourite matches API-Football favourite
    if (oddH && oddA && smCtx.prediction) {
      const afFav = oddH < oddA ? "home" : "away";
      const smProbs = smCtx.prediction;
      if (smProbs.home != null && smProbs.away != null) {
        const smFav = smProbs.home > smProbs.away ? "home" : "away";
        if (afFav === smFav) agreementCount++;
        else conflictCount++;
      }
    }
  }
  log(`cross-source agreement=${agreementCount} conflict=${conflictCount}`);

  const availability = {
    form: !!(homeForm && awayForm),
    // Treat odds as available whenever ANY real bookmaker price is present
    // (women's / lower-tier markets often expose only home+away, no draw).
    // The UI already shows these prices, so the AI must not claim odds are
    // missing when they are visibly on screen.
    odds: hasAnyOdds,
    oddsFull: hasFullOdds,
    oddsSnapshot: !!oddsSnap,
    standings: !!(homeStanding || awayStanding),
    h2h: h2hRows.length > 0,
    injuries: !!(mergedInjuriesHome.length || mergedInjuriesAway.length),
    venueSplit: !!(homeTeamStats || awayTeamStats),
    lineups: mergedLineups.length > 0,
    venueInfo: !!venueInfo,
  };
  const structuralSignalCount = [availability.standings, availability.h2h, availability.venueSplit, availability.venueInfo, availability.lineups].filter(Boolean).length;
  const signalCount = [availability.form, availability.odds, availability.standings, availability.h2h, availability.injuries, availability.venueSplit, availability.venueInfo].filter(Boolean).length;
  // SportMonks-only signals that can rescue obscure leagues where API-Football
  // has no form/odds (e.g. Brazilian Paranaense lower divisions).
  const smHasPrediction = !!(smCtx?.prediction && (smCtx.prediction.home != null || smCtx.prediction.away != null));
  const smEnrichmentCount = [
    smHasPrediction,
    smLineupsContributed,
    smInjuriesContributed,
    smVenueContributed,
    smH2HContributed,
    smOddsContributed,
  ].filter(Boolean).length;

  const missingDataServer: string[] = [];
  if (!availability.form) missingDataServer.push("Recent form");
  if (!availability.odds) missingDataServer.push("Bookmaker odds");
  else if (!availability.oddsFull) missingDataServer.push("Partial bookmaker odds (some prices missing)");
  if (!availability.oddsSnapshot) missingDataServer.push("Cross-bookmaker odds snapshot");
  if (!availability.standings) missingDataServer.push("League standings");
  if (!availability.h2h) missingDataServer.push("Head-to-head history");
  if (!availability.injuries) missingDataServer.push("Injury / suspension reports");
  if (!availability.venueSplit) missingDataServer.push("Home/away venue splits");
  if (!availability.lineups) missingDataServer.push("Confirmed lineups");
  if (!availability.venueInfo) missingDataServer.push("Venue information");

  // Floor: verified football context should produce at least a Standard Analysis.
  // Odds are valuable, but their absence must not block top-division fixtures
  // when form/standings/H2H/team statistics are verified elsewhere.
  const smRescue = smHasPrediction && smEnrichmentCount >= 2;
  const verifiedCoreData =
    availability.form ||
    availability.odds ||
    (availability.standings && availability.h2h) ||
    (structuralSignalCount >= 2 && !!exactFixture);
  const floorMet = (signalCount >= 2 && verifiedCoreData) || smRescue;
  if (!floorMet) {
    log(`signal floor not met (signalCount=${signalCount}, smPrediction=${smHasPrediction}, smEnrich=${smEnrichmentCount}) — returning safe fallback`);
    return safeFallbackAnalysis(data, "Not enough data available to produce a reliable analysis.", missingDataServer);
  }
  if (smRescue && !(availability.form || availability.odds)) {
    log(`signal floor rescued by SportMonks prediction + enrichment (smEnrich=${smEnrichmentCount})`);
  }

  // Server-computed data confidence overrides anything the model claims.
  const dataConfidenceServer: "low" | "medium" | "high" =
    availability.form && availability.odds && availability.standings && availability.h2h
      ? "high"
      : availability.form && availability.odds
        ? "medium"
        : availability.form && (availability.standings || availability.h2h)
          ? "medium"
          : availability.odds && (availability.standings || availability.h2h)
            ? "medium"
            : "low";

  const context = {
    match: { league: data.league, kickoff: data.kickoff, home: data.homeTeam, away: data.awayTeam, neutralVenue, venue: venueInfo },
    odds: {
      bookmakerOpen: { home: oddH, draw: oddD, away: oddA },
      snapshot: oddsSnap,
    },
    form: { home: homeForm, away: awayForm },
    venueSplit: neutralVenue ? null : {
      home: venueSplit(homeTeamStats, "home"),
      away: venueSplit(awayTeamStats, "away"),
    },
    standings: {
      home: homeStanding
        ? { rank: homeStanding.rank, points: homeStanding.points, played: homeStanding.all.played, record: `${homeStanding.all.win}W-${homeStanding.all.draw}D-${homeStanding.all.lose}L`, goalDiff: homeStanding.goalsDiff, form: homeStanding.form ?? null }
        : null,
      away: awayStanding
        ? { rank: awayStanding.rank, points: awayStanding.points, played: awayStanding.all.played, record: `${awayStanding.all.win}W-${awayStanding.all.draw}D-${awayStanding.all.lose}L`, goalDiff: awayStanding.goalsDiff, form: awayStanding.form ?? null }
        : null,
    },
    h2h: h2hRows.length ? h2hRows : null,
    injuries: {
      home: mergedInjuriesHome.slice(0, 8).map((i) => i.player),
      away: mergedInjuriesAway.slice(0, 8).map((i) => i.player),
    },
    lineups: mergedLineups.length ? mergedLineups : null,
    sportMonksPrediction: smCtx?.prediction
      ? {
          home: smCtx.prediction.home,
          draw: smCtx.prediction.draw,
          away: smCtx.prediction.away,
          note: "Independent SportMonks model probability — use only as cross-check, not as ground truth.",
        }
      : null,
    crossSourceVerification: {
      sportMonksAvailable: !!smCtx,
      agreementSignals: agreementCount,
      conflictSignals: conflictCount,
      note: agreementCount >= 2
        ? "Multiple data sources agree — slight confidence boost permitted."
        : conflictCount > 0
          ? "Sources disagree on favourite — flag uncertainty in summary and reduce confidence."
          : "Single-source data — no cross-verification boost.",
    },
    dataAvailability: { ...availability, neutralVenue },
    serverComputedDataConfidence: dataConfidenceServer,
    bankroll: data.bankroll ?? 1000,
    maxStakePct: data.maxStakePct ?? 5,
  };

  const systemPrompt = `You are a professional sports-betting MARKET ANALYST writing for a betting analytics terminal. You are NOT a tipster and NOT a fortune-teller. Your job is to identify market inefficiencies, not to predict winners.

TONE — MANDATORY:
- Write like a trading desk note, not a tipster blog. Sober, neutral, hedged.
- Use phrases like: "potential edge", "slight inefficiency detected", "may create problems", "small pricing inefficiency", "weak edge", "limited confidence", "market appears slightly mispriced", "signal is thin", "data is incomplete".
- BANNED words/phrases: "guaranteed", "sure", "lock", "easy money", "free money", "definitely", "will win", "bound to", "no doubt", "must back", "smash", "banker", "likely frustrate", "strong opportunity", "clear edge", "huge value", "obvious pick".
- Never claim a winner. Always frame picks as conditional probability statements vs the market price.

DATE / HISTORY VALIDATION — MANDATORY:
- The DATA payload's h2h list has ALREADY been pre-filtered to matches played strictly BEFORE this fixture's kickoff (${data.kickoff}). Treat that list as the only valid historical reference. Do NOT cite any other historical match. If h2h is null/empty, say "Not enough historical data available." — never invent past meetings.
- Do NOT reference fixtures dated on or after ${data.kickoff} as history.

VERIFIED-DATA-ONLY MODE — MANDATORY:
- Form W-D-L records, last-5 scorelines, goal averages, league rank/points, H2H scorelines, bookmaker prices: use ONLY the EXACT values present in DATA. Do NOT recompute, re-tally, estimate, infer, round, or "approximate". If DATA.form.home.record is "4W-0D-1L", you MUST write "4W-0D-1L" verbatim — never a different split.
- Never invent numbers (records, averages, standings, scorelines, xG, possession). If a field is null, write "Not enough data available."
- Avoid dramatic football language ("dominant", "crushing", "thrashing", "frustrate", "torment", "demolish", "vulnerability"). Match wording to the actual numbers — neutral analyst tone only.

NEUTRAL VENUE — MANDATORY:
- If DATA.match.neutralVenue is true, this fixture is played at a NEUTRAL ground. You MUST NOT reference "home advantage", "home venue", "home crowd", "home vulnerability", "away travel", or any home/away venue dynamic. Treat both teams as visiting. The homeAwayAnalysis field MUST be exactly: "Neutral venue — home/away advantage does not apply."

CONTRADICTION HANDLING — MANDATORY:
- If H2H pattern contradicts current form (e.g. H2H favours team A but team B is in much better recent form), explicitly call out the contradiction in h2hSummary AND lower confidence. Do NOT force a strong prediction in either direction — describe the conflict.

CONFIDENCE / VALUE DISCIPLINE — MANDATORY (server will additionally clamp these):
- If serverComputedDataConfidence is "low": confidence MUST be <=60, valueSignal MUST be "none" or "low", valueBet MUST be false, and suggestedMarkets MUST be at most 1 low/medium-risk pick.
- If serverComputedDataConfidence is "medium": confidence MUST be <=72, valueSignal MUST NOT be "strong", and suggestedMarkets MUST be at most 2.
- If injuries OR cross-book odds snapshot are missing, confidence MUST stay <=60 regardless of other signals.
- valueBet=true ONLY when fair odds (100/prob) imply >=8% edge over the bookmaker price AND data quality is "high" AND injuries+oddsSnapshot are both available.
- Edges of 2-5% are "weak edge" / "potential pricing edge", NOT value bets. Edges of 5-8% are "potential pricing edge" with limited conviction.
- Stake recommendations: low confidence (<60) -> 0.5%; medium (60-74) -> 1.5%; high (>=75) -> 2.5%. Never exceed maxStakePct.

PROSE RULES:
- Every section MUST cite at least one concrete data point from DATA (W/D/L record, scoreline, goal average, league rank, points total, bookmaker price, injured player, H2H scoreline). If the relevant field is null/empty, write exactly "Not enough data available." — do NOT invent.
- When data is incomplete (low/medium dataQuality), keep each section SHORT (1-2 sentences) and avoid strong language.

OUTPUT FIELDS:
1. summary — 2-3 sentences, neutral market read, must reference at least one number.
2. formAnalysis — cite EXACT W/D/L records from DATA.form.{home,away}.record and 1-2 actual scorelines from DATA.form.{home,away}.last5. Never alter the record.
3. homeAwayAnalysis — if neutralVenue, the exact mandated string above. Otherwise cite venue split. If null, "Not enough data available."
4. tacticalAngle — derive from goals for/against averages. If no stats, "Not enough data available."
5. motivation — cite league rank/points if standings present, else "Not enough data available."
6. h2hSummary — cite ONLY the pre-filtered H2H rows with their dates; flag contradictions vs current form.
7. injuriesImpact — name specific players if present, else "Not enough data available."
8. oddsMovement — cite open prices and snapshot spread if present.
9. suggestedMarkets — 1-4 objects. Each reason MUST cite numbers and quantify the edge ("model 58% vs implied 52% -> ~6% edge"). Skip markets you cannot justify with data.
10. missingData — list every unavailable source from dataAvailability.
11. probHome+probDraw+probAway sum to ~100. Apply the value/confidence discipline above.
12. risk follows confidence: low >=75, medium 60-74, high <60.
13. dataQuality must equal serverComputedDataConfidence from DATA.
14. reasoning — show the edge math with actual numbers and explain why the stake is small. Hedge the language.
15. responsibleNote — short responsible-gambling reminder, no guarantees.`;


  const aiStart = Date.now();
  let aiResp;
  try {
    aiResp = await aiRouter.generate({
      tier: "fast",
      timeoutMs: 30_000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this fixture and call the function with your structured assessment.\n\nDATA:\n${JSON.stringify(context, null, 2)}` },
      ],
      tool: {
        name: "submit_analysis",
        description: "Return the full structured betting analysis.",
        parameters: analysisSchema as unknown as Record<string, unknown>,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof AIProviderError ? err.status : undefined;
    log(`AI request failed in ${Date.now() - aiStart}ms (status=${status ?? "n/a"}): ${msg}`);
    // Bubble up real quota/rate-limit errors so the UI can show the right CTA.
    if (status === 429) throw new Error("429 rate_limited: AI gateway is rate-limited, please retry shortly.");
    if (status === 402) throw new Error("402 payment_required: AI gateway credits exhausted.");
    return safeFallbackAnalysis(
      data,
      msg.includes("timed out") ? "AI request timed out" : `AI request failed: ${msg}`,
      missingDataServer,
    );
  }
  log(`AI response provider=${aiResp.provider} model=${aiResp.model} in ${Date.now() - aiStart}ms`);

  if (aiResp.finishReason === "length" || aiResp.finishReason === "max_tokens") {
    log("AI response truncated by max_tokens — returning safe fallback");
    return safeFallbackAnalysis(data, "AI response was truncated", missingDataServer);
  }

  let parsed: Omit<AIAnalysisResult, "matchId" | "bestMarket" | "suggestedStakeAmount" | "warning"> & { bestMarket: "home" | "draw" | "away" };
  if (aiResp.data && typeof aiResp.data === "object") {
    parsed = aiResp.data as typeof parsed;
  } else {
    try {
      parsed = extractJsonObject(aiResp.text ?? "{}") as typeof parsed;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("Failed to parse AI response:", detail, (aiResp.text ?? "").slice(0, 500));
      return safeFallbackAnalysis(data, `malformed AI JSON (${detail})`, missingDataServer);
    }
  }

  // Defensive: if probabilities or required text fields are unusable, return
  // a safe fallback instead of trapping the user.
  const pSum = Number(parsed.probHome) + Number(parsed.probDraw) + Number(parsed.probAway);
  if (!Number.isFinite(pSum) || pSum < 95 || pSum > 105 || !hasUsableAnalysisFields(parsed)) {
    console.error("AI returned unusable analysis, falling back", {
      pSum,
      keys: parsed ? Object.keys(parsed) : null,
    });
    return safeFallbackAnalysis(data, "AI returned incomplete or unusable fields", missingDataServer);
  }
  const rawProbHome = Number(parsed.probHome);
  const rawProbDraw = Number(parsed.probDraw);
  const rawProbAway = Number(parsed.probAway);

  // Normalize probabilities to sum to exactly 100
  const probSum = rawProbHome + rawProbDraw + rawProbAway || 1;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const probHome = round2((rawProbHome / probSum) * 100);
  const probDraw = round2((rawProbDraw / probSum) * 100);
  const probAway = round2(100 - probHome - probDraw);

  // ---- Server-side discipline: clamp confidence by data quality, derive
  // value signal from REAL edge math, and size stake conservatively. The model
  // can recommend, but the server has final say so the UI never overpromises.
  const keySourcesMissing = !availability.injuries || !availability.oddsSnapshot;
  // Aggressive cap when key market-verification sources are missing.
  const dqCap = dataConfidenceServer === "high"
    ? (keySourcesMissing ? 78 : 92)
    : dataConfidenceServer === "medium"
      ? (keySourcesMissing ? 60 : 72)
      : 55;
  const modelConfidence = Math.max(1, Math.min(99, Math.round(Number(parsed.confidence) || 50)));
  // Cross-source nudge: +3 when SportMonks agrees on 2+ signals, -8 on conflicts.
  const crossSourceDelta = conflictCount > 0 ? -8 : agreementCount >= 2 ? 3 : 0;
  const confidence = Math.max(1, Math.min(99, Math.min(modelConfidence + crossSourceDelta, dqCap)));
  const risk: AIAnalysisResult["risk"] = confidence >= 75 ? "low" : confidence >= 60 ? "medium" : "high";

  // Compute real edge: model probability vs bookmaker implied probability for the chosen side.
  const bookOddsMap = {
    home: oddH,
    draw: oddD,
    away: oddA,
  } as const;
  const probMap = { home: probHome, draw: probDraw, away: probAway } as const;
  const bestKey = (parsed.bestMarket === "home" || parsed.bestMarket === "draw" || parsed.bestMarket === "away")
    ? parsed.bestMarket : "draw";
  const bookOdd = bookOddsMap[bestKey];
  const modelProb = probMap[bestKey] / 100;
  const edge = bookOdd && modelProb > 0 ? modelProb * bookOdd - 1 : 0; // e.g. 0.07 = 7% edge

  // Stricter edge thresholds. valueBet=true ONLY for strong signal AND high data quality
  // AND no missing key sources. Small/medium edges are clearly NOT value bets.
  let valueSignal: "none" | "low" | "moderate" | "strong";
  if (!bookOdd || edge < 0.02) valueSignal = "none";
  else if (edge < 0.06) valueSignal = "low";
  else if (edge < 0.10) valueSignal = dataConfidenceServer === "low" ? "low" : "moderate";
  else valueSignal = (dataConfidenceServer === "high" && !keySourcesMissing) ? "strong" : "moderate";
  const valueBet = valueSignal === "strong";

  // Market efficiency indicator (independent of best-pick edge).
  const absEdge = Math.abs(edge);
  let marketEfficiency: "efficient" | "slightly_mispriced" | "potentially_inefficient";
  if (!bookOdd || absEdge < 0.03) marketEfficiency = "efficient";
  else if (absEdge < 0.07) marketEfficiency = "slightly_mispriced";
  else marketEfficiency = dataConfidenceServer === "low" ? "slightly_mispriced" : "potentially_inefficient";

  const marketVerification: "full" | "partial" | "limited" =
    dataConfidenceServer === "high" && !keySourcesMissing
      ? "full"
      : dataConfidenceServer === "low"
        ? "limited"
        : "partial";

  // Stake sizing: conservative, scaled by confidence AND edge AND data quality.
  const baseRiskPct = confidence >= 75 ? 2.5 : confidence >= 60 ? 1.5 : 0.5;
  const dqMult = dataConfidenceServer === "high" ? 1 : dataConfidenceServer === "medium" ? 0.7 : 0.4;
  const edgeMult = valueBet ? 1 : valueSignal === "moderate" ? 0.6 : valueSignal === "low" ? 0.4 : 0.3;
  const maxPct = data.maxStakePct ?? 5;
  const bankroll = data.bankroll ?? 0;
  const stakePct = Math.max(0.25, Math.min(maxPct, baseRiskPct * dqMult * edgeMult));
  const stakeAmount = bankroll > 0
    ? Math.round(bankroll * (stakePct / 100) * 100) / 100
    : 0;

  const labelMap: Record<"home" | "draw" | "away", string> = {
    home: `${data.homeTeam} Win`,
    draw: "Draw",
    away: `${data.awayTeam} Win`,
  };


  const NA = "Not enough data available.";
  const UNVERIFIED = "Verified data unavailable for this section.";
  const str = (v: unknown, fallback = NA) =>
    typeof v === "string" && v.trim().length > 0 ? polishProse(v) : fallback;

  // Removes empty brackets/parens, dangling connectors, tipster wording,
  // and contradictory "no odds" claims from AI prose before it ships.
  function polishProse(input: string): string {
    return input
      // empty () [] {} placeholders
      .replace(/[\(\[\{]\s*[\)\]\}]/g, "")
      // dangling " in ." " on ." " from ." etc
      .replace(/\b(in|on|at|during|since|from|across|with|by)\s*([.,;:!?])/gi, "$2")
      // tipster phrasing → analytics phrasing
      .replace(/\bstake\s+conservatively\b/gi, "treat this as a lower-confidence market environment")
      .replace(/\bestimated\s+probability\s*[~≈]?\s*\d{1,3}\s*%/gi, "model confidence suggests a balanced edge")
      .replace(/\bestimated\s+probability\b/gi, "model confidence")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/([.,;:!?]){2,}/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Strip any AI-fabricated scoreline citations like "0-0", "2 - 1", "won 3:0".
  const stripScorelines = (s: string) =>
    s
      .replace(/\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/g, "[score withheld]")
      .replace(/\s+\[score withheld\]/g, " [score withheld]");

  // VERIFIED-DATA OVERRIDES — never let the model invent history or scorelines.
  // If we have no verified H2H rows, we replace h2hSummary entirely.
  // If we DO have rows, we prepend the verified scorelines so the user sees
  // ground truth (and the model's prose can only annotate it).
  // Strip ANY date-like fragment from AI prose (full or partial). The verified
  // meetings line already carries authoritative dates, and AI text often emits
  // broken stubs like "on 2024-" or "in 2021-" when it tries to cite a date
  // it doesn't actually have. We never want partial dates rendered.
  const stripDateFragments = (s: string) =>
    s
      .replace(/\b(?:on|in|back in|from|since)\s+\d{4}(?:[-/]\d{0,2}){0,2}\b[-/]?/gi, "")
      .replace(/\b\d{4}-\d{0,2}-?\d{0,2}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;:])/g, "$1")
      .trim();
  let verifiedH2H: string;
  if (h2hRows.length === 0) {
    verifiedH2H = UNVERIFIED;
  } else {
    const lines = h2hRows
      .map((r) => `${r.date}: ${r.home} ${r.score} ${r.away}`)
      .join(" • ");
    const aiText = stripDateFragments(stripScorelines(str(parsed.h2hSummary, "")));
    verifiedH2H = `Verified meetings — ${lines}.${aiText ? ` ${aiText}` : ""}`;
  }

  // Recent form: prepend VERIFIED W-D-L records so the model can never
  // contradict ground truth (e.g. claim "3W-1D-1L" when actual is "4W-0D-1L").
  // Also strip any AI-asserted W-D-L splits that disagree with the real records.
  const sanitizeFormProse = (s: string): string => {
    if (!homeForm || !awayForm) return s;
    return s.replace(/\b(\d{1,2})\s*W\s*[-–]\s*(\d{1,2})\s*D\s*[-–]\s*(\d{1,2})\s*L\b/gi, (match) => {
      const norm = match.replace(/\s+/g, "").toUpperCase();
      if (norm === homeForm.record.toUpperCase() || norm === awayForm.record.toUpperCase()) return match;
      return "[record withheld]";
    });
  };
  let verifiedForm: string;
  if (homeForm && awayForm) {
    const verifiedLine = `Verified last-5 form — ${data.homeTeam}: ${homeForm.record} (${homeForm.last5.map((r) => r.result).join("")}); ${data.awayTeam}: ${awayForm.record} (${awayForm.last5.map((r) => r.result).join("")}).`;
    const aiText = sanitizeFormProse(str(parsed.formAnalysis, ""));
    verifiedForm = aiText ? `${verifiedLine} ${aiText}` : verifiedLine;
  } else {
    verifiedForm = UNVERIFIED;
  }

  const verifiedInjuries = (mergedInjuriesHome.length || mergedInjuriesAway.length)
    ? str(parsed.injuriesImpact)
    : UNVERIFIED;

  const verifiedMotivation = (homeStanding || awayStanding)
    ? str(parsed.motivation)
    : UNVERIFIED;

  // Strip any home-advantage language when the venue is neutral.
  const stripHomeAwayWording = (s: string): string =>
    s
      .replace(/\bhome\s+(advantage|crowd|venue|vulnerability|fortress|ground|support|edge|dynamic[s]?)\b/gi, "neutral-venue context")
      .replace(/\baway\s+(travel|trip|day|disadvantage|venue\s+disadvantage)\b/gi, "neutral-venue context")
      .replace(/\bat\s+home\b/gi, "at the neutral venue")
      .replace(/\bon\s+the\s+road\b/gi, "at the neutral venue");

  const verifiedHomeAway = neutralVenue
    ? "Neutral venue — home/away advantage does not apply."
    : (homeTeamStats || awayTeamStats)
      ? str((parsed as any).homeAwayAnalysis)
      : UNVERIFIED;

  const verifiedTactical = (homeTeamStats || awayTeamStats || (homeForm && awayForm))
    ? (neutralVenue ? stripHomeAwayWording(str((parsed as any).tacticalAngle)) : str((parsed as any).tacticalAngle))
    : UNVERIFIED;

  // Summary / reasoning may quote scorelines — scrub any not present in verified data.
  const verifiedScores = new Set(h2hRows.map((r) => r.score));
  const scrubHallucinatedScores = (s: string) =>
    s.replace(/\b(\d{1,2})\s*[-–:]\s*(\d{1,2})\b/g, (m, a, b) => {
      const norm = `${a}-${b}`;
      return verifiedScores.has(norm) ? norm : "[score withheld]";
    });
  const applyNeutral = (s: string) => (neutralVenue ? stripHomeAwayWording(s) : s);
  const verifiedSummary = applyNeutral(scrubHallucinatedScores(
    sanitizeFormProse(str(parsed.summary, "Analysis could not be fully generated from available data.")),
  ));
  const verifiedReasoning = applyNeutral(scrubHallucinatedScores(sanitizeFormProse(str(parsed.reasoning, "Reasoning unavailable."))));

  log(`mapped result bestMarket=${parsed.bestMarket} confidence=${confidence} risk=${risk} probs=${probHome}/${probDraw}/${probAway} dq=${dataConfidenceServer}`);
  return {
    matchId: data.matchId,
    summary: verifiedSummary,
    formAnalysis: verifiedForm,
    injuriesImpact: verifiedInjuries,
    motivation: verifiedMotivation,
    h2hSummary: verifiedH2H,
    oddsMovement: (() => {
      // Anti-hallucination: if any real bookmaker odds were passed in, ALWAYS
      // surface them in the analysis text — the UI is already showing them,
      // so the AI must not contradict the visible market.
      const verifiedOddsLine = hasAnyOdds
        ? `Verified bookmaker prices — home ${oddH ? oddH.toFixed(2) : "n/a"}, draw ${oddD ? oddD.toFixed(2) : "n/a"}, away ${oddA ? oddA.toFixed(2) : "n/a"}${availability.oddsSnapshot ? "; cross-book snapshot available" : "; no cross-book snapshot"}.`
        : null;
      const aiText = (availability.odds || availability.oddsSnapshot)
        ? str(parsed.oddsMovement, "")
        : "";
      // Strip AI claims that contradict reality.
      const sanitizedAi = aiText
        .replace(/no\s+(bookmaker\s+)?odds\s+(are\s+)?available[^.]*\.?/gi, "")
        .replace(/no\s+live\s+market\s+data\s+available[^.]*\.?/gi, "")
        .replace(/bookmaker\s+odds\s+(are\s+)?(currently\s+)?unavailable[^.]*\.?/gi, "")
        .trim();
      if (verifiedOddsLine) return sanitizedAi ? `${verifiedOddsLine} ${sanitizedAi}` : verifiedOddsLine;
      return sanitizedAi || UNVERIFIED;
    })(),
    bestMarket: labelMap[parsed.bestMarket] ?? labelMap.draw,
    probHome,
    probDraw,
    probAway,
    confidence,
    risk,
    valueBet,
    suggestedStakePct: round2(stakePct),
    suggestedStakeAmount: stakeAmount,
    reasoning: verifiedReasoning,
    warning: FALLBACK_WARNING,
    tacticalAngle: verifiedTactical,
    homeAwayAnalysis: verifiedHomeAway,
    valueSignal,
    suggestedMarketsDetailed: (() => {
      const cap = dataConfidenceServer === "low" ? 1 : dataConfidenceServer === "medium" ? 2 : 4;
      const allowedRisk = dataConfidenceServer === "low" ? ["low", "medium"] : ["low", "medium", "high"];
      return Array.isArray((parsed as any).suggestedMarkets)
        ? ((parsed as any).suggestedMarkets as Array<any>)
            .filter((m) => m && typeof m === "object" && typeof m.market === "string" && typeof m.reason === "string")
            .map((m) => ({
              market: String(m.market).slice(0, 80),
              reason: String(m.reason).slice(0, 280),
              risk: (["low", "medium", "high"].includes(m.risk) ? m.risk : "medium") as "low" | "medium" | "high",
              confidence: Math.max(1, Math.min(99, Math.round(Number(m.confidence) || confidence))),
            }))
            .filter((m) => allowedRisk.includes(m.risk))
            .slice(0, cap)
        : undefined;
    })(),
    suggestedMarkets: (() => {
      const cap = dataConfidenceServer === "low" ? 1 : dataConfidenceServer === "medium" ? 2 : 4;
      return Array.isArray((parsed as any).suggestedMarkets)
        ? ((parsed as any).suggestedMarkets as Array<any>)
            .map((m) => (typeof m === "string" ? m : m?.market))
            .filter((s): s is string => typeof s === "string" && s.length > 0)
            .slice(0, cap)
        : undefined;
    })(),
    missingData: Array.isArray((parsed as any).missingData)
      ? ((parsed as any).missingData as Array<unknown>)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .slice(0, 8)
      : missingDataServer,
    // Server-computed dataQuality always wins so the UI badge is honest.
    dataQuality: dataConfidenceServer,
    marketVerification,
    marketEfficiency,
    responsibleNote: str((parsed as any).responsibleNote, "Bet responsibly. No outcome is guaranteed."),
    dataSources: (() => {
      const contributed: Array<"odds" | "h2h" | "venue" | "lineups" | "injuries" | "prediction"> = [];
      if (smOddsContributed) contributed.push("odds");
      if (smH2HContributed) contributed.push("h2h");
      if (smVenueContributed) contributed.push("venue");
      if (smLineupsContributed) contributed.push("lineups");
      if (smInjuriesContributed) contributed.push("injuries");
      if (smCtx?.prediction) contributed.push("prediction");
      const enriched = !!smCtx || contributed.length > 0;
      if (!enriched) return undefined;
      return {
        sportMonks: {
          enriched,
          contributed,
          prediction: smCtx?.prediction ?? null,
          venue: smCtx?.venue ?? null,
          lineups: mergedLineups,
          injuries: {
            home: mergedInjuriesHome.slice(0, 8).map((i) => i.player),
            away: mergedInjuriesAway.slice(0, 8).map((i) => i.player),
          },
        },
      };
    })(),
  };

}
