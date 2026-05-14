import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Radio,
  Loader2,
  Database,
  Clock,
  RefreshCw,
  CheckCircle2,
  Circle,
  Info,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { generateMatchAnalysis } from "@/lib/ai-analysis.functions";
import { confirmAnalysisUnlock } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { RiskBadge, ValueBadge } from "@/components/analysis-badges";
import { AnalysisUnlockCard } from "@/components/analysis-unlock-card";
import { OddsSpread } from "@/components/odds-spread";
import { fetchUpcomingFixtures, fetchLeagues, fetchFixtureById, searchFixtures } from "@/lib/sports.functions";
import type { AIAnalysisResult } from "@/lib/types";
import { format } from "date-fns";
import { z } from "zod";

const searchSchema = z.object({
  matchId: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  league: z.string().optional(),
  kickoff: z.string().optional(),
  source: z.string().optional(),
  unlock: z.string().optional(),
  session_id: z.string().optional(),
});
const ANALYSIS_UI_TIMEOUT_MS = 45_000;

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

function buildOddsAnalysis(
  match: {
    id: string;
    home_team: string;
    away_team: string;
    league: string;
    odds_home: number | null;
    odds_draw: number | null;
    odds_away: number | null;
  },
  bankrollValue: number,
  maxStakePctValue: number,
): AIAnalysisResult | undefined {
  const home = Number(match.odds_home);
  const draw = Number(match.odds_draw);
  const away = Number(match.odds_away);
  const hasMarketOdds = [home, draw, away].every((odd) => Number.isFinite(odd) && odd > 1);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const seededLean =
    [...`${match.home_team}|${match.away_team}|${match.league}`].reduce(
      (sum, ch) => sum + ch.charCodeAt(0),
      0,
    ) % 9;
  const [probHome, probDraw, probAway] = hasMarketOdds
    ? (() => {
        const invHome = 1 / home;
        const invDraw = 1 / draw;
        const invAway = 1 / away;
        const total = invHome + invDraw + invAway;
        const pHome = round2((invHome / total) * 100);
        const pDraw = round2((invDraw / total) * 100);
        return [pHome, pDraw, round2(100 - pHome - pDraw)];
      })()
    : [round2(38 + seededLean), 30, round2(32 - seededLean)];
  const best = [
    { market: "home" as const, label: `${match.home_team} Win`, prob: probHome },
    { market: "draw" as const, label: "Draw", prob: probDraw },
    { market: "away" as const, label: `${match.away_team} Win`, prob: probAway },
  ].sort((a, b) => b.prob - a.prob)[0];
  const confidence = Math.max(50, Math.min(72, Math.round(best.prob + 18)));
  const risk: AIAnalysisResult["risk"] = confidence >= 60 ? "medium" : "high";
  const stakePct = round2(Math.min(maxStakePctValue || 5, risk === "medium" ? 2.5 : 1));
  const stakeAmount = bankrollValue > 0 ? round2(bankrollValue * (stakePct / 100)) : 0;

  return {
    matchId: match.id,
    summary: hasMarketOdds
      ? `${match.home_team} vs ${match.away_team} has real odds available, so this prediction is generated immediately from the live market instead of waiting on slow optional feeds.`
      : `${match.home_team} vs ${match.away_team} is available from the fixture feed, but bookmaker odds were not returned in time. This is a low-confidence baseline so the app never stays stuck loading.`,
    formAnalysis: hasMarketOdds
      ? "Provider form data is not required for this instant prediction. The probabilities below are normalized from the available bookmaker odds."
      : "Recent form was not returned quickly enough by the provider, so this baseline keeps the split conservative and does not claim a value edge.",
    injuriesImpact:
      "Injury data is not included in this instant view; no injury advantage is assumed for either team.",
    motivation: `The fixture is listed in ${match.league}. Motivation and standings are treated as neutral until deeper provider data is available.`,
    h2hSummary:
      "Head-to-head data is not included in the instant odds model, so no H2H bias is applied.",
    oddsMovement: hasMarketOdds
      ? `Current odds: Home ${home.toFixed(2)}, Draw ${draw.toFixed(2)}, Away ${away.toFixed(2)}. These imply ${probHome.toFixed(1)}% / ${probDraw.toFixed(1)}% / ${probAway.toFixed(1)}% after overround normalization.`
      : "Bookmaker odds are currently unavailable for this fixture, so no odds-movement edge is claimed.",
    bestMarket: best.label,
    probHome,
    probDraw,
    probAway,
    confidence,
    risk,
    valueBet: false,
    suggestedStakePct: stakePct,
    suggestedStakeAmount: stakeAmount,
    reasoning: hasMarketOdds
      ? "This is a conservative market-implied prediction from real odds. Because deeper form, injury and H2H feeds can be delayed, stake sizing is kept small and no value bet is claimed."
      : "This is a fallback baseline because the provider did not return enough odds/form detail quickly. Treat it as informational only and avoid staking unless a sportsbook price can be compared manually.",
    warning:
      "AI analysis is informational only. Betting involves risk and no outcome is guaranteed. Never wager more than you can afford to lose. 18+ only.",
    fallback: true,
  };
}

export const Route = createFileRoute("/_app/analyzer")({
  head: () => ({ meta: [{ title: "Match Analyzer — OddysAI" }] }),
  validateSearch: searchSchema,
  component: AnalyzerPage,
});

