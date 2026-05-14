import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchOddsSnapshot } from "@/lib/sports.functions";
import { TrendingUp, ShieldCheck } from "lucide-react";

export function OddsSpread({
  homeTeam,
  awayTeam,
  kickoffISO,
}: {
  homeTeam: string;
  awayTeam: string;
  kickoffISO?: string;
}) {
  const fn = useServerFn(fetchOddsSnapshot);
  const { data, isLoading } = useQuery({
    queryKey: ["odds-snapshot", homeTeam, awayTeam, kickoffISO ?? null],
    queryFn: () => fn({ data: { homeTeam, awayTeam, kickoffISO } }),
    staleTime: 60_000,
  });

  const books = data?.books ?? [];
  const verifiedBySportMonks = data?.source === "sportmonks";
  const fmtOdd = (odd: number | null) => (Number.isFinite(Number(odd)) && Number(odd) > 1 ? Number(odd).toFixed(2) : "—");

  // Hide entirely when no live market data is available — premium UX:
  // omit empty sections instead of surfacing "no data" notices.
  if (!isLoading && books.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-sm uppercase tracking-wider text-muted-foreground">
          Live odds across bookmakers
        </h3>
        {verifiedBySportMonks && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-primary">
            <ShieldCheck className="h-3 w-3" /> Verified with SportMonks
          </span>
        )}
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading market data…</p>}
      {books.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left py-1.5">Book</th>
                <th className="text-right py-1.5 font-mono">Home</th>
                <th className="text-right py-1.5 font-mono">Draw</th>
                <th className="text-right py-1.5 font-mono">Away</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.book} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5">{b.book}</td>
                  <td className="py-1.5 text-right font-mono">{fmtOdd(b.home)}</td>
                  <td className="py-1.5 text-right font-mono">{fmtOdd(b.draw)}</td>
                  <td className="py-1.5 text-right font-mono">{fmtOdd(b.away)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
