import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface QuickResult {
  pickLabel: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  summary: string;
  warning: string;
}

export function QuickFreePrediction() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [oH, setOH] = useState("");
  const [oD, setOD] = useState("");
  const [oA, setOA] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuickResult | null>(null);
  const [exhausted, setExhausted] = useState(false);

  async function run() {
    if (!home.trim() || !away.trim()) {
      toast.error("Enter both teams");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = { homeTeam: home.trim(), awayTeam: away.trim() };
      if (oH) body.oddsHome = Number(oH);
      if (oD) body.oddsDraw = Number(oD);
      if (oA) body.oddsAway = Number(oA);
      const res = await fetch("/api/public/quick-prediction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 402) setExhausted(true);
        toast.error(json.error || "Failed");
        return;
      }
      setResult(json.result);
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-3xl mx-auto"
      >
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">
            <Sparkles className="h-3 w-3 text-primary" /> Free · No signup
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-3">Try a quick AI prediction</h2>
          <p className="text-muted-foreground">One free prediction per month — reduced detail. Create an account to unlock full match-by-match AI market analysis.</p>
        </div>

        <div className="rounded-2xl border border-border bg-gradient-card p-6 md:p-8 shadow-glow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Home team</Label>
              <Input value={home} onChange={(e) => setHome(e.target.value)} placeholder="Arsenal" maxLength={80} className="mt-1" />
            </div>
            <div>
              <Label>Away team</Label>
              <Input value={away} onChange={(e) => setAway(e.target.value)} placeholder="Chelsea" maxLength={80} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div>
              <Label>Odds H</Label>
              <Input type="number" step="0.01" value={oH} onChange={(e) => setOH(e.target.value)} placeholder="2.10" className="mt-1" />
            </div>
            <div>
              <Label>Odds D</Label>
              <Input type="number" step="0.01" value={oD} onChange={(e) => setOD(e.target.value)} placeholder="3.40" className="mt-1" />
            </div>
            <div>
              <Label>Odds A</Label>
              <Input type="number" step="0.01" value={oA} onChange={(e) => setOA(e.target.value)} placeholder="3.50" className="mt-1" />
            </div>
          </div>

          <Button
            onClick={run}
            disabled={loading || exhausted}
            className="w-full mt-5 bg-gradient-primary text-primary-foreground h-12"
          >
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing</> : exhausted ? "Free prediction used" : "Get free AI prediction"}
          </Button>

          {result && (
            <div className="mt-5 rounded-xl border border-primary/30 bg-card/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pick</div>
                  <div className="font-display text-xl font-bold">{result.pickLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</div>
                  <div className="font-mono text-2xl font-bold text-primary">{result.confidence}%</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${result.risk === "low" ? "bg-success/15 text-success" : result.risk === "medium" ? "bg-primary/15 text-primary" : "bg-danger/15 text-danger"}`}>{result.risk} risk</span>
              </div>
              <p className="text-sm text-muted-foreground">{result.summary}</p>
              <p className="text-[10px] text-muted-foreground italic">{result.warning}</p>
            </div>
          )}

          {(result || exhausted) && (
            <div className="mt-5 rounded-xl border border-primary/40 bg-primary/5 p-4 flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-semibold">Want full AI analysis?</div>
                <div className="text-xs text-muted-foreground">Per-match unlock for €5.99 — no subscription, no commitment.</div>
              </div>
              <Button asChild size="sm" className="bg-gradient-primary text-primary-foreground shrink-0">
                <Link to="/login">Sign up <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </section>
  );
}
