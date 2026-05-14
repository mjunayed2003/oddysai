import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchLiveFixtures } from "@/lib/sports.functions";
import { Radio, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/live")({
  head: () => ({ meta: [{ title: "Live Matches — OddysAI" }] }),
  component: LivePage,
});

function LivePage() {
  const fn = useServerFn(fetchLiveFixtures);
  const { data, isLoading } = useQuery({
    queryKey: ["live-fixtures-api"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const live = data?.fixtures ?? [];

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-danger animate-pulse" />
        <h1 className="font-display text-2xl md:text-3xl font-bold">Live Matches</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {isLoading && <p className="text-sm text-muted-foreground py-12 text-center md:col-span-2">Loading live data…</p>}
        {!isLoading && live.map((m) => (
          <div key={m.id} className="rounded-xl border border-danger/40 bg-gradient-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-danger flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" /> LIVE {m.elapsed ? `· ${m.elapsed}'` : ""}
              </span>
              <span className="text-[10px] font-mono uppercase text-muted-foreground truncate ml-2">{m.league}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {m.homeLogo && <img src={m.homeLogo} alt="" className="h-5 w-5" />}
                <span className="font-display font-semibold truncate">{m.homeTeam}</span>
              </div>
              <span className="font-mono text-2xl font-bold">{m.homeScore ?? 0}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <div className="flex items-center gap-2 min-w-0">
                {m.awayLogo && <img src={m.awayLogo} alt="" className="h-5 w-5" />}
                <span className="font-display font-semibold truncate">{m.awayTeam}</span>
              </div>
              <span className="font-mono text-2xl font-bold">{m.awayScore ?? 0}</span>
            </div>
            <p className="mt-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{m.country}</p>
            <Button
              asChild
              size="sm"
              className="mt-3 w-full bg-gradient-primary text-primary-foreground"
            >
              <Link
                to="/analyzer"
                search={{
                  homeTeam: m.homeTeam,
                  awayTeam: m.awayTeam,
                  league: m.league,
                  source: "live",
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Analyze live
              </Link>
            </Button>
          </div>
        ))}
        {!isLoading && live.length === 0 && (
          <p className="text-sm text-muted-foreground py-12 text-center md:col-span-2">
            No live matches right now. Check back during match hours.
          </p>
        )}
      </div>
    </div>
  );
}
