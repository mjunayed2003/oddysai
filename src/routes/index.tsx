import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Crown,
  Database,
  Filter,
  Loader2,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { CommunityReviews } from "@/components/community-reviews";

import { fetchUpcomingFixtures } from "@/lib/sports.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OddysAI — AI Football Analysis & Value Bet Detection" },
      {
        name: "description",
        content:
          "AI-powered football analysis: live fixtures, odds comparison, probability signals and value bet detection. Smarter pre-match decisions in seconds.",
      },
      { property: "og:title", content: "OddysAI — AI Football Analysis & Value Bet Detection" },
      { property: "og:description", content: "Live fixtures, odds, probabilities and value signals — one premium analysis dashboard." },
      { property: "og:url", content: "https://oddysai.com/" },
      { property: "og:image", content: "https://oddysai.com/og-image.png" },
      { name: "twitter:title", content: "OddysAI — AI Football Analysis" },
      { name: "twitter:description", content: "Live fixtures, odds, probabilities and value signals in one dashboard." },
      { name: "twitter:image", content: "https://oddysai.com/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://oddysai.com/" }],
  }),
  component: HomePage,
});

const TRUST_ITEMS = [
  { icon: Database, title: "Real football data", desc: "Live fixtures, lineups and stats from API-Football." },
  { icon: BarChart3, title: "Odds market comparison", desc: "Cross-bookmaker pricing with implied probabilities." },
  { icon: Sparkles, title: "Structured AI analysis", desc: "Form, motivation, value signals and confidence scores." },
  { icon: ShieldCheck, title: "Responsible by design", desc: "Stake caps, daily limits and risk-aware suggestions." },
  { icon: CheckCircle2, title: "No guaranteed outcomes", desc: "Probability estimates only — never promises." },
];

const PREMIUM_BENEFITS = [
  "Unlimited full AI analyses",
  "Confidence, risk & value signals",
  "Odds comparison across bookmakers",
  "Suggested markets per fixture",
  "Data quality scoring",
];

