import { createServerFn } from "@tanstack/react-start";

const AF_BASE = "https://v3.football.api-sports.io";
let cache: { value: number; expiresAt: number } | null = null;
const CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAYS = 14;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function countDay(key: string, date: string): Promise<number> {
  try {
    const url = new URL(`${AF_BASE}/fixtures`);
    url.searchParams.set("date", date);
    url.searchParams.set("timezone", "UTC");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(url, { headers: { "x-apisports-key": key }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return 0;
    const json = (await res.json()) as { response?: unknown[] };
    return Array.isArray(json?.response) ? json.response.length : 0;
  } catch (err) {
    console.warn("[tracked-matches] day failed", date, err instanceof Error ? err.message : err);
    return 0;
  }
}

// Counts real fixtures from API-Football across the next 14 days.
// API-Football's /fixtures endpoint does NOT accept from/to without a league
// or team filter, so we fan out one request per day. Cached server-side for
// 2 hours to keep API quota usage tiny (~168 requests/day).
export const getTrackedMatchesCount = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && cache.expiresAt > Date.now()) {
    return { count: cache.value };
  }
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return { count: 0 };

  try {
    const today = new Date();
    const dates = Array.from({ length: DAYS }, (_, i) =>
      ymd(new Date(today.getTime() + i * 86_400_000)),
    );
    const results = await Promise.all(dates.map((d) => countDay(key, d)));
    const total = results.reduce((a, b) => a + b, 0);
    if (total > 0) {
      cache = { value: total, expiresAt: Date.now() + CACHE_MS };
    }
    return { count: total || cache?.value || 0 };
  } catch (err) {
    console.error("getTrackedMatchesCount failed:", err);
    return { count: cache?.value ?? 0 };
  }
});
