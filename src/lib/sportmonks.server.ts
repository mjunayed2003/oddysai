/**
 * SportMonks Football API — fallback enrichment source.
 *
 * Used to fill gaps in API-Football data (head-to-head history, odds, etc.)
 * Auth: api_token query parameter.
 * Docs: https://docs.sportmonks.com/football
 *
 * Server-only. Never import this from client bundles.
 */

const BASE = "https://api.sportmonks.com/v3/football";
const TIMEOUT_MS = 5_000;

function getKey(): string | null {
  return process.env.SPORTS_API_KEY ?? process.env.SPORTMONKS_API_KEY ?? null;
}

async function sm<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T | null> {
  const key = getKey();
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_token", key);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[sportmonks] ${path} failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data?: T };
    return (json?.data ?? null) as T | null;
  } catch (err) {
    console.warn(`[sportmonks] ${path} error:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|sc|cf|ac|club|de|do|da|of|the|women|w|wfc|reserves|ii|u\d+)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function teamSearchTerms(teamName: string): string[] {
  const cleaned = teamName
    .replace(/\bF\.?C\.?\b/gi, " ")
    .replace(/\bMinsk\s+R\.?\b/gi, "Minsk")
    .replace(/\bR\.?\b$/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 4);
  return Array.from(new Set([
    teamName.trim(),
    cleaned,
    cleaned.replace(/\bMinsk\b/gi, "").trim(),
    tokens[0] ?? "",
  ].filter((t) => t.length >= 3)));
}

function fuzzyMatch(a: string, b: string) {
  const x = normalize(a);
  const y = normalize(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

export interface SmTeam { id: number; name: string }

export async function findSportMonksTeamId(teamName: string): Promise<SmTeam | null> {
  if (!getKey()) return null;
  for (const candidate of teamSearchTerms(teamName)) {
    const term = encodeURIComponent(candidate);
    const data = await sm<Array<{ id: number; name: string }>>(
      `/teams/search/${term}`,
    );
    if (!Array.isArray(data) || data.length === 0) continue;
    const exact = data.find((t) => normalize(t.name) === normalize(teamName) || normalize(t.name) === normalize(candidate));
    const partial = exact ?? data.find((t) => fuzzyMatch(t.name, teamName) || fuzzyMatch(t.name, candidate));
    return partial ?? data[0];
  }
  return null;
}

export interface SmH2HEntry {
  date: string;
  score: string;
  home: string;
  away: string;
}

interface SmFixtureRow {
  id: number;
  starting_at?: string;
  result_info?: string | null;
  participants?: Array<{ id: number; name: string; meta?: { location?: "home" | "away" } }>;
  scores?: Array<{
    score?: { goals?: number; participant?: "home" | "away" };
    description?: string;
  }>;
}

function extractScore(row: SmFixtureRow): { home: number | null; away: number | null } {
  const final = (row.scores ?? []).filter(
    (s) => s.description === "CURRENT" || s.description === "FT" || s.description === "2ND_HALF",
  );
  let home: number | null = null;
  let away: number | null = null;
  for (const s of final) {
    if (s.score?.participant === "home" && typeof s.score.goals === "number") home = s.score.goals;
    if (s.score?.participant === "away" && typeof s.score.goals === "number") away = s.score.goals;
  }
  return { home, away };
}

export async function getSportMonksH2H(
  homeTeamName: string,
  awayTeamName: string,
  beforeKickoffMs: number,
  limit = 5,
): Promise<SmH2HEntry[]> {
  if (!getKey()) return [];
  const [home, away] = await Promise.all([
    findSportMonksTeamId(homeTeamName),
    findSportMonksTeamId(awayTeamName),
  ]);
  if (!home || !away) return [];
  const rows = await sm<SmFixtureRow[]>(
    `/fixtures/head-to-head/${home.id}/${away.id}`,
    { include: "participants;scores" },
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => {
      if (!r.starting_at) return false;
      const t = Date.parse(r.starting_at);
      return Number.isFinite(t) && t < beforeKickoffMs;
    })
    .map((r) => {
      const { home: hg, away: ag } = extractScore(r);
      if (hg == null || ag == null) return null;
      const homeP = r.participants?.find((p) => p.meta?.location === "home");
      const awayP = r.participants?.find((p) => p.meta?.location === "away");
      return {
        date: r.starting_at!.slice(0, 10),
        score: `${hg}-${ag}`,
        home: homeP?.name ?? home.name,
        away: awayP?.name ?? away.name,
      } satisfies SmH2HEntry;
    })
    .filter((x): x is SmH2HEntry => x !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

export interface SmOdds { home: number | null; draw: number | null; away: number | null }

interface SmOddsRow {
  market_id?: number;
  market_description?: string;
  label?: string; // "1" | "X" | "2" | "Home" | "Draw" | "Away"
  original_label?: string | null;
  name?: string | null;
  value?: string | number;
}

function isSameFixtureByTeams(f: SmFixtureRow, home: SmTeam, away: SmTeam) {
  const participants = f.participants ?? [];
  const ids = participants.map((p) => p.id);
  if (ids.includes(home.id) && ids.includes(away.id)) return true;
  return participants.some((p) => fuzzyMatch(p.name, home.name)) && participants.some((p) => fuzzyMatch(p.name, away.name));
}

/**
 * Fetch 1X2 odds for a fixture by searching SportMonks for the kickoff date
 * and matching team names. Returns null if no usable price is found.
 */
export async function getSportMonksOdds(
  homeTeamName: string,
  awayTeamName: string,
  kickoffISO: string,
): Promise<SmOdds | null> {
  if (!getKey()) {
    console.warn("[sportmonks] odds skipped: no SPORTS_API_KEY");
    return null;
  }
  const date = kickoffISO.slice(0, 10);
  const [home, away] = await Promise.all([
    findSportMonksTeamId(homeTeamName),
    findSportMonksTeamId(awayTeamName),
  ]);
  if (!home || !away) {
    console.warn(`[sportmonks] odds skipped: team lookup failed (home=${!!home} away=${!!away}) for "${homeTeamName}" vs "${awayTeamName}"`);
    return null;
  }

  // Cross-day window (kickoff date can shift by TZ at SportMonks' end).
  const day = new Date(date + "T00:00:00Z");
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const prev = new Date(day.getTime() - 86_400_000);
  const next = new Date(day.getTime() + 86_400_000);
  const fixtures = await sm<SmFixtureRow[]>(
    `/fixtures/between/${ymd(prev)}/${ymd(next)}`,
    { include: "participants" },
  );
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    console.warn(`[sportmonks] odds: no fixtures found in window ${ymd(prev)}..${ymd(next)}`);
    return null;
  }
  const fixture = fixtures.find((f) => isSameFixtureByTeams(f, home, away));
  if (!fixture) {
    console.warn(`[sportmonks] odds: fixture not matched for ${home.name}(${home.id}) vs ${away.name}(${away.id}) in ${fixtures.length} candidates`);
    return null;
  }

  const odds = await sm<SmOddsRow[]>(`/odds/pre-match/fixtures/${fixture.id}`);
  if (!Array.isArray(odds) || odds.length === 0) {
    console.warn(`[sportmonks] odds: empty payload for fixture ${fixture.id}`);
    return null;
  }

  const matchWinner = odds.filter(
    (o) =>
      o.market_id === 1 ||
      /match\s*winner|full\s*time\s*result|fulltime\s*result|1x2|moneyline|three[\s-]?way/i.test(o.market_description ?? ""),
  );
  if (matchWinner.length === 0) {
    const sample = odds.slice(0, 3).map((o) => `${o.market_id}/${o.market_description}/${o.label}`).join(" | ");
    console.warn(`[sportmonks] odds: no 1X2 market in ${odds.length} rows. sample=${sample}`);
    return null;
  }

  const pickAvg = (matchKey: RegExp): number | null => {
    const prices = matchWinner
      .filter((o) => [o.label, o.original_label, o.name].some((v) => matchKey.test(String(v ?? ""))))
      .map((o) => Number(o.value))
      .filter((n) => Number.isFinite(n) && n > 1);
    if (prices.length === 0) return null;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return Math.round(avg * 100) / 100;
  };

  const result: SmOdds = {
    home: pickAvg(/^(1|home|home\s*team)$/i),
    draw: pickAvg(/^(x|draw|tie)$/i),
    away: pickAvg(/^(2|away|away\s*team)$/i),
  };
  if (!result.home && !result.draw && !result.away) {
    const labels = Array.from(new Set(matchWinner.map((o) => String(o.label ?? "")))).slice(0, 6).join(", ");
    console.warn(`[sportmonks] odds: 1X2 labels not parseable. labels=[${labels}]`);
    return null;
  }
  console.log(`[sportmonks] odds OK fixture=${fixture.id} h=${result.home} d=${result.draw} a=${result.away}`);
  return result;
}

// ============================================================
// Unified fixture-context fetch — used as enrichment alongside
// API-Football. Pulls venue, lineups, injuries (sidelined), and
// predictions in a single batched call.
// ============================================================

export interface SmInjury { player: string; team: string; reason?: string | null }
export interface SmLineup { team: string; formation: string | null; starters: number }
export interface SmVenue { name: string; city: string | null }
export interface SmPredictionWinner { home: number | null; draw: number | null; away: number | null }

export interface SmFixtureContext {
  fixtureId: number | null;
  venue: SmVenue | null;
  lineups: SmLineup[];
  injuries: { home: SmInjury[]; away: SmInjury[] };
  prediction: SmPredictionWinner | null;
  homeTeam: SmTeam | null;
  awayTeam: SmTeam | null;
}

interface SmFixtureFull extends SmFixtureRow {
  venue?: { name?: string; city_name?: string | null } | null;
  lineups?: Array<{
    team_id?: number;
    formation?: string | null;
    type?: { developer_name?: string }; // STARTING_LINEUP / SUBSTITUTE
  }>;
  sidelined?: Array<{
    player_id?: number;
    player?: { display_name?: string; name?: string };
    team_id?: number;
    type?: { name?: string } | null;
  }>;
  predictions?: Array<{
    type?: { developer_name?: string }; // FULLTIME_RESULT_PROBABILITY
    predictions?: { home?: number; draw?: number; away?: number };
  }>;
}

export async function getSportMonksFixtureContext(
  homeTeamName: string,
  awayTeamName: string,
  kickoffISO: string,
): Promise<SmFixtureContext | null> {
  if (!getKey()) return null;
  const date = kickoffISO.slice(0, 10);
  const [home, away] = await Promise.all([
    findSportMonksTeamId(homeTeamName),
    findSportMonksTeamId(awayTeamName),
  ]);
  if (!home || !away) return null;

  const day = new Date(date + "T00:00:00Z");
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const prev = new Date(day.getTime() - 86_400_000);
  const next = new Date(day.getTime() + 86_400_000);
  const fixtures = await sm<SmFixtureFull[]>(
    `/fixtures/between/${ymd(prev)}/${ymd(next)}`,
    { include: "participants;venue;lineups;sidelined;predictions" },
  );
  if (!Array.isArray(fixtures)) return null;
  const fixture = fixtures.find((f) => isSameFixtureByTeams(f, home, away));
  if (!fixture) return null;

  const venue: SmVenue | null = fixture.venue?.name
    ? { name: fixture.venue.name, city: fixture.venue.city_name ?? null }
    : null;

  const lineups: SmLineup[] = [];
  const startingByTeam: Record<number, number> = {};
  let homeFormation: string | null = null;
  let awayFormation: string | null = null;
  for (const l of fixture.lineups ?? []) {
    if (l.type?.developer_name && l.type.developer_name !== "STARTING_LINEUP") continue;
    if (typeof l.team_id !== "number") continue;
    startingByTeam[l.team_id] = (startingByTeam[l.team_id] ?? 0) + 1;
    if (l.team_id === home.id && l.formation) homeFormation = l.formation;
    if (l.team_id === away.id && l.formation) awayFormation = l.formation;
  }
  if (startingByTeam[home.id]) {
    lineups.push({ team: home.name, formation: homeFormation, starters: startingByTeam[home.id] });
  }
  if (startingByTeam[away.id]) {
    lineups.push({ team: away.name, formation: awayFormation, starters: startingByTeam[away.id] });
  }

  const injuriesHome: SmInjury[] = [];
  const injuriesAway: SmInjury[] = [];
  for (const s of fixture.sidelined ?? []) {
    const playerName = s.player?.display_name ?? s.player?.name;
    if (!playerName) continue;
    const entry: SmInjury = { player: playerName, team: "", reason: s.type?.name ?? null };
    if (s.team_id === home.id) injuriesHome.push({ ...entry, team: home.name });
    else if (s.team_id === away.id) injuriesAway.push({ ...entry, team: away.name });
  }

  let prediction: SmPredictionWinner | null = null;
  for (const p of fixture.predictions ?? []) {
    if (p.type?.developer_name === "FULLTIME_RESULT_PROBABILITY" && p.predictions) {
      prediction = {
        home: typeof p.predictions.home === "number" ? p.predictions.home : null,
        draw: typeof p.predictions.draw === "number" ? p.predictions.draw : null,
        away: typeof p.predictions.away === "number" ? p.predictions.away : null,
      };
      break;
    }
  }

  return {
    fixtureId: fixture.id,
    venue,
    lineups,
    injuries: { home: injuriesHome.slice(0, 8), away: injuriesAway.slice(0, 8) },
    prediction,
    homeTeam: home,
    awayTeam: away,
  };
}
