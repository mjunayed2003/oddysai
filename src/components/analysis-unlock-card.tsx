import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Lock, Loader2, ShieldCheck, Apple, Smartphone, CreditCard, Bitcoin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createAnalysisUnlockCheckout } from "@/lib/payments.functions";
import { createCryptoUnlockInvoice } from "@/lib/crypto-payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";

const CRYPTO_COINS: { id: string; label: string }[] = [
  { id: "btc", label: "BTC" },
  { id: "eth", label: "ETH" },
  { id: "usdterc20", label: "USDT (ERC-20)" },
  { id: "usdttrc20", label: "USDT (TRC-20)" },
  { id: "usdcerc20", label: "USDC" },
];

interface Props {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
}

export function AnalysisUnlockCard({ matchId, homeTeam, awayTeam }: Props) {
  const [loading, setLoading] = useState<"card" | "crypto" | null>(null);
  const [coin, setCoin] = useState<string>("btc");
  const createUnlock = useServerFn(createAnalysisUnlockCheckout);
  const createCrypto = useServerFn(createCryptoUnlockInvoice);

  async function handleUnlock() {
    if (loading) return;
    setLoading("card");
    try {
      const origin = window.location.origin;
      const returnUrl = `${origin}/analyzer?matchId=${encodeURIComponent(matchId)}&unlock=success`;
      const { hostedUrl } = await createUnlock({
        data: { matchId, returnUrl, environment: getStripeEnvironment() },
      });
      if (!hostedUrl) throw new Error("Checkout could not start");
      window.location.href = hostedUrl;
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not start checkout");
      setLoading(null);
    }
  }

  async function handleCrypto() {
    if (loading) return;
    setLoading("crypto");
    try {
      const origin = window.location.origin;
      const returnUrl = `${origin}/analyzer?matchId=${encodeURIComponent(matchId)}&unlock=success`;
      const { invoiceUrl } = await createCrypto({
        data: { matchId, returnUrl, payCurrency: coin },
      });
      if (!invoiceUrl) throw new Error("Invoice could not be created");
      window.location.href = invoiceUrl;
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not start crypto payment");
      setLoading(null);
    }
  }

  const matchLabel = homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : "this match";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.18),_transparent_60%),linear-gradient(180deg,#04110d_0%,#020806_100%)] p-6 sm:p-8 shadow-[0_0_60px_-20px_rgba(16,185,129,0.55)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />

      <div className="relative flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2 ring-1 ring-emerald-400/20">
              <Lock className="h-4 w-4 text-emerald-300" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-300/80">
                Sharp Signal Locked
              </div>
              <div className="font-display text-lg font-semibold text-emerald-50">
                <span translate="no" className="notranslate">Premium</span> Market Intelligence
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200">
            <ShieldCheck className="h-3 w-3" /> One-time access
          </span>
        </div>

        <p className="text-sm leading-relaxed text-emerald-50/70 max-w-xl">
          Unlock the full market analytics report for <span className="text-emerald-100 font-medium">{matchLabel}</span> —
          probability model, pricing edge, market efficiency read and suggested markets — with a single payment.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-950/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/70">Coverage</div>
            <div className="mt-1 text-sm font-medium text-emerald-50">This match only</div>
          </div>
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-950/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/70">Billing</div>
            <div className="mt-1 text-sm font-medium text-emerald-50">No subscription</div>
          </div>
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-950/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/70">Delivery</div>
            <div className="mt-1 text-sm font-medium text-emerald-50">Instant after payment</div>
          </div>
        </div>

        <Button
          onClick={handleUnlock}
          disabled={loading !== null}
          className="w-full h-auto py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-emerald-950 font-semibold shadow-[0_0_30px_-8px_rgba(16,185,129,0.7)] hover:from-emerald-400 hover:to-emerald-300 disabled:opacity-70"
        >
          {loading === "card" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening secure checkout…
            </span>
          ) : (
            <span className="flex flex-col items-center leading-tight">
              <span className="inline-flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" /> Pay with Card — €5.99
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-900/80 mt-1">
                Card • Apple Pay • Google Pay
              </span>
            </span>
          )}
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-emerald-400/15" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/60">or pay with crypto</span>
          <div className="h-px flex-1 bg-emerald-400/15" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <select
            value={coin}
            onChange={(e) => setCoin(e.target.value)}
            disabled={loading !== null}
            className="rounded-xl border border-emerald-400/25 bg-emerald-950/40 px-3 py-3 text-sm text-emerald-50 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
          >
            {CRYPTO_COINS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <Button
            onClick={handleCrypto}
            disabled={loading !== null}
            variant="outline"
            className="h-auto py-3 px-5 rounded-xl border-emerald-400/40 bg-emerald-950/30 text-emerald-100 hover:bg-emerald-900/40 hover:text-emerald-50"
          >
            {loading === "crypto" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Creating invoice…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Bitcoin className="h-4 w-4" /> Pay with Crypto
              </span>
            )}
          </Button>
        </div>

        <div className="flex items-center justify-center gap-4 text-[11px] text-emerald-200/60">
          <span className="inline-flex items-center gap-1"><CreditCard className="h-3 w-3" /> Card</span>
          <span className="inline-flex items-center gap-1"><Apple className="h-3 w-3" /> Apple Pay</span>
          <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" /> Google Pay</span>
          <span className="inline-flex items-center gap-1"><Bitcoin className="h-3 w-3" /> Crypto</span>
        </div>

        <p className="text-[11px] text-emerald-200/50 text-center">
          Card via Stripe, crypto via NOWPayments. The unlock is tied to your account and this fixture only.
        </p>
      </div>
    </div>
  );
}
