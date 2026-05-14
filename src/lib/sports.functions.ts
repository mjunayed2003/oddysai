import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";

// API-Football v3 (api-sports.io)
const AF_BASE = "https://v3.football.api-sports.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const API_CACHE_TTL_MS = 90_000;

const apiCache = new Map<string, { expiresAt: number; value: unknown }>();

export interface SportsApiDebugEntry {
  endpoint: string;
  status: number | null;
  ok: boolean;
  responseCount: number | null;
  quotaRemaining: string | null;
  quotaLimit: string | null;
  errors: string | null;
  message: string | null;
}

interface AFFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } };
  league: { id: number; name: string; country: string; logo: string; season?: number };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: { home: number | null; away: number | null };
}

interface AFLeague {
  league: { id: number; name: string; type: string; logo: string };
  country: { name: string; code: string | null; flag: string | null };
  seasons: Array<{ year: number; current: boolean }>;
}

export interface NormalizedFixture {
  id: string;
  leagueId: number;
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  kickoff: string;
  status: "scheduled" | "live" | "finished";
  statusShort: string;
  homeScore: number | null;
  awayScore: number | null;
  elapsed: number | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  hasOdds: boolean;
  hasSufficientData: boolean;
}

export interface NormalizedLeague {
  id: number;
  name: string;
  country: string;
  logo: string;
  flag: string | null;
  type: string;
  season: number;
}

function mapStatus(short: string): NormalizedFixture["status"] {
  if (["NS", "TBD", "PST"].includes(short)) return "scheduled";
  if (["FT", "AET", "PEN", "CANC", "ABD", "AWD", "WO"].includes(short)) return "finished";
  return "live";
}

async function af<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<
  | { ok: true; data: T; debug: SportsApiDebugEntry }
  | { ok: false; reason: string; status?: number; debug: SportsApiDebugEntry }