function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 bg-hero" />
        <div className="container relative mx-auto px-4 py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mx-auto text-center"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card/60 backdrop-blur px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              AI engine v2 · live data
            </span>
            <h1 className="font-display text-4xl md:text-6xl font-bold leading-[1.05] mb-5 tracking-tight">
              AI-powered football analysis built for{" "}
              <span className="text-gradient-primary">smarter decision-making</span>.
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              OddysAI combines live fixtures, odds, form, probability signals and responsible
              risk assessment into one clean analysis dashboard.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="bg-gradient-primary text-primary-foreground shadow-glow h-12 px-6"
              >
                <Link to="/analyzer">
                  Analyze Today's Matches <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-6">
                <Link to="/login">Get started</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Match Feed */}
      <section className="container mx-auto px-4 py-12 md:py-16">
        <MatchFeed />
      </section>

      {/* Trust */}
      <section className="border-y border-border/60 bg-card/20">
        <div className="container mx-auto px-4 py-14">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-2">
              Built on data, not hype.
            </h2>
            <p className="text-sm text-muted-foreground">
              Every analysis is grounded in real signals and explicit uncertainty.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {TRUST_ITEMS.map((t) => {
              const Icon = t.icon;
              return (
                <div
                  key={t.title}
                  className="rounded-xl border border-border bg-gradient-card p-5 hover:border-primary/40 transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center mb-3">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-sm mb-1">{t.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Premium one-time unlock CTA */}
      <section className="container mx-auto px-4 py-16">
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-card shadow-elevated p-8 md:p-12">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="relative grid md:grid-cols-[1.2fr_1fr] gap-8 items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-primary mb-4">
                <Crown className="h-3 w-3" /> Premium Market Intelligence
              </span>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-3 leading-tight">
                Unlock the full analysis for any match — €5.99.
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-lg">
                One-time payment. No subscription. Pay only for the matches you actually want
                deep AI market intelligence on.
              </p>
              <Button
                asChild
                size="lg"
                className="bg-gradient-primary text-primary-foreground shadow-glow h-12 px-6"
              >
                <Link to="/analyzer">
                  Browse matches <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <ul className="space-y-3">
              {PREMIUM_BENEFITS.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <CommunityReviews />

      <PublicFooter />
    </div>
  );
}

type StatusFilter = "all" | "live" | "upcoming";

function MatchFeed() {
  const fetchFn = useServerFn(fetchUpcomingFixtures);
  const [search, setSearch] = useState("");
  const [league, setLeague] = useState<string>("all");
  const [date, setDate] = useState<string>("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Tick every 5s so the elapsed-derived UI stays fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Track whether last fetch returned any live fixtures, to drive poll cadence
  const [hasLive, setHasLive] = useState(false);

  const pollMs = status === "upcoming" ? 60_000 : hasLive || status === "live" ? 10_000 : 60_000;

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["home-feed"],
    queryFn: () => fetchFn({ data: { onlyWithOdds: false } }),
    staleTime: 5_000,
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const live = (data?.fixtures ?? []).some((f) => f.status === "live");
    setHasLive(live);
  }, [data]);

  const now = Date.now();
  const allFixtures = useMemo(() => {
    return (data?.fixtures ?? []).filter(
      (f) => f.status === "live" || (f.status === "scheduled" && new Date(f.kickoff).getTime() > now),
    );
  }, [data, now]);

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of allFixtures) {
      const key = `${f.country}__${f.league}`;
      if (!seen.has(key)) seen.set(key, `${f.country} · ${f.league}`);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allFixtures]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allFixtures
      .filter((f) => {
        if (status === "live" && f.status !== "live") return false;
        if (status === "upcoming" && f.status !== "scheduled") return false;
        if (league !== "all" && `${f.country}__${f.league}` !== league) return false;
        if (date) {
          const d = new Date(f.kickoff).toISOString().slice(0, 10);
          if (d !== date) return false;
        }
        if (q) {
          const blob = `${f.homeTeam} ${f.awayTeam} ${f.league} ${f.country}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Live first, then by kickoff
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
      })
      .slice(0, 24);
  }, [allFixtures, search, league, date, status]);

  const resetFilters = () => {
    setSearch("");
    setLeague("all");
    setDate("");
    setStatus("all");
  };

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            Today's board
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mt-1">
            Live & upcoming fixtures
          </h2>
        </div>
        {hasLive || status === "live" ? (
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
            </span>
            <span className="text-danger">Live updating</span>
          </div>
        ) : null}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card/40 p-4 mb-6 grid gap-3 md:grid-cols-[1fr_200px_160px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search team, league or country"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={league} onValueChange={setLeague}>
          <SelectTrigger>
            <SelectValue placeholder="All leagues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leagues</SelectItem>
            {leagues.map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          lang="en"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="font-mono"
        />
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["all", "live", "upcoming"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-card/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "live" && <Radio className="inline h-3 w-3 mr-1" />}
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card/40 p-5 h-52 animate-pulse" />
          ))}
          <p className="col-span-full text-center text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Loading today's matches...
          </p>
        </div>
      ) : isError ? (
        <EmptyState
          icon={Filter}
          title="API temporarily unavailable"
          body="We couldn't fetch fixtures right now. Please try again in a moment."
          action={
            <Button onClick={() => refetch()} variant="outline" size="sm">
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches found"
          body="Try changing your filters or come back closer to kickoff time."
          action={
            <Button onClick={resetFilters} variant="outline" size="sm">
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((f) => (
            <MatchCard key={f.id} fixture={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  fixture,
}: {
  fixture: {
    id: string;
    league: string;
    country: string;
    homeTeam: string;
    awayTeam: string;
    kickoff: string;
    status: "scheduled" | "live" | "finished";
    statusShort?: string;
    elapsed: number | null;
    homeScore: number | null;
    awayScore: number | null;
    oddsHome: number | null;
    oddsDraw: number | null;
    oddsAway: number | null;
  };
}) {
  const isLive = fixture.status === "live";
  const fmtKick = (iso: string) => {
    const d = new Date(iso);
    const day = d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    const time = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${day.toUpperCase()} · ${time}`;
  };

  const liveLabel = (() => {
    const s = fixture.statusShort ?? "";
    if (s === "HT") return "HT";
    if (s === "BT" || s === "P") return s;
    if (s === "ET" || s === "BT") return "ET";
    if (s === "2H") return `2H · ${fixture.elapsed ?? ""}'`;
    if (s === "1H") return `1H · ${fixture.elapsed ?? ""}'`;
    if (fixture.elapsed != null) return `Live · ${fixture.elapsed}'`;
    return "Live";
  })();

  const odds = [
    { l: "1", v: fixture.oddsHome },
    { l: "X", v: fixture.oddsDraw },
    { l: "2", v: fixture.oddsAway },
  ];
  const hasOdds = odds.some((o) => o.v);

  return (
    <div className="group relative rounded-xl border border-border bg-gradient-card p-5 hover:border-primary/40 transition-all hover:shadow-glow flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground truncate max-w-[60%]">
          {fixture.country} · {fixture.league}
        </div>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 border border-danger/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-danger">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
            </span>
            {liveLabel}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-primary">
            Upcoming
          </span>
        )}
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-display font-semibold text-base leading-tight truncate">{fixture.homeTeam}</div>
          {isLive && (
            <div className="font-mono text-lg font-bold tabular-nums text-foreground">
              {fixture.homeScore ?? 0}
            </div>
          )}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">vs</div>
        <div className="flex items-center justify-between gap-2">
          <div className="font-display font-semibold text-base leading-tight truncate">{fixture.awayTeam}</div>
          {isLive && (
            <div className="font-mono text-lg font-bold tabular-nums text-foreground">
              {fixture.awayScore ?? 0}
            </div>
          )}
        </div>
      </div>

      {isLive ? (
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-danger mb-3">
          In play · {liveLabel}
        </div>
      ) : (
        <>
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Kickoff (Athens)
          </div>
          <div className="font-mono text-sm font-semibold text-primary mb-3">{fmtKick(fixture.kickoff)}</div>
        </>
      )}

      <div className="mb-4" />

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <Crown className="h-3 w-3 text-primary" /> Premium for full
        </span>
        <Button
          asChild
          size="sm"
          className="bg-gradient-primary text-primary-foreground shadow-glow"
        >
          <Link
            to="/analyzer"
            search={{
              matchId: fixture.id,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              league: fixture.league,
              kickoff: fixture.kickoff,
              source: "homepage",
            }}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Analyze
          </Link>
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <h3 className="font-display font-semibold text-base">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </div>
  );
}
