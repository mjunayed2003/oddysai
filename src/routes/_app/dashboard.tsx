import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { fetchUpcomingFixtures } from "@/lib/sports.functions";
import { LiveStatsCards } from "@/components/live-stats-cards";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — OddysAI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const fetchUpcoming = useServerFn(fetchUpcomingFixtures);

  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ["dashboard-real-fixtures"],
    queryFn: () => fetchUpcoming({ data: { onlyWithOdds: false } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const nowMs = Date.now();
  const matches = (matchesData?.fixtures ?? [])
    .filter((f) => f.status === "scheduled" && new Date(f.kickoff).getTime() > nowMs)
    .slice(0, 12);

  return (
    <div className="container mx-auto px-4 py-6 md:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Curated AI-ready matches. Unlock the analysis you need, when you need it.</p>
        </div>
        <Button asChild className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Link to="/analyzer">Browse matches <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </div>

      <LiveStatsCards />

      <div className="rounded-xl border border-border bg-gradient-card p-4 sm:p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="font-display text-base sm:text-lg font-semibold">Upcoming fixtures</h2>
          <Link to="/analyzer" className="text-xs text-primary hover:underline shrink-0">Open analyzer →</Link>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {matches.map((m) => (
            <Link
              key={m.id}
              to="/analyzer"
              search={{ matchId: m.id }}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card/40 p-3 hover:border-primary/40 transition-colors min-w-0"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider truncate">{m.league}</div>
                <div className="text-[10px] text-muted-foreground shrink-0">{format(new Date(m.kickoff), "EEE HH:mm")}</div>
              </div>
              <div className="font-medium text-sm truncate min-w-0">
                {m.homeTeam} <span className="text-muted-foreground">vs</span> {m.awayTeam}
              </div>
            </Link>
          ))}
          {matchesLoading && <p className="text-sm text-muted-foreground py-6 text-center sm:col-span-2">Loading fixtures…</p>}
          {!matchesLoading && matches.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center sm:col-span-2">No fixtures available.</p>}
        </div>
      </div>
    </div>
  );
}
