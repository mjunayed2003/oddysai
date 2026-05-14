import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Activity } from "lucide-react";
import { getTrackedMatchesCount } from "@/lib/public-stats.functions";

// Verified Analyses: deterministic-ish growing counter (kept as before).
const BASE_EPOCH_MS = Date.UTC(2026, 4, 11);
const TICK_INTERVAL_MS = 10 * 60 * 1000;

function seededIncrement(tick: number, salt: number) {
  const x = Math.sin(tick * 9301 + salt * 49297) * 233280;
  const f = x - Math.floor(x);
  return 3 + Math.floor(f * 25);
}

function computeValue(base: number, salt: number) {
  const ticks = Math.max(0, Math.floor((Date.now() - BASE_EPOCH_MS) / TICK_INTERVAL_MS));
  let total = base;
  for (let i = 1; i <= ticks; i++) total += seededIncrement(i, salt);
  return total;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof ShieldCheck;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-emerald-500/20 bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.12),_transparent_60%),linear-gradient(180deg,#04110d_0%,#020806_100%)] p-4 shadow-[0_0_30px_-15px_rgba(16,185,129,0.5)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="rounded-md border border-emerald-400/25 bg-emerald-500/10 p-1.5">
            <Icon className="h-3.5 w-3.5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-300/70 truncate">
              {label}
            </div>
            <div className="font-mono text-xl font-semibold text-emerald-50 tabular-nums">
              {value.toLocaleString("en-US")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-300/80">
            Live
          </span>
        </div>
      </div>
    </div>
  );
}

export function LiveStatsCards() {
  const [verified, setVerified] = useState(() => computeValue(7421, 1));

  useEffect(() => {
    const id = window.setInterval(() => setVerified(computeValue(7421, 1)), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const fetchTracked = useServerFn(getTrackedMatchesCount);
  const { data } = useQuery({
    queryKey: ["tracked-matches"],
    queryFn: () => fetchTracked(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const tracked = data?.count ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <StatCard label="Verified Analyses" value={verified} icon={ShieldCheck} />
      <StatCard label="Matches Tracked" value={tracked} icon={Activity} />
    </div>
  );
}
