import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";

const AF_BASE = "https://v3.football.api-sports.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

export type DiagStatus = "ok" | "missing" | "empty" | "error" | "rate_limited";

export interface DiagCheck {
  key: string;
  label: string;
  status: DiagStatus;
  detail: string;
  meta?: Record<string, string | number | boolean | null>;
}

const inputSchema = z.object({
  fixtureId: z.string().min(1).max(120).optional(),
  homeTeam: z.string().min(1).max(120).optional(),
  awayTeam: z.string().min(1).max(120).optional(),
  league: z.string().min(1).max(120).optional(),
});

function parseFixtureId(matchId?: string): number | null {
  if (!matchId) return null;
  const raw = matchId.startsWith("af-") ? matchId.slice(3) : matchId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

interface AFCallResult<T> {
  status: number | null;
  ok: boolean;
  rateLimited: boolean;
  data: T | null;
  errors: string | null;
  message: string | null;
  count: number | null;
  rawPreview: string;
}

async function afCall<T>(
  path: string,
  params: Record<string, string | number>,
  reqId: string,
): Promise<AFCallResult<T> | { missingKey: true }> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return { missingKey: true };
  const url = new URL(`${AF_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "x-apisports-key": key }, signal: ctrl.signal });
    const body = await res.text().catch(() => "");
    let json: { response?: T; errors?: unknown; message?: string } | null = null;
    try { json = JSON.parse(body); } catch { json = null; }
    const errors =
      json?.errors && typeof json.errors === "object" && Object.keys(json.errors).length > 0
        ? JSON.stringify(json.errors).slice(0, 300)
        : null;
    const count = Array.isArray(json?.response) ? json!.response!.length : null;
    console.log(`[diag ${reqId}] AF ${path} ${res.status} count=${count} errors=${errors ?? "none"} body=${body.slice(0, 400)}`);
    return {
      status: res.status,
      ok: res.ok && !errors,
      rateLimited: res.status === 429 || /rate|quota/i.test(errors ?? ""),
      data: (json?.response ?? null) as T | null,
      errors,
      message: json?.message ?? null,
      count,
      rawPreview: body.slice(0, 400),
    };
  } catch (err) {
    console.error(`[diag ${reqId}] AF ${path} threw`, err);
    return {
      status: null,
      ok: false,
      rateLimited: false,
      data: null,
      errors: err instanceof Error ? err.message : "fetch failed",
      message: null,
      count: null,
      rawPreview: "",
    };
  } finally {
    clearTimeout(t);
  }
}

interface AFFixture {
  fixture: { id: number };
  league: { id?: number; name: string; season?: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

function classifyAF<T>(
  res: AFCallResult<T> | { missingKey: true },
): { status: DiagStatus; detail: string } {
  if ("missingKey" in res) return { status: "missing", detail: "API key not configured" };
  if (res.rateLimited) return { status: "rate_limited", detail: res.errors ?? "rate limit / quota" };
  if (!res.ok) return { status: "error", detail: `HTTP ${res.status ?? "?"} ${res.errors ?? res.message ?? ""}`.trim() };
  if (res.count === 0 || res.data == null) return { status: "empty", detail: "No rows returned" };
  return { status: "ok", detail: `${res.count} row${res.count === 1 ? "" : "s"}` };
}

export const runFixtureDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const reqId = Math.random().toString(36).slice(2, 8);
    const checks: DiagCheck[] = [];
    const tz = "Europe/Athens";
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

    console.log(`[diag ${reqId}] start fixtureId=${data.fixtureId ?? "—"} home="${data.homeTeam ?? ""}" away="${data.awayTeam ?? ""}" league="${data.league ?? ""}"`);

    // 1. Key statuses
    const afKey = process.env.API_FOOTBALL_KEY;
    const oddsKey = process.env.ODDS_API_KEY;
    checks.push({
      key: "af_key",
      label: "API-Football key",
      status: afKey ? "ok" : "missing",
      detail: afKey ? `configured (length ${afKey.length})` : "API_FOOTBALL_KEY not set",
    });
    checks.push({
      key: "odds_key",
      label: "Odds API key",
      status: oddsKey ? "ok" : "missing",
      detail: oddsKey ? `configured (length ${oddsKey.length})` : "ODDS_API_KEY not set",
    });

    // 2. Selected fixture id
    const fixtureNum = parseFixtureId(data.fixtureId);
    checks.push({
      key: "fixture_id",
      label: "Selected fixture id",
      status: fixtureNum ? "ok" : "missing",
      detail: fixtureNum ? String(fixtureNum) : `Invalid or missing (${data.fixtureId ?? "—"})`,
    });

    // 3. Timezone / date used
    checks.push({
      key: "timezone",
      label: "Timezone / date",
      status: "ok",
      detail: `${tz} — ${dateStr} ${now.toISOString()}`,
    });

    // 4. API-Football fixture lookup
    let homeId: number | null = null;
    let awayId: number | null = null;
    let leagueId: number | undefined;
    let leagueSeason: number | undefined;
    if (afKey && fixtureNum) {
      const fx = await afCall<AFFixture[]>("/fixtures", { id: fixtureNum }, reqId);
      const cls = classifyAF(fx);
      checks.push({
        key: "fixture_fetch",
        label: "API-Football fixture fetch",
        status: cls.status,
        detail: cls.detail,
      });
      if (!("missingKey" in fx) && fx.data?.[0]) {
        homeId = fx.data[0].teams.home.id;
        awayId = fx.data[0].teams.away.id;
        leagueId = fx.data[0].league.id;
        leagueSeason = fx.data[0].league.season;
      }
    } else {
      checks.push({
        key: "fixture_fetch",
        label: "API-Football fixture fetch",
        status: "missing",
        detail: "Skipped (no key or no fixture id)",
      });
    }

    checks.push({
      key: "team_ids",
      label: "Team ids found",
      status: homeId && awayId ? "ok" : homeId || awayId ? "empty" : "missing",
      detail: `home=${homeId ?? "—"} away=${awayId ?? "—"}`,
      meta: { leagueId: leagueId ?? null, leagueSeason: leagueSeason ?? null },
    });

    // 5. Form (last 5)
    if (afKey && (homeId || awayId)) {
      const [homeForm, awayForm] = await Promise.all([
        homeId ? afCall<unknown[]>("/fixtures", { team: homeId, last: 5 }, reqId) : Promise.resolve({ missingKey: false, status: null, ok: false, rateLimited: false, data: null, errors: "no home id", message: null, count: null, rawPreview: "" } as AFCallResult<unknown[]>),
        awayId ? afCall<unknown[]>("/fixtures", { team: awayId, last: 5 }, reqId) : Promise.resolve({ missingKey: false, status: null, ok: false, rateLimited: false, data: null, errors: "no away id", message: null, count: null, rawPreview: "" } as AFCallResult<unknown[]>),
      ]);
      const h = classifyAF(homeForm);
      const a = classifyAF(awayForm);
      const worst: DiagStatus =
        h.status === "ok" && a.status === "ok" ? "ok"
          : h.status === "rate_limited" || a.status === "rate_limited" ? "rate_limited"
          : h.status === "error" || a.status === "error" ? "error"
          : h.status === "empty" || a.status === "empty" ? "empty"
          : "missing";
      checks.push({ key: "form", label: "Form data (last 5)", status: worst, detail: `home: ${h.detail} · away: ${a.detail}` });
    } else {
      checks.push({ key: "form", label: "Form data (last 5)", status: "missing", detail: "No team ids" });
    }

    // 6. Standings
    if (afKey && leagueId && leagueSeason) {
      const st = await afCall<unknown[]>("/standings", { league: leagueId, season: leagueSeason }, reqId);
      const cls = classifyAF(st);
      checks.push({ key: "standings", label: "Standings", status: cls.status, detail: cls.detail });
    } else {
      checks.push({ key: "standings", label: "Standings", status: "missing", detail: "No leagueId/season" });
    }

    // 7. Injuries
    if (afKey && (homeId || awayId)) {
      const [hi, ai] = await Promise.all([
        homeId ? afCall<unknown[]>("/injuries", { team: homeId }, reqId) : Promise.resolve(null),
        awayId ? afCall<unknown[]>("/injuries", { team: awayId }, reqId) : Promise.resolve(null),
      ]);
      const parts = [hi, ai].filter(Boolean) as AFCallResult<unknown[]>[];
      const total = parts.reduce((s, p) => s + (p.count ?? 0), 0);
      const anyErr = parts.find((p) => !p.ok && !p.rateLimited);
      const anyRL = parts.find((p) => p.rateLimited);
      const status: DiagStatus = anyRL ? "rate_limited" : anyErr ? "error" : total > 0 ? "ok" : "empty";
      checks.push({ key: "injuries", label: "Injuries / suspensions", status, detail: `${total} entr${total === 1 ? "y" : "ies"}` });
    } else {
      checks.push({ key: "injuries", label: "Injuries / suspensions", status: "missing", detail: "No team ids" });
    }

    // 8. H2H
    if (afKey && homeId && awayId) {
      const r = await afCall<unknown[]>("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 5 }, reqId);
      const cls = classifyAF(r);
      checks.push({ key: "h2h", label: "Head-to-head", status: cls.status, detail: cls.detail });
    } else {
      checks.push({ key: "h2h", label: "Head-to-head", status: "missing", detail: "Need both team ids" });
    }

    // 9. Odds API match
    let oddsMatched = false;
    let oddsDetail = "Skipped";
    let oddsStatus: DiagStatus = "missing";
    if (oddsKey && data.homeTeam && data.awayTeam) {
      const sport = guessSport(data.league);
      if (!sport) {
        oddsStatus = "missing";
        oddsDetail = `No sport key mapping for league "${data.league ?? "—"}"`;
      } else {
        const u = new URL(`${ODDS_BASE}/sports/${sport}/odds`);
        u.searchParams.set("apiKey", oddsKey);
        u.searchParams.set("regions", "eu,uk");
        u.searchParams.set("markets", "h2h");
        u.searchParams.set("oddsFormat", "decimal");
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        try {
          const res = await fetch(u, { signal: ctrl.signal });
          const body = await res.text().catch(() => "");
          console.log(`[diag ${reqId}] Odds ${sport} ${res.status} body=${body.slice(0, 400)}`);
          if (res.status === 429) {
            oddsStatus = "rate_limited";
            oddsDetail = "Odds API rate limit";
          } else if (!res.ok) {
            oddsStatus = "error";
            oddsDetail = `HTTP ${res.status}`;
          } else {
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
            const want = [norm(data.homeTeam), norm(data.awayTeam)];
            const events: Array<{ home_team: string; away_team: string }> = JSON.parse(body || "[]");
            const match = events.find((e) => want.includes(norm(e.home_team)) && want.includes(norm(e.away_team)));
            oddsMatched = !!match;
            oddsStatus = match ? "ok" : "empty";
            oddsDetail = match
              ? `Matched ${match.home_team} vs ${match.away_team}`
              : `${events.length} events scanned, no team-name match`;
          }
        } catch (err) {
          oddsStatus = "error";
          oddsDetail = err instanceof Error ? err.message : "fetch failed";
          console.error(`[diag ${reqId}] Odds threw`, err);
        } finally {
          clearTimeout(t);
        }
      }
    } else if (!oddsKey) {
      oddsDetail = "ODDS_API_KEY not set";
    } else {
      oddsDetail = "Missing team names";
    }
    checks.push({ key: "odds_match", label: "Odds API match", status: oddsStatus, detail: oddsDetail });
    checks.push({
      key: "team_name_match",
      label: "Team name matching",
      status: oddsMatched ? "ok" : oddsStatus === "ok" ? "empty" : "missing",
      detail: oddsMatched ? "Normalized name match succeeded" : "No match in odds feed",
    });

    // Quota / rate-limit aggregate
    const rateLimited = checks.some((c) => c.status === "rate_limited");
    checks.push({
      key: "quota",
      label: "Quota / rate-limit",
      status: rateLimited ? "rate_limited" : "ok",
      detail: rateLimited ? "One or more providers reported rate limit" : "No rate-limit errors detected",
    });

    console.log(`[diag ${reqId}] done checks=${checks.length}`);
    return { reqId, generatedAt: new Date().toISOString(), checks };
  });

function guessSport(league?: string): string | null {
  const l = (league ?? "").toLowerCase();
  if (/premier league|england/.test(l)) return "soccer_epl";
  if (/la liga|spain/.test(l)) return "soccer_spain_la_liga";
  if (/serie a|italy/.test(l)) return "soccer_italy_serie_a";
  if (/bundesliga|germany/.test(l)) return "soccer_germany_bundesliga";
  if (/ligue 1|france/.test(l)) return "soccer_france_ligue_one";
  if (/champions league|uefa/.test(l)) return "soccer_uefa_champs_league";
  return null;
}