function AnalyzerPage() {
  const { matchId, homeTeam: urlHomeTeam, awayTeam: urlAwayTeam, league: urlLeague, kickoff: urlKickoff } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAccess = (_required: string) => false;
  const isActive = false;
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [leagueId, setLeagueId] = useState<string>("all");
  const [date, setDate] = useState<string>("");
  const [status, setStatus] = useState<"upcoming" | "live" | "all">("upcoming");
  const onlyWithOdds = false;
  const [selectedId, setSelectedId] = useState<string | null>(matchId ?? null);
  const [analyzedId, setAnalyzedId] = useState<string | null>(null);
  const [analysisTimedOut, setAnalysisTimedOut] = useState(false);

  useEffect(() => {
    setSelectedId(matchId ?? null);
    setAnalyzedId(null);
    setAnalysisTimedOut(false);
  }, [matchId]);

  // If we already have cached AI analysis for the selected match (from a prior
  // run, persisted via localStorage), auto-restore it instead of forcing the
  // user to click "Scan & Analyze" again.
  useEffect(() => {
    if (!selectedId) return;
    if (analyzedId === selectedId) return;
    const cached = qc.getQueriesData({ queryKey: ["ai-analysis", selectedId] });
    const hasCached = cached.some(([, value]) => value != null);
    if (hasCached) setAnalyzedId(selectedId);
  }, [selectedId, analyzedId, qc]);

  const fetchUpcoming = useServerFn(fetchUpcomingFixtures);
  const fetchLeaguesFn = useServerFn(fetchLeagues);
  const fetchFixtureByIdFn = useServerFn(fetchFixtureById);
  const searchFixturesFn = useServerFn(searchFixtures);

  // Debounce search input for server-side team search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchResults, isFetching: searchLoading } = useQuery({
    queryKey: ["fixtures-search", debouncedQuery],
    enabled: debouncedQuery.length >= 3,
    queryFn: () => searchFixturesFn({ data: { query: debouncedQuery } }),
    staleTime: 60_000,
  });

  const { data: leaguesData } = useQuery({
    queryKey: ["leagues-list"],
    queryFn: () => fetchLeaguesFn(),
    staleTime: 60 * 60_000,
  });
  const allLeagues = leaguesData?.leagues ?? [];
  const allCountries = leaguesData?.countries ?? [];
  const leaguesForCountry =
    country === "all" ? allLeagues : allLeagues.filter((l) => l.country === country);

  const fixtureFilter = useMemo(
    () => ({
      leagueId: leagueId !== "all" ? Number(leagueId) : undefined,
      season:
        leagueId !== "all"
          ? allLeagues.find((league) => league.id === Number(leagueId))?.season
          : undefined,
      country: country !== "all" && leagueId === "all" ? country : undefined,
      date: date || undefined,
      onlyWithOdds,
      status,
    }),
    [leagueId, allLeagues, country, date, onlyWithOdds, status],
  );

  const { data: liveFixtures, isLoading: fixturesLoading } = useQuery({
    queryKey: ["fixtures-upcoming", fixtureFilter],
    queryFn: () => fetchUpcoming({ data: fixtureFilter }),
    staleTime: 5 * 60_000,
  });
  const fixturesError = liveFixtures?.error ?? null;

  const matches = useMemo(() => {
    const toItem = (f: NonNullable<typeof liveFixtures>["fixtures"][number]) => ({
      id: f.id,
      home_team: f.homeTeam,
      away_team: f.awayTeam,
      league: f.league,
      country: f.country,
      kickoff: f.kickoff,
      odds_home: f.oddsHome,
      odds_draw: f.oddsDraw,
      odds_away: f.oddsAway,
      _live: true as const,
      _hasOdds: f.hasOdds,
      _hasSufficientData: f.hasSufficientData,
      _homeScore: f.homeScore,
      _awayScore: f.awayScore,
      _elapsed: f.elapsed,
      _statusShort: f.statusShort,
    });
    const base = (liveFixtures?.fixtures ?? []).map(toItem);
    const extras = (searchResults?.fixtures ?? []).map(toItem);
    const seen = new Set<string>();
    return [...extras, ...base].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [liveFixtures, searchResults]);

  const {
    data: selectedFixtureData,
    isLoading: selectedFixtureLoading,
    isError: selectedFixtureIsError,
  } = useQuery({
    queryKey: ["fixture-by-id", selectedId],
    enabled: !!selectedId && !matches.some((m) => m.id === selectedId),
    queryFn: () => fetchFixtureByIdFn({ data: { matchId: selectedId! } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const selectedFixtureUnavailable =
    !!selectedId &&
    !matches.some((m) => m.id === selectedId) &&
    !selectedFixtureLoading &&
    (selectedFixtureIsError ||
      (!!selectedFixtureData && (selectedFixtureData.fixture == null)));

  const { data: bankroll } = useQuery({
    queryKey: ["bankroll", user?.id],
    enabled: !!user,
    queryFn: async () =>
      (await supabase.from("bankrolls").select("*").eq("user_id", user!.id).maybeSingle()).data,
  });

  const bankrollIsInitialized =
    !!bankroll?.is_initialized || Number(bankroll?.starting_amount ?? 0) > 0;

  const filtered = useMemo(() => {
    const liveStatuses = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE"]);
    const isLiveMatch = (m: (typeof matches)[number]) => {
      const ko = new Date(m.kickoff).getTime();
      const now = Date.now();
      return (
        (m._statusShort && liveStatuses.has(m._statusShort)) ||
        (ko <= now && now - ko < 150 * 60_000)
      );
    };
    return matches
      .filter((m) => (status === "upcoming" ? !isLiveMatch(m) : true))
      .filter((m) =>
        `${m.home_team} ${m.away_team} ${m.league}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
  }, [matches, query, status]);

  const selected = useMemo(() => {
    if (!selectedId) return matches[0];
    const fromCurrentList = matches.find((m) => m.id === selectedId);
    if (fromCurrentList) return fromCurrentList;
    if (selectedFixtureData?.fixture) {
      const f = selectedFixtureData.fixture;
      return {
        id: f.id,
        home_team: f.homeTeam,
        away_team: f.awayTeam,
        league: f.league,
        country: f.country,
        kickoff: f.kickoff,
        odds_home: f.oddsHome,
        odds_draw: f.oddsDraw,
        odds_away: f.oddsAway,
        _live: true as const,
        _hasOdds: f.hasOdds,
        _hasSufficientData: f.hasSufficientData,
      };
    }
    const cachedLists = [
      ...qc.getQueriesData<{
        fixtures?: Array<{
          id: string;
          homeTeam: string;
          awayTeam: string;
          league: string;
          country: string;
          kickoff: string;
          oddsHome: number | null;
          oddsDraw: number | null;
          oddsAway: number | null;
          hasOdds: boolean;
          hasSufficientData: boolean;
        }>;
      }>({ queryKey: ["fixtures-upcoming"] }),
      [
        "dashboard-real-fixtures",
        qc.getQueryData<{
          fixtures?: Array<{
            id: string;
            homeTeam: string;
            awayTeam: string;
            league: string;
            country: string;
            kickoff: string;
            oddsHome: number | null;
            oddsDraw: number | null;
            oddsAway: number | null;
            hasOdds: boolean;
            hasSufficientData: boolean;
          }>;
        }>(["dashboard-real-fixtures"]),
      ],
      [
        "home-upcoming",
        qc.getQueryData<{
          fixtures?: Array<{
            id: string;
            homeTeam: string;
            awayTeam: string;
            league: string;
            country: string;
            kickoff: string;
            oddsHome: number | null;
            oddsDraw: number | null;
            oddsAway: number | null;
            hasOdds: boolean;
            hasSufficientData: boolean;
          }>;
        }>(["home-upcoming"]),
      ],
    ] as const;
    for (const [, value] of cachedLists) {
      const found = value?.fixtures?.find((f) => f.id === selectedId);
      if (found) {
        return {
          id: found.id,
          home_team: found.homeTeam,
          away_team: found.awayTeam,
          league: found.league,
          country: found.country,
          kickoff: found.kickoff,
          odds_home: found.oddsHome,
          odds_draw: found.oddsDraw,
          odds_away: found.oddsAway,
          _live: true as const,
          _hasOdds: found.hasOdds,
          _hasSufficientData: found.hasSufficientData,
        };
      }
    }
    // URL-provided fallback so the card renders instantly while the by-id
    // fetch is in flight (and even if filters would otherwise hide it).
    if (selectedId && (urlHomeTeam || urlAwayTeam)) {
      return {
        id: selectedId,
        home_team: urlHomeTeam ?? "Home",
        away_team: urlAwayTeam ?? "Away",
        league: urlLeague ?? "",
        country: "",
        kickoff: urlKickoff ?? new Date().toISOString(),
        odds_home: null,
        odds_draw: null,
        odds_away: null,
        _live: true as const,
        _hasOdds: false,
        _hasSufficientData: true,
      };
    }
    return undefined;
  }, [selectedId, matches, selectedFixtureData, qc, urlHomeTeam, urlAwayTeam, urlLeague, urlKickoff]);
  const selectedHasOdds = !!selected?._hasOdds;
  const selectedSufficient = !!selected;
  const instantAnalysis = useMemo(
    () =>
      selected && analyzedId === selected.id
        ? buildOddsAnalysis(
            selected,
            Number(bankrollIsInitialized ? bankroll?.current_amount : 0),
            Number(bankroll?.max_stake_pct ?? 5),
          )
        : undefined,
    [
      selected,
      analyzedId,
      bankrollIsInitialized,
      bankroll?.current_amount,
      bankroll?.max_stake_pct,
    ],
  );

  // No subscriptions — access is granted only via per-match one-time unlock (€5.99).
  const hasFullAccess = false;
  void canAccess; void isActive;

  // Track free-tier daily AI preview usage so we can lock the analyze action
  // before the user even clicks (server still enforces the cap).
  const freeUsageQuery = useQuery({
    queryKey: ["ai-preview-usage", user?.id],
    enabled: !!user && !hasFullAccess,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("api_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("kind", "ai_preview")
        .gte("created_at", since.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });
  const isMobile = useIsMobile();
  const freeQuotaExhausted = false;
  void isMobile; void freeUsageQuery;

  const generateAnalysis = useServerFn(generateMatchAnalysis);
  const confirmUnlock = useServerFn(confirmAnalysisUnlock);
  const aiQuery = useQuery({
    queryKey: ["ai-analysis", selected?.id, bankroll?.current_amount, bankroll?.max_stake_pct],
    enabled:
      !!selected && !!user && analyzedId === selected?.id && selectedSufficient,
    staleTime: 10 * 60_000,
    retry: 0,
    queryFn: () =>
      withTimeout(
        generateAnalysis({
          data: {
            matchId: selected!.id,
            homeTeam: selected!.home_team,
            awayTeam: selected!.away_team,
            league: selected!.league,
            kickoff: selected!.kickoff,
            oddsHome: Number(selected!.odds_home) || null,
            oddsDraw: Number(selected!.odds_draw) || null,
            oddsAway: Number(selected!.odds_away) || null,
            bankroll: Number(bankrollIsInitialized ? bankroll?.current_amount : 0),
            maxStakePct: Number(bankroll?.max_stake_pct ?? 5),
          },
        }),
        ANALYSIS_UI_TIMEOUT_MS,
        "Not enough data available: analysis timed out",
      ),
  });

  // Reject malformed AI payloads (e.g. stale persisted entries from older
  // schemas) — treat them as if no result is available so we re-run the AI.
  const aiData = aiQuery.data;
  const aiDataValid =
    !!aiData &&
    typeof aiData.confidence === "number" &&
    Number.isFinite(aiData.confidence) &&
    Number(aiData.probHome) + Number(aiData.probDraw) + Number(aiData.probAway) >= 95 &&
    Number(aiData.probHome) + Number(aiData.probDraw) + Number(aiData.probAway) <= 105 &&
    typeof aiData.summary === "string" &&
    aiData.summary.trim().length > 0 &&
    typeof aiData.reasoning === "string" &&
    aiData.reasoning.trim().length > 0;
  const validAiData = aiDataValid ? aiData : (aiQuery.isError ? instantAnalysis : undefined);

  useEffect(() => {
    if (
      !selected ||
      analyzedId !== selected.id ||
      validAiData ||
      aiQuery.isError ||
      !aiQuery.isFetching
    ) {
      if (validAiData || aiQuery.isError || analyzedId !== selected?.id) setAnalysisTimedOut(false);
      return;
    }
    setAnalysisTimedOut(false);
    const id = window.setTimeout(() => {
      setAnalysisTimedOut(true);
      void qc.cancelQueries({ queryKey: ["ai-analysis", selected.id], exact: false });
    }, ANALYSIS_UI_TIMEOUT_MS + 1000);
    return () => window.clearTimeout(id);
  }, [selected, analyzedId, validAiData, aiQuery.isError, aiQuery.isFetching, qc]);

  const analysis = validAiData;
  const aiLoading =
    (aiQuery.isLoading || aiQuery.isFetching) && !!user && !validAiData && !analysisTimedOut;
  const aiError = (analysisTimedOut || aiQuery.isError || (!!aiData && !aiDataValid)) && !!user && !validAiData;
  const aiErrorMsg = analysisTimedOut
    ? "Not enough data available: analysis timed out"
    : aiQuery.error instanceof Error
      ? aiQuery.error.message
      : String(aiQuery.error ?? "");
  // Free users get full access while they still have free previews available
  // (server enforces the monthly cap and returns 402 when exhausted).
  const quotaExhausted =
    aiQuery.isError && /402|free AI|payment_required|credits exhausted|upgrade_required|unlock_required|subscription_required|free analysis/i.test(aiErrorMsg);
  const isRateLimited = aiQuery.isError && /429|rate[_ ]limited|hourly.*limit/i.test(aiErrorMsg);
  const isMalformed = !aiQuery.isError && !!aiData && !aiDataValid;
  const isZeroProbs = aiQuery.isError && /invalid probabilities/i.test(aiErrorMsg);
  const errorKind: "rate" | "quota" | "malformed" | "zero" | "generic" = isRateLimited
    ? "rate"
    : quotaExhausted
      ? "quota"
      : isZeroProbs
        ? "zero"
        : isMalformed
          ? "malformed"
          : "generic";
  // Per-match one-time unlocks (Stripe one-time checkout).
  const unlockQuery = useQuery({
    queryKey: ["analysis-unlock", user?.id, selected?.id],
    enabled: !!user && !!selected?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("analysis_unlocks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("match_id", selected!.id);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  const isUnlockedOneTime = !!unlockQuery.data;

  // After Stripe redirects back with ?unlock=success, poll briefly for the
  // webhook-written row, then clean the URL.
  const unlockSearch = Route.useSearch() as { unlock?: string; session_id?: string };
  const unlockReturn = unlockSearch.unlock;
  const unlockSessionId = unlockSearch.session_id;
  const confirmedUnlockRef = useRef<string | null>(null);
  useEffect(() => {
    if (unlockReturn !== "success" || !user || !selected?.id) return;
    const cleanUnlockUrl = () =>
      navigate({
        to: "/analyzer",
        search: (prev: Record<string, unknown>) => ({ ...prev, unlock: undefined, session_id: undefined }),
        replace: true,
      });

    if (unlockSessionId && confirmedUnlockRef.current !== unlockSessionId) {
      confirmedUnlockRef.current = unlockSessionId;
      let cancelled = false;
      void (async () => {
        for (let attempts = 1; attempts <= 8 && !cancelled; attempts += 1) {
          try {
            await confirmUnlock({
              data: {
                sessionId: unlockSessionId,
                matchId: selected.id,
                environment: getStripeEnvironment(),
              },
            });
            await qc.invalidateQueries({ queryKey: ["analysis-unlock", user.id, selected.id] });
            if (!cancelled) {
              toast.success("Analysis unlocked");
              cleanUnlockUrl();
            }
            return;
          } catch (err) {
            console.error(err);
            if (attempts >= 8 && !cancelled) {
              toast.error("Payment is not confirmed yet. Please refresh in a moment.");
              return;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
          }
        }
      })();
      return () => { cancelled = true; };
    }

    let attempts = 0;
    const id = setInterval(async () => {
      attempts += 1;
      await qc.invalidateQueries({ queryKey: ["analysis-unlock", user.id, selected.id] });
      if (attempts >= 8) {
        clearInterval(id);
        toast.success("Analysis unlocked");
        cleanUnlockUrl();
      }
    }, 1500);
    return () => clearInterval(id);
  }, [unlockReturn, unlockSessionId, user, selected?.id, qc, navigate, confirmUnlock]);

  const canViewAnalysis =
    hasFullAccess || isUnlockedOneTime || (!!validAiData && !quotaExhausted);
  const isCached = !!validAiData?.cached;

  // Per-match retry budget: max 3 retries per match, with a 30s cooldown
  // between attempts. Resets on full page reload (sessionStorage / state only).
  const MAX_RETRIES = 3;
  const COOLDOWN_MS = 30_000;
  const [retryState, setRetryState] = useState<Record<string, { count: number; lastAt: number }>>(
    {},
  );
  const [nowTs, setNowTs] = useState(() => Date.now());
  const matchRetry = selected ? retryState[selected.id] : undefined;
  const retriesUsed = matchRetry?.count ?? 0;
  const retriesLeft = Math.max(0, MAX_RETRIES - retriesUsed);
  const cooldownRemainingMs = matchRetry ? Math.max(0, matchRetry.lastAt + COOLDOWN_MS - nowTs) : 0;
  const retryDisabled = retriesLeft <= 0 || cooldownRemainingMs > 0;

  // Tick a 1s clock only while a cooldown is active so the button label updates.
  useEffect(() => {
    if (cooldownRemainingMs <= 0) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownRemainingMs]);

  // Auto-evict any stale/invalid cached AI entry the moment we detect it,
  // so a manual retry isn't needed when persisted localStorage data is bad.
  const evictedInvalidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (!aiData || aiDataValid) {
      evictedInvalidRef.current = null;
      return;
    }
    if (evictedInvalidRef.current === selected.id) return;
    evictedInvalidRef.current = selected.id;
    qc.removeQueries({ queryKey: ["ai-analysis", selected.id], exact: false });
    queueMicrotask(() => void aiQuery.refetch());
  }, [selected, aiData, aiDataValid, qc, aiQuery]);

  const handleRetryAi = () => {
    if (!selected) return;
    if (retriesLeft <= 0) {
      toast.error("Retry limit reached", {
        description:
          "You've used all 3 retries for this match. Pick another match or come back later.",
      });
      return;
    }
    if (cooldownRemainingMs > 0) {
      toast.error("Please wait before retrying", {
        description: `Cooldown active — try again in ${Math.ceil(cooldownRemainingMs / 1000)}s.`,
      });
      return;
    }
    setRetryState((prev) => {
      const cur = prev[selected.id];
      return {
        ...prev,
        [selected.id]: { count: (cur?.count ?? 0) + 1, lastAt: Date.now() },
      };
    });
    setNowTs(Date.now());
    setAnalysisTimedOut(false);
    // Drop any cached/persisted entries for this match so the AI re-runs fresh
    qc.removeQueries({ queryKey: ["ai-analysis", selected.id], exact: false });
    setAnalyzedId(selected.id);
    // refetch in case the query is still mounted with the same key
    void aiQuery.refetch();
  };

  // Refresh the free-preview quota counter whenever a fresh analysis is consumed
  useEffect(() => {
    if (validAiData && !isCached && user?.id) {
      qc.invalidateQueries({ queryKey: ["ai-preview-usage", user.id] });
    }
  }, [validAiData, isCached, user?.id, qc]);

  // Notify the user when an AI result was served from cache (only once per match)
  const lastCacheToast = useRef<string | null>(null);
  useEffect(() => {
    if (!validAiData || !isCached) return;
    const key = `${validAiData.matchId}:${validAiData.cachedAt ?? ""}`;
    if (lastCacheToast.current === key) return;
    lastCacheToast.current = key;
    const ageMin = validAiData.cachedAt
      ? Math.max(1, Math.round((Date.now() - new Date(validAiData.cachedAt).getTime()) / 60000))
      : null;
    toast("Showing cached AI analysis", {
      description: ageMin
        ? `Generated ${ageMin} min ago. Cached results refresh every 30 minutes.`
        : "Cached results refresh every 30 minutes.",
      icon: <Database className="h-4 w-4" />,
    });
  }, [validAiData, isCached]);

  // Handle 429 / rate-limit responses with a clear retry message
  const lastRateToast = useRef<number>(0);
  useEffect(() => {
    if (!aiQuery.isError) return;
    const err = aiQuery.error as unknown;
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const isRateLimited = /429|rate[_ ]limited|hourly.*limit/i.test(msg);
    if (!isRateLimited) return;
    const now = Date.now();
    if (now - lastRateToast.current < 30_000) return;
    lastRateToast.current = now;
    const limitMatch = msg.match(/(\d+)\s*\/\s*hour/i);
    toast.error("AI analysis rate limit reached", {
      description: limitMatch
        ? `You've hit ${limitMatch[1]} AI analyses this hour. Please wait up to 60 minutes, or upgrade your plan for a higher limit.`
        : "You've hit your hourly AI analysis limit. Please wait up to 60 minutes, or upgrade your plan for a higher limit.",
      duration: 8000,
      action: {
        label: "Upgrade",
        onClick: () => {
          window.location.href = "/dashboard";
        },
      },
    });
  }, [aiQuery.isError, aiQuery.error]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Match Analyzer</h1>
        <p className="text-sm text-muted-foreground">
          Search a fixture and generate AI analysis. Estimated probabilities, never guarantees.
        </p>
      </div>

      

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Match list */}
        <div className="rounded-xl border border-border bg-card/40 p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search team or league"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v);
                setLeagueId("all");
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All countries</SelectItem>
                {allCountries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={leagueId}
              onValueChange={(value) => {
                setLeagueId(value);
                setQuery("");
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Competition" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All competitions</SelectItem>
                {leaguesForCountry.slice(0, 200).map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-card/30 p-1">
            {(["upcoming", "live", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  status === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "all" ? "All" : value}
              </button>
            ))}
          </div>

          {fixturesError && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>API error: {fixturesError}</span>
            </div>
          )}

          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {fixturesLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading fixtures…</p>
            )}
            {!fixturesLoading &&
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedId(m.id);
                    setAnalyzedId(null);
                    setAnalysisTimedOut(false);
                    navigate({ to: "/analyzer", search: { matchId: m.id } });
                  }}
                  className={`w-full text-left rounded-md border p-2.5 transition-colors ${
                    selected?.id === m.id
                      ? "border-primary/60 bg-primary/5"
                      : "border-border bg-card/30 hover:border-primary/30"
                  }`}
                >
                  {(() => {
                    const ko = new Date(m.kickoff).getTime();
                    const now = Date.now();
                    const liveStatuses = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"];
                    const isLive =
                      (m._statusShort && liveStatuses.includes(m._statusShort)) ||
                      (ko <= now && now - ko < 150 * 60_000);
                    return (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground truncate">
                            {m.league}
                          </div>
                          {isLive ? (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-danger flex items-center gap-1 shrink-0 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
                              Live{m._elapsed != null ? ` · ${m._elapsed}'` : m._statusShort === "HT" ? " · HT" : ""}
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-primary/90 flex items-center gap-1 shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Data ready
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <div className="text-sm font-medium truncate">
                            {m.home_team} vs {m.away_team}
                          </div>
                          {isLive && (m._homeScore != null || m._awayScore != null) && (
                            <div className="font-mono text-sm font-bold text-foreground shrink-0">
                              {m._homeScore ?? 0} - {m._awayScore ?? 0}
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {isLive
                            ? `Kicked off ${format(new Date(m.kickoff), "HH:mm")}`
                            : format(new Date(m.kickoff), "EEE dd MMM HH:mm")}
                        </div>
                      </>
                    );
                  })()}
                </button>
              ))}
            {!fixturesLoading && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No matches found for these filters.
              </p>
            )}
          </div>
        </div>

        {/* Analysis */}
        <div className="space-y-4">
          {selected &&
            (() => {
              const isTriggered = analyzedId === selected.id;
              const hasResult = isTriggered && (!!validAiData || (aiQuery.isError && !validAiData));
              const showAnalysis = isTriggered;
              return (
                <>
                  {/* Always-visible match header */}
                  <div className="rounded-xl border border-border bg-gradient-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          {selected.league}
                        </div>
                        <h2 className="font-display text-2xl font-bold mt-0.5">
                          {selected.home_team}{" "}
                          <span className="text-muted-foreground text-base">vs</span>{" "}
                          {selected.away_team}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(selected.kickoff), "EEEE dd MMMM, HH:mm")}
                        </p>
                        <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                          {selectedHasOdds ? (
                            <>
                              {selected.odds_home != null && (
                                <span>
                                  Home{" "}
                                  <span className="text-foreground">
                                    {Number(selected.odds_home).toFixed(2)}
                                  </span>
                                </span>
                              )}
                              {selected.odds_draw != null && (
                                <span>
                                  Draw{" "}
                                  <span className="text-foreground">
                                    {Number(selected.odds_draw).toFixed(2)}
                                  </span>
                                </span>
                              )}
                              {selected.odds_away != null && (
                                <span>
                                  Away{" "}
                                  <span className="text-foreground">
                                    {Number(selected.odds_away).toFixed(2)}
                                  </span>
                                </span>
                              )}
                              {(selected.odds_home == null || selected.odds_draw == null || selected.odds_away == null) && (
                                <span className="italic text-muted-foreground">
                                  Partial bookmaker coverage
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                              Awaiting market open
                            </span>
                          )}
                        </div>
                      </div>
                      {showAnalysis && analysis && canViewAnalysis && !isAnalysisInsufficient(analysis) && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {aiLoading && (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> AI thinking…
                            </span>
                          )}
                          {!aiLoading && validAiData && !isCached && !validAiData.fallback && (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-success">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success"></span>
                              </span>
                              <Sparkles className="h-3 w-3" />
                              Real-time AI · Verified
                            </span>
                          )}
                          {!aiLoading && validAiData?.fallback && (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-warning">
                              Fallback model
                            </span>
                          )}
                          {!aiLoading && isCached && (
                            <CachedBadge
                              cachedAt={validAiData?.cachedAt}
                              onExpire={() => aiQuery.refetch()}
                            />
                          )}
                          {aiError && !quotaExhausted && (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-warning">
                              Fallback model
                            </span>
                          )}
                          <RiskBadge risk={analysis.risk} />
                          <ValueBadge value={analysis.valueBet} />
                        </div>
                      )}
                    </div>

                    {!showAnalysis && !selectedSufficient && (
                      <div className="mt-5 rounded-lg border border-warning/40 bg-warning/5 p-5 text-center">
                        <AlertTriangle className="h-6 w-6 text-warning mx-auto mb-2" />
                        <h3 className="font-display text-lg font-semibold">
                          Not enough data for reliable prediction
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          We don't have bookmaker odds for this fixture yet. AI analysis is disabled
                          to avoid producing unreliable picks.
                        </p>
                      </div>
                    )}

                    {!showAnalysis && selectedSufficient && !isUnlockedOneTime && (
                      <div className="mt-5">
                        <AnalysisUnlockCard
                          matchId={selected.id}
                          homeTeam={selected.home_team}
                          awayTeam={selected.away_team}
                        />
                      </div>
                    )}

                    {!showAnalysis && selectedSufficient && isUnlockedOneTime && (
                      <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
                        <Sparkles className="h-6 w-6 text-primary mx-auto mb-2" />
                        <h3 className="font-display text-lg font-semibold">
                          Ready to analyze this match
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 mb-4">
                          {selectedHasOdds
                            ? "Our AI will scan form, injuries, motivation, head-to-head and odds movement, then give you a probability breakdown, value rating and suggested stake."
                            : "Odds are not available yet, so the prediction will be a conservative low-confidence baseline instead of staying stuck."}
                        </p>
                        <Button
                          size="lg"
                          onClick={() => {
                            setAnalysisTimedOut(false);
                            setAnalyzedId(selected.id);
                          }}
                          disabled={!user}
                          className="bg-gradient-primary text-primary-foreground shadow-glow"
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          {user ? "Scan & Analyze" : "Sign in to analyze"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Analysis body */}
                  {showAnalysis && aiLoading && !validAiData && (
                    <AnalysisProgress
                      runKey={`${selected.id}:${aiQuery.dataUpdatedAt}:${aiQuery.errorUpdatedAt}`}
                    />
                  )}

                  {showAnalysis &&
                    !aiLoading &&
                    aiError &&
                    (() => {
                      const ERROR_COPY: Record<
                        typeof errorKind,
                        {
                          title: string;
                          body: string;
                          tone: "destructive" | "warning";
                          allowRetry: boolean;
                        }
                      > = {
                        rate: {
                          title: "Hourly AI rate limit reached",
                          body: "You've hit the per-hour cap on AI analyses. Please wait a few minutes before retrying, or upgrade for a higher limit.",
                          tone: "warning",
                          allowRetry: true,
                        },
                        quota: {
                          title: "Daily free analysis used",
                          body: "You've used your 1 free AI analysis for today. Upgrade for unlimited analysis or come back tomorrow.",
                          tone: "warning",
                          allowRetry: false,
                        },
                        zero: {
                          title: "AI returned invalid probabilities",
                          body: "The model produced probabilities that don't add up. This is usually a transient model hiccup — retrying almost always fixes it.",
                          tone: "destructive",
                          allowRetry: true,
                        },
                        malformed: {
                          title: "Malformed AI response",
                          body: "The response came back with missing or empty fields. Try again to get a clean analysis.",
                          tone: "destructive",
                          allowRetry: true,
                        },
                        generic: {
                          title: aiErrorMsg.includes("Not enough data")
                            ? "Not enough data available"
                            : "AI analysis failed",
                          body: aiErrorMsg.includes("Not enough data")
                            ? "This fixture did not return enough usable form, odds, or team data in time. Pick another match or retry later."
                            : "Something went wrong contacting the AI service. You can re-run the analysis without reloading the page.",
                          tone: "destructive",
                          allowRetry: true,
                        },
                      };
                      const copy = ERROR_COPY[errorKind];
                      const toneClasses =
                        copy.tone === "warning"
                          ? "border-warning/40 bg-warning/5"
                          : "border-destructive/40 bg-destructive/5";
                      const iconClass =
                        copy.tone === "warning" ? "text-warning" : "text-destructive";
                      return (
                        <div
                          className={`rounded-xl border p-6 text-center space-y-3 ${toneClasses}`}
                        >
                          <AlertTriangle className={`h-6 w-6 mx-auto ${iconClass}`} />
                          <div>
                            <p className="text-sm font-semibold">{copy.title}</p>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                              {copy.body}
                            </p>
                          </div>
                          {copy.allowRetry ? (
                            <>
                              <Button
                                onClick={handleRetryAi}
                                disabled={retryDisabled}
                                className="bg-gradient-primary text-primary-foreground shadow-glow disabled:opacity-60"
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                {cooldownRemainingMs > 0
                                  ? `Retry in ${Math.ceil(cooldownRemainingMs / 1000)}s`
                                  : retriesLeft <= 0
                                    ? "Retry limit reached"
                                    : "Retry AI call"}
                              </Button>
                              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                                {retriesLeft} of {MAX_RETRIES} retries left for this match
                              </p>
                            </>
                          ) : (
                            <Button
                              asChild
                              className="bg-gradient-primary text-primary-foreground shadow-glow"
                            >
                              <Link to="/dashboard">Upgrade plan</Link>
                            </Button>
                          )}
                        </div>
                      );
                    })()}

                  {showAnalysis && hasResult && validAiData && analysis && (
                    isAnalysisInsufficient(analysis) ? (
                      <AnalysisUnavailableCard />
                    ) : canViewAnalysis ? (
                      <PremiumAnalysisView analysis={analysis} selected={selected} />
                    ) : (
                      <AnalysisUnlockCard
                        matchId={selected.id}
                        homeTeam={selected.home_team}
                        awayTeam={selected.away_team}
                      />
                    )
                  )}
                </>
              );
            })()}
          {!selected && selectedId && selectedFixtureLoading && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Loading selected match…
            </p>
          )}
          {!selected && selectedFixtureUnavailable && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              This match is no longer available for analysis.
            </p>
          )}
          {!selected && !selectedId && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Select a match to begin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  icon: Icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function ProbBar({
  label,
  sublabel,
  prob,
  odds,
  accent,
}: {
  label: string;
  sublabel: string;
  prob: number;
  odds: number;
  accent: "primary" | "muted";
}) {
  const safeProb = Number.isFinite(prob) ? Math.max(0, Math.min(100, prob)) : 0;
  const safeOdds = Number.isFinite(odds) && odds > 1 ? odds : null;
  const fairOdds = safeProb > 0 ? 100 / safeProb : null;
  // Edge: positive means bookmaker odds offer value vs AI fair price
  const edgePct = safeOdds && fairOdds ? ((safeOdds - fairOdds) / fairOdds) * 100 : null;
  const hasValue = edgePct !== null && edgePct >= 5;
  const barClass = accent === "primary" ? "bg-gradient-primary" : "bg-muted-foreground/40";

  return (
    <div className="rounded-lg bg-card/60 border border-border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {sublabel}
          </div>
          <div className="font-display text-sm font-semibold truncate">{label}</div>
        </div>
        <div className="font-mono text-2xl font-bold tabular-nums shrink-0">
          {safeProb.toFixed(1)}
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
        <div className={`h-full ${barClass} transition-all`} style={{ width: `${safeProb}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-mono">
        <span className="text-muted-foreground">
          Bookie <span className="text-foreground">{safeOdds ? safeOdds.toFixed(2) : "—"}</span>
          <span className="mx-1.5 opacity-40">·</span>
          Fair <span className="text-primary">{fairOdds ? fairOdds.toFixed(2) : "—"}</span>
        </span>
        {edgePct !== null && (
          <span
            className={
              hasValue
                ? "text-success font-semibold"
                : edgePct < 0
                  ? "text-destructive"
                  : "text-muted-foreground"
            }
          >
            {edgePct > 0 ? "+" : ""}
            {edgePct.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

const CACHE_TTL_MS = 30 * 60 * 1000;

function CachedBadge({ cachedAt, onExpire }: { cachedAt?: string; onExpire?: () => void }) {
  const expiresAt = cachedAt ? new Date(cachedAt).getTime() + CACHE_TTL_MS : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = expiresAt ? expiresAt - now : 0;
  const expired = expiresAt !== null && remainingMs <= 0;
  const firedRef = useRef(false);

  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");

  return (
    <span
      className="text-[9px] font-mono uppercase tracking-wider text-primary flex items-center gap-1"
      title={
        cachedAt
          ? `Generated ${format(new Date(cachedAt), "HH:mm")} · refreshes when timer hits 0`
          : "Cached result"
      }
    >
      <Clock className="h-3 w-3" />
      Cached
      {expiresAt !== null && (
        <span className="text-muted-foreground normal-case tracking-normal">
          · refresh in{" "}
          <span className="text-foreground tabular-nums">
            {mm}:{ss}
          </span>
        </span>
      )}
    </span>
  );
}

function AnalysisProgress({ runKey }: { runKey: string }) {
  const steps = ["Searching match data", "Running AI analysis", "Generating probabilities"];
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 1200);
    const t2 = setTimeout(() => setStep(2), 3200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [runKey]);

  return (
    <div className="rounded-xl border border-border bg-card/40 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="h-5 w-5 text-primary animate-spin" />
        <p className="text-sm font-medium">AI is analyzing this match…</p>
      </div>
      <ul className="space-y-2.5">
        {steps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-3">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              ) : active ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              )}
              <span
                className={`text-sm ${
                  done
                    ? "text-foreground"
                    : active
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- helpers for the premium analysis view ----------

const UNVERIFIED_MARKERS = [
  "not enough data",
  "verified data unavailable",
  "data unavailable",
  "no data available",
  "n/a",
];

function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw
    .replace(/\[score withheld\]/gi, "")
    .replace(/\[record withheld\]/gi, "")
    // Tipster wording → professional analytics wording
    .replace(/\bstake\s+conservatively\b/gi, "treat this as a lower-confidence market environment")
    .replace(/\bbet\s+responsibly\b/gi, "manage exposure responsibly")
    .replace(/\bestimated\s+probability\s*[~≈]?\s*\d{1,3}\s*%/gi, "model confidence suggests a balanced edge")
    .replace(/\bestimated\s+probability\b/gi, "model confidence")
    .replace(/\bno\s+live\s+market\s+data\s+available[^.]*\.?/gi, "")
    .replace(/\bodds\s+unavailable[^.]*\.?/gi, "")
    // Strip empty placeholder fragments like "()", "[ ]", "{}", " ( )"
    .replace(/[\(\[\{]\s*[\)\]\}]/g, "")
    // Strip dangling " in ." " on ." etc that AI sometimes leaves
    .replace(/\b(in|on|at|during|since|from|across|with|by)\s*([.,;:!?])/gi, "$2")
    // Collapse repeated punctuation and stray space-before-punct
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s;
}

function hasContent(raw: unknown): boolean {
  const s = cleanText(raw);
  if (s.length < 8) return false;
  const lower = s.toLowerCase();
  if (UNVERIFIED_MARKERS.some((m) => lower.includes(m))) return false;
  return true;
}

/**
 * Decide whether the analysis has enough verified data to justify showing
 * a Best Market / Confidence / Risk recommendation. If not, the UI must
 * show "Analysis unavailable" instead, and the fixture must NOT be sold
 * as a premium unlock.
 */
export function isAnalysisInsufficient(analysis: AIAnalysisResult): boolean {
  if (!analysis) return true;
  const hasSportMonksLayer = analysis.dataSources?.sportMonks?.enriched === true;
  if (analysis.fallback === true) return true;

  // Count verified content sources actually present.
  const verifiedSignals = [
    hasContent(analysis.formAnalysis),
    hasContent(analysis.h2hSummary),
    hasContent(analysis.motivation),
    hasContent(analysis.injuriesImpact),
    hasContent(analysis.oddsMovement),
    hasContent(analysis.tacticalAngle),
    hasContent(analysis.reasoning),
  ].filter(Boolean).length;

  if (verifiedSignals < 2) return true;
  if (analysis.dataQuality === "low" && verifiedSignals < 3 && !hasSportMonksLayer) return true;

  // If the model self-reports many missing critical sources, treat as insufficient.
  const CRITICAL = ["odds", "bookmaker", "h2h", "head-to-head", "standings", "injuries", "form"];
  const missing = (analysis.missingData ?? [])
    .filter((s) => typeof s === "string")
    .map((s) => s.toLowerCase());
  const criticalMissing = missing.filter((m) => CRITICAL.some((c) => m.includes(c))).length;
  const hasCoreVerified = [
    hasContent(analysis.formAnalysis),
    hasContent(analysis.h2hSummary),
    hasContent(analysis.motivation),
    hasContent(analysis.oddsMovement),
  ].filter(Boolean).length >= 2;
  if (criticalMissing >= 3 && !hasCoreVerified && !hasSportMonksLayer) return true;

  return false;
}

function AnalysisUnavailableCard() {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-6 text-center space-y-2">
      <AlertTriangle className="h-6 w-6 text-warning mx-auto" />
      <h3 className="font-display text-lg font-semibold">Analysis unavailable</h3>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        Insufficient verified data for this fixture. We don't have enough bookmaker odds,
        head-to-head, standings or team form to produce a trustworthy recommendation.
      </p>
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
        No betting market is suggested for low-data fixtures.
      </p>
    </div>
  );
}

function PremiumAnalysisView({
  analysis,
  selected,
}: {
  analysis: AIAnalysisResult;
  selected: { home_team: string; away_team: string; odds_home: number | null; odds_draw: number | null; odds_away: number | null; kickoff?: string };
}) {
  const conf = analysis.confidence;
  const confTone = conf >= 75 ? "text-success" : conf >= 60 ? "text-warning" : "text-danger";
  const confBar = conf >= 75 ? "bg-success" : conf >= 60 ? "bg-warning" : "bg-danger";
  const riskMap: Record<string, { tone: string; label: string }> = {
    low: { tone: "text-success border-success/30 bg-success/5", label: "Low Risk" },
    medium: { tone: "text-warning border-warning/30 bg-warning/5", label: "Medium Risk" },
    high: { tone: "text-danger border-danger/30 bg-danger/5", label: "High Risk" },
  };
  const r = riskMap[analysis.risk];

  const dataQuality = analysis.dataQuality ?? "medium";
  const lowData = dataQuality === "low";

  const summary = cleanText(analysis.summary);
  const reasoning = cleanText(analysis.reasoning);

  const suggestedMarkets = (analysis.suggestedMarketsDetailed ?? []).filter(
    (m) => m && m.market && hasContent(m.reason),
  );

  // Advanced sections — only show if backed by real verified content.
  const advancedSections: Array<{ title: string; body: string; icon?: React.ComponentType<{ className?: string }> }> = [];
  if (hasContent(analysis.h2hSummary)) advancedSections.push({ title: "Head-to-head", body: cleanText(analysis.h2hSummary) });
  if (hasContent(analysis.formAnalysis)) advancedSections.push({ title: "Form analysis", body: cleanText(analysis.formAnalysis) });
  if (hasContent(analysis.tacticalAngle)) advancedSections.push({ title: "Tactical angle", body: cleanText(analysis.tacticalAngle) });
  if (hasContent(analysis.homeAwayAnalysis)) advancedSections.push({ title: "Home / Away split", body: cleanText(analysis.homeAwayAnalysis) });
  if (hasContent(analysis.injuriesImpact)) advancedSections.push({ title: "Injuries impact", body: cleanText(analysis.injuriesImpact) });
  if (hasContent(analysis.motivation)) advancedSections.push({ title: "Motivation & standings", body: cleanText(analysis.motivation) });
  if (hasContent(analysis.oddsMovement)) advancedSections.push({ title: "Odds movement", body: cleanText(analysis.oddsMovement), icon: TrendingUp });

  // Only surface critical coverage gaps. Pre-match limitations (lineups not
  // released yet, odds movement history, partial-odds notes, venue splits,
  // venue info) are hidden — those sections simply omit themselves.
  const NON_CRITICAL_MISSING = [
    /lineup/i,
    /odds.*movement/i,
    /odds.*snapshot/i,
    /cross[- ]?bookmaker/i,
    /partial bookmaker odds/i,
    /venue/i,
    /home\/away venue split/i,
  ];
  const missingData = (analysis.missingData ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0 && !NON_CRITICAL_MISSING.some((re) => re.test(s)),
  );

  const hasAnyOdds = [selected.odds_home, selected.odds_draw, selected.odds_away].some(
    (o) => Number.isFinite(Number(o)) && Number(o) > 1,
  );

  if (isAnalysisInsufficient(analysis)) {
    return <AnalysisUnavailableCard />;
  }

  const sm = analysis.dataSources?.sportMonks;
  const smContributed = sm?.contributed ?? [];

  return (
    <div className="space-y-5">
      {sm?.enriched && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono uppercase tracking-wider text-primary">Verified with SportMonks</span>
          {smContributed.length > 0 && (
            <span className="text-[10px] text-muted-foreground ml-1">
              · enriched: {smContributed.join(", ")}
            </span>
          )}
        </div>
      )}
      {/* TOP — compact KPI strip: Confidence · Risk · Best Market */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-gradient-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</div>
          <div className={`font-display text-3xl font-bold ${confTone}`}>
            {conf}
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${confBar}`} style={{ width: `${conf}%` }} />
          </div>
        </div>
        <div className={`rounded-xl border p-4 ${r.tone}`}>
          <div className="text-[10px] font-mono uppercase tracking-wider opacity-70">Risk Level</div>
          <div className="font-display text-xl font-bold mt-1">{r.label}</div>
          <div className="text-xs opacity-70 mt-1">
            {analysis.risk === "low"
              ? "Stable market signal"
              : analysis.risk === "medium"
                ? "Moderate market confidence"
                : "Lower-confidence market environment"}
          </div>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-primary">Best Market</div>
          <div className="font-display text-lg font-bold text-primary mt-1 leading-tight line-clamp-2">
            {analysis.bestMarket}
          </div>
          {analysis.valueBet && (
            <div className="mt-2"><ValueBadge value={true} /></div>
          )}
        </div>
      </div>

      {/* MAIN AI SUMMARY */}
      {summary && (
        <div className="rounded-xl border border-border bg-gradient-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              AI Summary
            </h3>
          </div>
          <p className="text-[15px] leading-relaxed text-foreground/90 line-clamp-4">{summary}</p>
        </div>
      )}

      {/* SUGGESTED MARKETS — main actionable area */}
      {suggestedMarkets.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-card/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Suggested Markets
            </h3>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {suggestedMarkets.map((m, i) => {
              const tone =
                m.risk === "low"
                  ? "border-success/30 bg-success/5"
                  : m.risk === "medium"
                    ? "border-warning/30 bg-warning/5"
                    : "border-danger/30 bg-danger/5";
              return (
                <div key={i} className={`rounded-lg border p-4 ${tone}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="font-display font-semibold text-sm">{m.market}</div>
                    <span className="font-mono text-xs tabular-nums shrink-0">{m.confidence}/100</span>
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    {m.risk} risk
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{cleanText(m.reason)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ADVANCED ANALYSIS — collapsed by default */}
      {(advancedSections.length > 0 || hasAnyOdds || sm?.enriched || missingData.length > 0 || reasoning) && (
        <details className="group rounded-xl border border-border bg-card/30 overflow-hidden">
          <summary className="flex items-center justify-between cursor-pointer px-5 py-4 hover:bg-card/50 transition-colors list-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                Advanced Analysis
              </h3>
              {lowData && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-warning border border-warning/30 bg-warning/5 px-1.5 py-0.5 rounded">
                  Limited Data
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="px-5 pb-5 pt-1 space-y-4">
            {advancedSections.map((s) => (
              <Section key={s.title} title={s.title} icon={s.icon}>
                {s.body}
              </Section>
            ))}
            {/* Always render odds widget — SportMonks fallback covers leagues The Odds API misses. */}
            <OddsSpread homeTeam={selected.home_team} awayTeam={selected.away_team} kickoffISO={selected.kickoff} />
            {sm?.enriched && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-primary">
                    SportMonks verified data
                  </h3>
                </div>
                {sm.venue && (
                  <div className="text-xs">
                    <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-mono">Venue · </span>
                    <span className="text-foreground/90">{sm.venue.name}{sm.venue.city ? `, ${sm.venue.city}` : ""}</span>
                  </div>
                )}
                {sm.prediction && (sm.prediction.home != null || sm.prediction.draw != null || sm.prediction.away != null) && (
                  <div className="text-xs">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-mono mb-1">Independent model probability</div>
                    <div className="flex gap-3 font-mono">
                      <span>H {sm.prediction.home != null ? `${Math.round(sm.prediction.home)}%` : "—"}</span>
                      <span>D {sm.prediction.draw != null ? `${Math.round(sm.prediction.draw)}%` : "—"}</span>
                      <span>A {sm.prediction.away != null ? `${Math.round(sm.prediction.away)}%` : "—"}</span>
                    </div>
                  </div>
                )}
                {sm.lineups && sm.lineups.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-mono mb-1">Lineups</div>
                    <ul className="space-y-0.5">
                      {sm.lineups.map((l) => (
                        <li key={l.team} className="font-mono">
                          {l.team}: {l.formation ?? "—"} · {l.starters} starters
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sm.injuries && (sm.injuries.home.length > 0 || sm.injuries.away.length > 0) && (
                  <div className="text-xs grid sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-mono mb-1">{selected.home_team} out</div>
                      <ul className="space-y-0.5">{sm.injuries.home.map((p) => <li key={p}>· {p}</li>)}</ul>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-mono mb-1">{selected.away_team} out</div>
                      <ul className="space-y-0.5">{sm.injuries.away.map((p) => <li key={p}>· {p}</li>)}</ul>
                    </div>
                  </div>
                )}
              </div>
            )}
            {missingData.length > 0 && (
              <div className="rounded-xl border border-border bg-card/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    Missing data
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  These sources were unavailable and were not used in the analysis:
                </p>
                <ul className="grid sm:grid-cols-2 gap-1.5">
                  {missingData.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reasoning && (
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Model reasoning
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{reasoning}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
