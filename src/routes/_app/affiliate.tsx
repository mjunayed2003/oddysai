import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Users, Copy, Trophy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getAffiliateLeaderboard as getAffiliateLeaderboardFn,
  getReferralActivity as getReferralActivityFn,
} from "@/lib/account.functions";
import { AffiliatePayout } from "@/components/affiliate-payout";

export const Route = createFileRoute("/_app/affiliate")({
  head: () => ({
    meta: [
      { title: "Affiliate Program — Earn 30% Commission | OddysAI" },
      { name: "description", content: "Join the OddysAI affiliate program. Earn 30% recurring commission on every referred subscription. €300 minimum payout via Revolut, PayPal or bank." },
      { property: "og:title", content: "OddysAI Affiliate Program — 30% Recurring Commission" },
      { property: "og:description", content: "Refer users, earn 30% recurring. Live leaderboard, fast payouts." },
      { property: "og:url", content: "https://oddysai.com/affiliate" },
      { property: "og:image", content: "https://oddysai.com/og-image.png" },
      { name: "twitter:title", content: "OddysAI Affiliate Program" },
      { name: "twitter:description", content: "Earn 30% recurring commission on every referred subscription." },
      { name: "twitter:image", content: "https://oddysai.com/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://oddysai.com/affiliate" }],
  }),
  component: AffiliatePage,
});

function AffiliatePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getLeaderboard = useServerFn(getAffiliateLeaderboardFn);
  const getReferralActivity = useServerFn(getReferralActivityFn);

  const { data: affiliate } = useQuery({
    queryKey: ["affiliate", user?.id],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => (await supabase.from("affiliates").select("*").eq("user_id", user!.id).maybeSingle()).data,
  });

  // Release any matured holding commissions (7-day hold passed) on mount.
  useEffect(() => {
    if (!user) return;
    (supabase.rpc as any)("release_matured_affiliate_commissions").then(({ error }: any) => {
      if (!error) qc.invalidateQueries({ queryKey: ["affiliate", user.id] });
    });
  }, [user, qc]);

  // Live refresh on click / signup updates to this affiliate row
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`aff-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "affiliates", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["affiliate", user.id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const { data: leaderboard = [] } = useQuery({
    queryKey: ["aff-leaderboard"],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await getLeaderboard({});
      return res.leaderboard ?? [];
    },
  });

  const { data: referrals = [] } = useQuery({
    queryKey: ["aff-referrals", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await getReferralActivity({});
      return res.referrals ?? [];
    },
  });

  // Sum of holding commissions (within 7-day refund window) for this affiliate.
  const { data: holdingTotal = 0 } = useQuery({
    queryKey: ["aff-holding", affiliate?.id],
    enabled: !!affiliate?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("affiliate_commissions")
        .select("amount")
        .eq("affiliate_id", affiliate!.id)
        .eq("status", "holding");
      return (data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    },
  });

  const link = affiliate ? `${typeof window !== "undefined" ? window.location.origin : ""}/login?tab=signup&ref=${affiliate.referral_code}` : "";

  const available = Number(affiliate?.pending_payout ?? 0);
  const pendingHold = Number(holdingTotal ?? 0);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="font-display text-2xl md:text-3xl font-bold">Affiliate Program</h1>
      </div>
      <p className="text-sm text-muted-foreground">Earn 30% commission on every match analysis unlocked by users you refer. Commissions are held for 7 days (refund window) before becoming available. Withdraw anytime above €300.</p>

      <div className="rounded-xl border border-primary/30 bg-gradient-card p-5 shadow-glow">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Your referral link</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-0 truncate rounded-md bg-card border border-border px-3 py-2 font-mono text-sm">{link}</code>
          <Button onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }} variant="outline">
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">Code: <span className="font-mono font-bold text-primary">{affiliate?.referral_code}</span></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Clicks" value={String(affiliate?.total_clicks ?? 0)} />
        <Stat label="Signups" value={String(affiliate?.total_signups ?? 0)} />
        <Stat label="Total earned" value={`€${Number(affiliate?.total_earned ?? 0).toFixed(2)}`} positive />
        <Stat label="Pending (7d hold)" value={`€${pendingHold.toFixed(2)}`} />
        <Stat label="Available" value={`€${available.toFixed(2)}`} positive />
      </div>

      <AffiliatePayout pendingPayout={available} />

      <div className="rounded-xl border border-border bg-gradient-card p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-display font-semibold">Referral activity</h2>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Privacy-safe
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Emails are masked. We never expose personal or payment details.
        </p>
        <div className="space-y-2">
          {referrals.map((row: { maskedEmail: string; unlocks: number; commission: number }, i: number) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm truncate">{row.maskedEmail}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {row.unlocks} {row.unlocks === 1 ? "analysis unlock" : "analysis unlocks"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-sm font-bold text-success">
                  €{row.commission.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">generated</div>
              </div>
            </div>
          ))}
          {referrals.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No referral activity yet. Share your link to start earning.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-gradient-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-accent" />
          <h2 className="font-display font-semibold">Top affiliates this month</h2>
        </div>
        <div className="space-y-2">
          {leaderboard.map((row: any, i: number) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card/40 p-3">
              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold w-6 text-center ${i === 0 ? "text-accent" : "text-muted-foreground"}`}>#{row.rank ?? i + 1}</span>
                <span className="font-mono text-sm">{row.referral_code}</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-bold text-success">€{Number(row.total_earned).toFixed(0)}+ earned</div>
                <div className="text-[10px] text-muted-foreground">€{Number(row.total_generated ?? 0).toFixed(0)}+ generated · {row.total_signups ?? row.total_active_subs ?? 0} signups</div>
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Be the first to earn.</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-gradient-card p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${positive ? "text-success" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