> {
  const key = process.env.API_FOOTBALL_KEY;
  const url = new URL(`${AF_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const endpoint = `${path}?${url.searchParams.toString()}`;
  const cached = apiCache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ok: true,
      data: cached.value as T,
      debug: {
        endpoint,
        status: 200,
        ok: true,
        responseCount: Array.isArray(cached.value) ? cached.value.length : null,
        quotaRemaining: null,
        quotaLimit: null,
        errors: null,
        message: "cache",
      },
    };
  }
  if (!key) {
    const debug = {
      endpoint,
      status: null,
      ok: false,
      responseCount: null,
      quotaRemaining: null,
      quotaLimit: null,
      errors: "API_FOOTBALL_KEY not configured",
      message: "Missing paid sports API key",
    };
    console.error("[sports] API_FOOTBALL_KEY not configured", { endpoint });
    return { ok: false, reason: "API_FOOTBALL_KEY not configured", debug };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { "x-apisports-key": key }, signal: ctrl.signal });
    const quotaRemaining = res.headers.get("x-ratelimit-requests-remaining");
    const quotaLimit = res.headers.get("x-ratelimit-requests-limit");
    const body = await res.text().catch(() => "");
    let json: { response?: T; errors?: unknown; message?: string } | null = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const responseCount = Array.isArray(json?.response) ? json.response.length : null;
    const errorsText =
      json?.errors && typeof json.errors === "object" && Object.keys(json.errors).length > 0
        ? JSON.stringify(json.errors).slice(0, 500)
        : null;
    const debug: SportsApiDebugEntry = {
      endpoint,
      status: res.status,
      ok: res.ok,
      responseCount,
      quotaRemaining,
      quotaLimit,
      errors: errorsText,
      message: json?.message ?? null,
    };
    if (!res.ok) {
      const reason =
        res.status === 429
          ? "API-Football rate limit / quota exceeded"
          : res.status === 401 || res.status === 403
            ? "API-Football key invalid or unauthorized for this league"
            : `API-Football ${path} failed (${res.status})`;
      console.error(`[sports] ${reason}`, {
        endpoint,
        status: res.status,
        quotaRemaining,
        quotaLimit,
        body: body.slice(0, 500),
      });
      return { ok: false, reason, status: res.status, debug };
    }
    if (errorsText) {
      console.error(`[sports] ${path} returned errors:`, {
        endpoint,
        errors: errorsText,
        quotaRemaining,
        quotaLimit,
      });
    }
    const response = (json?.response ?? ([] as T)) as T;
    apiCache.set(endpoint, { expiresAt: Date.now() + API_CACHE_TTL_MS, value: response });
    return { ok: true, data: response, debug };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const debug = {
      endpoint,
      status: null,
      ok: false,
      responseCount: null,
      quotaRemaining: null,
      quotaLimit: null,
      errors: reason,
      message: "Network/runtime error",
    };
    console.error(`[sports] ${path} threw:`, { endpoint, reason });
    return { ok: false, reason, debug };
  } finally {
    clearTimeout(timer);
  }
}

type AFOddsRow = {
  fixture: { id: number };
  bookmakers: Array<{
    id?: number;
    name?: string;
    bets: Array<{ id?: number; name: string; values: Array<{ value: string; odd: string }> }>;
  }>;
};

// Aliases for the 1X2 / match-result market across providers and locales.
// Some leagues (women's, lower tiers, regional books) expose different names
// (e.g. "1X2", "Full Time Result", "Match Result") and only some bookmakers
// publish all three outcomes. We scan ALL bookmakers and ALL alias bets and
// fill in any outcome we can find — partial coverage is far better than
// silently dropping the fixture as "odds unavailable".
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
  "fulltime 1x2",
  "regular time",
]);

const HOME_LABELS = new Set(["home", "1", "home team"]);
const DRAW_LABELS = new Set(["draw", "x", "tie"]);
const AWAY_LABELS = new Set(["away", "2", "away team"]);

function normalizeMarketText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMatchWinnerBet(bet: { id?: number; name?: string }) {
  const name = normalizeMarketText(bet.name ?? "");
  if (bet.id === 1 || MATCH_WINNER_BET_ALIASES.has(name)) return true;
  return ["match winner", "full time result", "match result", "1x2"].some((alias) =>
    name.includes(alias),
  );
}

function extractMatchWinnerFromBets(
  bets: Array<{ id?: number; name: string; values: Array<{ value: string; odd: string }> }> = [],
) {
  let h: number | null = null;
  let d: number | null = null;
  let a: number | null = null;
  for (const bet of bets) {
    if (!isMatchWinnerBet(bet)) continue;
    for (const v of bet.values ?? []) {
      const lbl = normalizeMarketText(String(v.value ?? ""));
      const num = Number(v.odd);
      if (!Number.isFinite(num) || num <= 1) continue;
      if (h == null && HOME_LABELS.has(lbl)) h = num;
      else if (d == null && DRAW_LABELS.has(lbl)) d = num;
      else if (a == null && AWAY_LABELS.has(lbl)) a = num;
    }
  }
  return { h, d, a };
}

function usableOddsCount(odds?: { h: number | null; d: number | null; a: number | null }) {
  return [odds?.h, odds?.d, odds?.a].filter((v) => v != null && Number(v) > 1).length;
}

function mergeOdds(
  target: Map<number, { h: number | null; d: number | null; a: number | null }>,
  fixtureId: number,
  odds: { h: number | null; d: number | null; a: number | null },
) {
  const current = target.get(fixtureId);
  const merged = {
    h: current?.h ?? odds.h,
    d: current?.d ?? odds.d,
    a: current?.a ?? odds.a,
  };
  if (usableOddsCount(merged) >= usableOddsCount(current)) target.set(fixtureId, merged);
}

function extractMatchWinner(row: AFOddsRow): {
  h: number | null;
  d: number | null;
  a: number | null;
} {
  let h: number | null = null;
  let d: number | null = null;
  let a: number | null = null;
  for (const bm of row.bookmakers ?? []) {
    const o = extractMatchWinnerFromBets(bm.bets);
    if (h == null) h = o.h;
    if (d == null) d = o.d;
    if (a == null) a = o.a;
    if (h != null && d != null && a != null) return { h, d, a };
  }
  return { h, d, a };
}

// Fetch ALL odds for a date in a single API call (paginated). Avoids per-fixture
// rate-limit storms that previously starved the per-minute quota.
async function fetchOddsByDate(
  date: string,
): Promise<Map<number, { h: number | null; d: number | null; a: number | null }>> {
  const map = new Map<number, { h: number | null; d: number | null; a: number | null }>();
  let page = 1;
  for (let i = 0; i < 6; i++) {
    const r = await af<AFOddsRow[]>("/odds", { date, bet: 1, page });
    if (!r.ok || !r.data?.length) break;
    for (const row of r.data) {
      const o = extractMatchWinner(row);
      if (usableOddsCount(o) > 0) mergeOdds(map, row.fixture.id, o);
    }
    // API-Football paging info isn't surfaced here; stop if last page returned < 100
    if (r.data.length < 100) break;
    page++;
  }
  return map;
}

// Fetch in-play odds across ALL currently live fixtures (single call).
async function fetchLiveOdds(): Promise<
  Map<number, { h: number | null; d: number | null; a: number | null }>
> {
  const map = new Map<number, { h: number | null; d: number | null; a: number | null }>();
  const r = await af<AFOddsRow[]>("/odds/live", {});
  if (!r.ok || !r.data?.length) return map;
  for (const row of r.data) {
    const o = extractMatchWinner(row);
    if (usableOddsCount(o) > 0) mergeOdds(map, row.fixture.id, o);
  }
  return map;
}

async function fetchOddsForFixture(
  fixtureId: number,
  date?: string,
  leagueId?: number,
  season?: number,
): Promise<{ h: number | null; d: number | null; a: number | null } | undefined> {
  const exactBet = await af<AFOddsRow[]>('/odds', { fixture: fixtureId, bet: 1 });
  let best = exactBet.ok ? exactBet.data.find((row) => row.fixture.id === fixtureId) : undefined;
  let odds = best ? extractMatchWinner(best) : undefined;
  if (usableOddsCount(odds) >= 2) return odds;

  const exactAll = await af<AFOddsRow[]>('/odds', { fixture: fixtureId });
  best = exactAll.ok ? exactAll.data.find((row) => row.fixture.id === fixtureId) : undefined;
  const allOdds = best ? extractMatchWinner(best) : undefined;
  if (usableOddsCount(allOdds) > usableOddsCount(odds)) odds = allOdds;
  if (usableOddsCount(odds) >= 2) return odds;

  if (date) {
    const byDate = await fetchOddsByDate(date);
    const dateOdds = byDate.get(fixtureId);
    if (usableOddsCount(dateOdds) > usableOddsCount(odds)) odds = dateOdds;
    if (usableOddsCount(odds) >= 2) return odds;
  }

  if (leagueId && season) {
    const byLeague = await fetchOddsByLeague(leagueId, season);
    const leagueOdds = byLeague.get(fixtureId);
    if (usableOddsCount(leagueOdds) > usableOddsCount(odds)) odds = leagueOdds;
  }

  return usableOddsCount(odds) > 0 ? odds : undefined;
}

async function fetchOddsByLeague(
  leagueId: number,
  season: number,
): Promise<Map<number, { h: number | null; d: number | null; a: number | null }>> {
  const map = new Map<number, { h: number | null; d: number | null; a: number | null }>();
  let page = 1;
  for (let i = 0; i < 6; i++) {
    const r = await af<AFOddsRow[]>("/odds", { league: leagueId, season, bet: 1, page });
    if (!r.ok || !r.data?.length) break;
    for (const row of r.data) {
      const o = extractMatchWinner(row);
      if (usableOddsCount(o) > 0) mergeOdds(map, row.fixture.id, o);
    }
    if (r.data.length < 100) break;
    page++;
  }
  return map;
}

// Popular league IDs (api-football). Lower number = higher priority.
const POPULAR_LEAGUE_PRIORITY: Record<number, number> = {
  2: 1,
  3: 2,
  848: 3, // UCL, UEL, UECL
  39: 4,
  140: 5,
  135: 6,
  78: 7,
  61: 8, // EPL, LaLiga, SerieA, Bundesliga, Ligue1
  88: 10,
  94: 11,
  203: 12,
  197: 13, // Eredivisie, Primeira, Süper Lig, Greek SL
  144: 14,
  179: 15,
  71: 16,
  253: 17, // Belgium, Scottish, Brazil A, MLS
  40: 18,
  41: 19,
  79: 20,
  137: 21, // Championship, League One, Bundesliga 2, Serie B
  141: 22,
  62: 23, // Segunda, Ligue 2
  1: 0,
  4: 0,
  5: 0,
  9: 0,
  13: 0, // World Cup, Euros, Nations League, Copa America, Libertadores
};

const POPULAR_LEAGUE_IDS = Object.entries(POPULAR_LEAGUE_PRIORITY)
  .filter(([, priority]) => priority > 0)
  .sort((a, b) => a[1] - b[1])
  .map(([id]) => Number(id));

function popularityScore(leagueId: number, country: string): number {
  if (POPULAR_LEAGUE_PRIORITY[leagueId] !== undefined) return POPULAR_LEAGUE_PRIORITY[leagueId];
  // Big football countries get a mid-tier boost so their lower divisions still rank above obscure leagues
  const bigCountries = [
    "England",
    "Spain",
    "Italy",
    "Germany",
    "France",
    "Netherlands",
    "Portugal",
    "Belgium",
    "Turkey",
    "Greece",
    "Brazil",
    "Argentina",
    "USA",
    "Mexico",
    "Scotland",
  ];
  return bigCountries.includes(country) ? 50 : 100;
}

function safeOdd(value: string | number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
}

function normalizeTeamName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(women|woman|w|fc|cf|sc|ac|club|de|da|do|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function teamNameMatches(a: string, b: string) {
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

function normalize(
  f: AFFixture,
  odds?: { h: number | null; d: number | null; a: number | null },
): NormalizedFixture {
  // Treat odds as available whenever we have at least the two-way (home+away)
  // outcome — many women's leagues, lower divisions and regional bookmakers
  // omit the draw price. Forcing all three to be present caused valid markets
  // to be reported as "Odds unavailable".
  const hasOdds = !!odds && odds.h != null && odds.a != null;
  const hasTeams = !!f.teams?.home?.name && !!f.teams?.away?.name;
  return {
    id: `af-${f.fixture.id}`,
    leagueId: f.league.id,
    league: f.league.name,
    country: f.league.country,
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeLogo: f.teams.home.logo,
    awayLogo: f.teams.away.logo,
    kickoff: f.fixture.date,
    status: mapStatus(f.fixture.status.short),
    statusShort: f.fixture.status.short,
    homeScore: f.goals.home,
    awayScore: f.goals.away,
    elapsed: f.fixture.status.elapsed,
    oddsHome: odds?.h ?? null,
    oddsDraw: odds?.d ?? null,
    oddsAway: odds?.a ?? null,
    hasOdds,
    hasSufficientData: hasTeams && hasOdds,
  };
}

const fixturesInputSchema = z
  .object({
    leagueId: z.number().int().positive().optional(),
    season: z.number().int().min(1900).max(2200).optional(),
    country: z.string().min(2).max(60).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    onlyWithOdds: z.boolean().optional(),
    status: z.enum(["upcoming", "live", "all"]).optional(),
  })
  .optional();

const fixtureByIdInputSchema = z.object({ matchId: z.string().min(1).max(120) });

const seasonForLeague = () =>
  new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;

function apiFootballFixtureId(matchId: string): number | null {
  const raw = matchId.startsWith("af-") ? matchId.slice(3) : matchId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Concurrency-limited Promise.all
async function pMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const fetchUpcomingFixtures = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => fixturesInputSchema.parse(d))
  .handler(async ({ data }) => {
    if (!process.env.API_FOOTBALL_KEY) {
      return {
        fixtures: [] as NormalizedFixture[],
        source: "none" as const,
        error: "API_FOOTBALL_KEY not configured",
      };
    }

    const filters = data ?? {};
    const season = data?.season ?? seasonForLeague();
    const collected: AFFixture[] = [];
    const errors: string[] = [];
    const debug: SportsApiDebugEntry[] = [];
    const timezone = "UTC";

    if (filters.status === "live") {
      const r = await af<AFFixture[]>("/fixtures", { live: "all", timezone });
      debug.push(r.debug);
      if (r.ok) collected.push(...r.data);
      else errors.push(r.reason);
    } else if (filters.leagueId) {
      const params: Record<string, string | number> = filters.date
        ? { league: filters.leagueId, season, date: filters.date, timezone }
        : { league: filters.leagueId, season, next: 60, timezone };
      const r = await af<AFFixture[]>("/fixtures", params);
      debug.push(r.debug);
      if (r.ok) collected.push(...r.data);
      else errors.push(r.reason);
    } else if (filters.date) {
      const r = await af<AFFixture[]>("/fixtures", { date: filters.date, timezone });
      debug.push(r.debug);
      if (r.ok) collected.push(...r.data);
      else errors.push(r.reason);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const r = await af<AFFixture[]>("/fixtures", { date: today, timezone });
      debug.push(r.debug);
      if (r.ok) collected.push(...r.data);
      else errors.push(r.reason);
      if (collected.length < 20) {
        const popular = await pMap(POPULAR_LEAGUE_IDS.slice(0, 14), 3, async (id) =>
          af<AFFixture[]>("/fixtures", { league: id, season, next: 12, timezone }),
        );
        for (const item of popular) {
          debug.push(item.debug);
          if (item.ok) collected.push(...item.data);
          else if (!/rate limit|too many requests/i.test(item.reason)) errors.push(item.reason);
        }
      }
    }

    let filtered = collected;
    if (filters.country) {
      const want = filters.country.toLowerCase();
      filtered = filtered.filter((f) => f.league.country?.toLowerCase() === want);
    }

    // Bulk-fetch odds in 1-2 calls (vs N per-fixture calls that hit per-minute rate limit)
    let oddsMap = new Map<number, { h: number | null; d: number | null; a: number | null }>();
    try {
      if (filters.leagueId && !filters.date) {
        oddsMap = await fetchOddsByLeague(filters.leagueId, season);
      } else {
        const oddsDate = filters.date ?? new Date().toISOString().slice(0, 10);
        oddsMap = await fetchOddsByDate(oddsDate);
      }
    } catch (err) {
      console.error("[sports] bulk odds fetch failed:", err);
    }

    // Overlay live in-play odds for any currently live fixtures.
    try {
      const liveOdds = await fetchLiveOdds();
      for (const [id, o] of liveOdds) oddsMap.set(id, o);
    } catch (err) {
      console.error("[sports] live odds fetch failed:", err);
    }

    const deduped = Array.from(new Map(filtered.map((f) => [f.fixture.id, f])).values());
    // Drop finished fixtures and anything whose kickoff is already in the past
    // (unless it's currently live).
    const FINISHED = new Set(["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]);
    const nowMs = Date.now();
    const upcomingOrLive = deduped.filter((f) => {
      const short = f.fixture.status?.short ?? "";
      if (FINISHED.has(short)) return false;
      const isLive = !["NS", "TBD"].includes(short);
      if (isLive) return true; // keep live games even if kickoff < now
      return new Date(f.fixture.date).getTime() > nowMs;
    });
    let normalized = upcomingOrLive.map((f) => normalize(f, oddsMap.get(f.fixture.id)));

    // Sort: live first, then popular leagues, then by kickoff time ascending
    normalized.sort((a, b) => {
      const liveA = a.status === "live" ? 0 : 1;
      const liveB = b.status === "live" ? 0 : 1;
      if (liveA !== liveB) return liveA - liveB;
      const pa = popularityScore(a.leagueId, a.country);
      const pb = popularityScore(b.leagueId, b.country);
      if (pa !== pb) return pa - pb;
      return +new Date(a.kickoff) - +new Date(b.kickoff);
    });

    if (filters.onlyWithOdds) normalized = normalized.filter((f) => f.hasOdds);

    return {
      fixtures: normalized,
      source: "api-football" as const,
      error: errors.length ? errors[0] : null,
      debug,
    };
  });

export const fetchFixtureById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fixtureByIdInputSchema.parse(d))
  .handler(async ({ data }) => {
    const fixtureId = apiFootballFixtureId(data.matchId);
    if (!fixtureId)
      return {
        fixture: null as NormalizedFixture | null,
        source: "api-football" as const,
        error: "Invalid fixture id",
      };
    const fixture = await af<AFFixture[]>("/fixtures", { id: fixtureId, timezone: "UTC" });
    if (!fixture.ok)
      return {
        fixture: null as NormalizedFixture | null,
        source: "api-football" as const,
        error: fixture.reason,
      };
    const first = fixture.data[0];
    if (!first)
      return {
        fixture: null as NormalizedFixture | null,
        source: "api-football" as const,
        error: "Fixture not found",
      };
    const isLiveStatus = !["NS", "TBD", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"].includes(
      first.fixture.status?.short ?? "",
    );
    let odds: { h: number | null; d: number | null; a: number | null } | undefined;
    if (isLiveStatus) {
      // In-play markets — pre-match /odds endpoint returns nothing for
      // live fixtures. Query /odds/live scoped to this fixture.
      try {
        const liveRes = await af<AFOddsRow[]>("/odds/live", { fixture: fixtureId });
        if (liveRes.ok) {
          const row = liveRes.data.find((r) => r.fixture.id === fixtureId) ?? liveRes.data[0];
          if (row) {
            const o = extractMatchWinner(row);
            if (usableOddsCount(o) > 0) odds = o;
          }
        }
      } catch (err) {
        console.error("[sports] live odds for fixture failed:", err);
      }
    }
    if (!odds || usableOddsCount(odds) < 2) {
      const pre = await fetchOddsForFixture(
        fixtureId,
        first.fixture.date.slice(0, 10),
        first.league.id,
        first.league.season,
      );
      if (pre && usableOddsCount(pre) > usableOddsCount(odds)) odds = pre;
    }
    return {
      fixture: normalize(first, odds),
      source: "api-football" as const,
      error: null,
    };
  });

const searchFixturesSchema = z.object({ query: z.string().min(2).max(60) });

interface AFTeam {
  team: { id: number; name: string; logo: string };
  // country/founded/etc not needed
}

export const searchFixtures = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => searchFixturesSchema.parse(d))
  .handler(async ({ data }) => {
    if (!process.env.API_FOOTBALL_KEY) {
      return { fixtures: [] as NormalizedFixture[], error: "API_FOOTBALL_KEY not configured" };
    }
    const teamsRes = await af<AFTeam[]>("/teams", { search: data.query });
    if (!teamsRes.ok) return { fixtures: [], error: teamsRes.reason };
    const teamIds = teamsRes.data.slice(0, 6).map((t) => t.team.id);
    if (!teamIds.length) return { fixtures: [], error: null };

    const results = await pMap(teamIds, 3, (id) =>
      af<AFFixture[]>("/fixtures", { team: id, next: 10, timezone: "UTC" }),
    );
    const collected: AFFixture[] = [];
    for (const r of results) if (r.ok) collected.push(...r.data);

    const FINISHED = new Set(["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]);
    const nowMs = Date.now();
    const upcoming = Array.from(new Map(collected.map((f) => [f.fixture.id, f])).values()).filter(
      (f) => {
        const s = f.fixture.status?.short ?? "";
        if (FINISHED.has(s)) return false;
        if (["NS", "TBD"].includes(s)) return new Date(f.fixture.date).getTime() > nowMs;
        return true;
      },
    );

    let oddsMap = new Map<number, { h: number | null; d: number | null; a: number | null }>();
    try {
      const dates = Array.from(new Set(upcoming.map((f) => f.fixture.date.slice(0, 10)))).slice(0, 4);
      const oddsResults = await pMap(dates, 2, (d) => fetchOddsByDate(d));
      for (const m of oddsResults) for (const [k, v] of m) oddsMap.set(k, v);
    } catch (err) {
      console.error("[sports] search odds fetch failed:", err);
    }

    const fixtures = upcoming
      .map((f) => normalize(f, oddsMap.get(f.fixture.id)))
      .sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));
    return { fixtures, error: null };
  });

export const fetchLeagues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
  if (!process.env.API_FOOTBALL_KEY) {
    return {
      leagues: [] as NormalizedLeague[],
      countries: [] as string[],
      error: "API_FOOTBALL_KEY not configured",
    };
  }
  const r = await af<AFLeague[]>("/leagues", { current: "true" });
  if (!r.ok) return { leagues: [], countries: [], error: r.reason };
  const leagues: NormalizedLeague[] = r.data
    .map((l) => {
      const cur = l.seasons.find((s) => s.current) ?? l.seasons[l.seasons.length - 1];
      return {
        id: l.league.id,
        name: l.league.name,
        country: l.country.name,
        logo: l.league.logo,
        flag: l.country.flag,
        type: l.league.type,
        season: cur?.year ?? seasonForLeague(),
      };
    })
    .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  const countries = Array.from(new Set(leagues.map((l) => l.country))).sort();
  return { leagues, countries, error: null };
});

export const getSportsApiDebug = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const season = seasonForLeague();
    const entries: SportsApiDebugEntry[] = [];
    const status = await af<unknown>("/status", {});
    entries.push(status.debug);
    const leagues = await af<AFLeague[]>("/leagues", { current: "true" });
    entries.push(leagues.debug);
    const fixtures = await af<AFFixture[]>("/fixtures", { date: today, timezone: "UTC" });
    entries.push(fixtures.debug);
    const sampleFixture = fixtures.ok ? fixtures.data.find((f) => f.fixture?.id)?.fixture.id : null;
    if (sampleFixture)
      entries.push((await af<unknown[]>("/odds", { fixture: sampleFixture, bet: 1 })).debug);
    else
      entries.push(
        (await af<AFFixture[]>("/fixtures", { league: 39, season, next: 1, timezone: "UTC" }))
          .debug,
      );
    return {
      keyConfigured: !!process.env.API_FOOTBALL_KEY,
      keyLength: process.env.API_FOOTBALL_KEY?.length ?? 0,
      timezone: "UTC",
      entries,
    };
  });

export const fetchLiveFixtures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    if (!process.env.API_FOOTBALL_KEY) {
      return {
        fixtures: [] as NormalizedFixture[],
        source: "none" as const,
        error: "API_FOOTBALL_KEY not configured",
      };
    }
    const r = await af<AFFixture[]>("/fixtures", { live: "all" });
    if (!r.ok) return { fixtures: [], source: "api-football" as const, error: r.reason };
    return {
      fixtures: r.data.slice(0, 30).map((f) => normalize(f)),
      source: "api-football" as const,
      error: null,
    };
  });

// Odds movement via The Odds API — current snapshot across multiple bookmakers
const oddsSnapshotSchema = z.object({
  homeTeam: z.string().min(1).max(100),
  awayTeam: z.string().min(1).max(100),
  kickoffISO: z.string().min(1).max(40).optional(),
});

export const fetchOddsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => oddsSnapshotSchema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.ODDS_API_KEY;
    if (!key) {
      return {
        books: [] as Array<{
          book: string;
          home: number | null;
          draw: number | null;
          away: number | null;
          lastUpdate: string;
        }>,
        source: "none" as const,
        error: "ODDS_API_KEY not configured",
      };
    }
    const sportKeys = [
      "soccer_epl",
      "soccer_spain_la_liga",
      "soccer_italy_serie_a",
      "soccer_germany_bundesliga",
      "soccer_france_ligue_one",
      "soccer_uefa_champs_league",
    ];

    type Event = {
      home_team: string;
      away_team: string;
      commence_time: string;
      bookmakers: Array<{
        key: string;
        title: string;
        last_update: string;
        markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>;
      }>;
    };
    let lastError: string | null = null;
    for (const sk of sportKeys) {
      const u = new URL(`${ODDS_BASE}/sports/${sk}/odds`);
      u.searchParams.set("apiKey", key);
      u.searchParams.set("regions", "eu,uk");
      u.searchParams.set("markets", "h2h");
      u.searchParams.set("oddsFormat", "decimal");
      const res = await fetch(u);
      if (!res.ok) {
        lastError = `Odds API ${sk} → ${res.status}`;
        console.error(`[sports] ${lastError}`);
        continue;
      }
      const events = (await res.json()) as Event[];
      const match = events.find(
        (e) =>
          (teamNameMatches(e.home_team, data.homeTeam) && teamNameMatches(e.away_team, data.awayTeam)) ||
          (teamNameMatches(e.home_team, data.awayTeam) && teamNameMatches(e.away_team, data.homeTeam)),
      );
      if (!match) continue;
      const books = (match.bookmakers ?? [])
        .slice(0, 8)
        .map((b) => {
          const m = b.markets.find((x) => x.key === "h2h");
          const get = (n: string) =>
            safeOdd(m?.outcomes.find((o) => teamNameMatches(o.name, n))?.price);
          return {
            book: b.title,
            home: get(match.home_team),
            draw: safeOdd(m?.outcomes.find((o) => normalizeTeamName(o.name) === "draw")?.price),
            away: get(match.away_team),
            lastUpdate: b.last_update,
          };
        })
        .filter((b) => b.home != null || b.draw != null || b.away != null);
      if (books.length > 0) {
        return { books, source: "the-odds-api" as const, error: null };
      }
      lastError = `Odds API ${sk}: matched fixture but no usable bookmakers`;
      console.warn(`[sports] ${lastError}`);
    }

    // SportMonks fallback — covers leagues The Odds API misses (e.g. some
    // Bundesliga windows, lower divisions). Surfaced as one verified row so
    // the UI never says "no live market data" when SportMonks has prices.
    try {
      const { getSportMonksOdds } = await import("./sportmonks.server");
      const kickoffISO = data.kickoffISO ?? new Date().toISOString();
      const sm = await getSportMonksOdds(data.homeTeam, data.awayTeam, kickoffISO);
      if (sm && (sm.home || sm.draw || sm.away)) {
        console.log(`[sports] odds-snapshot via sportmonks fallback: h=${sm.home} d=${sm.draw} a=${sm.away}`);
        return {
          books: [{
            book: "SportMonks (verified)",
            home: sm.home,
            draw: sm.draw,
            away: sm.away,
            lastUpdate: new Date().toISOString(),
          }],
          source: "sportmonks" as const,
          error: null,
        };
      }
      console.warn(`[sports] odds-snapshot: SportMonks fallback returned no usable odds for ${data.homeTeam} vs ${data.awayTeam}`);
    } catch (err) {
      console.warn(`[sports] odds-snapshot: SportMonks fallback errored:`, err instanceof Error ? err.message : err);
    }

    return { books: [], source: "the-odds-api" as const, error: lastError };
  });
