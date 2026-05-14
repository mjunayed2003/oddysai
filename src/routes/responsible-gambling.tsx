import { createFileRoute } from "@tanstack/react-router";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { ShieldAlert, Heart, Phone, Clock, Wallet, Users } from "lucide-react";

export const Route = createFileRoute("/responsible-gambling")({
  head: () => ({ meta: [
    { title: "Responsible Gambling — OddysAI" },
    { name: "description", content: "OddysAI's commitment to safer gambling. 18+ only, hard limits, support resources." },
  ] }),
  component: () => (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <section className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="flex items-center gap-3 mb-2">
          <Heart className="h-6 w-6 text-warning" />
          <span className="text-xs font-mono uppercase tracking-wider text-warning">Compliance</span>
        </div>
        <h1 className="font-display text-4xl font-bold mb-4">Responsible Gambling</h1>
        <p className="text-muted-foreground mb-8">
          OddysAI provides AI-powered analysis as an educational tool. We do not accept wagers and we do not guarantee outcomes.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-10">
          {[
            { icon: ShieldAlert, t: "No guaranteed profit", d: "Every analysis is a probability estimate. Variance and luck always play a role." },
            { icon: Wallet, t: "Bankroll discipline", d: "Use the bankroll manager. Set daily loss limits. Never chase losses." },
            { icon: Clock, t: "Take breaks", d: "If betting feels stressful or compulsive, step away. Use self-exclusion tools." },
            { icon: Users, t: "18+ only", d: "OddysAI is for adults. Underage access is strictly prohibited." },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-border bg-card/40 p-5">
              <c.icon className="h-5 w-5 text-warning mb-2" />
              <h3 className="font-display font-semibold mb-1">{c.t}</h3>
              <p className="text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-warning/30 bg-warning/5 p-6">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="h-5 w-5 text-warning" />
            <h3 className="font-display font-semibold">Need help?</h3>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>🇬🇧 GamCare — 0808 8020 133 — gamcare.org.uk</li>
            <li>🇪🇺 EUGambling — begambleaware.org</li>
            <li>🇺🇸 National Council on Problem Gambling — 1-800-522-4700</li>
            <li>🌍 Gamblers Anonymous — gamblersanonymous.org</li>
          </ul>
        </div>
      </section>
      <PublicFooter />
    </div>
  ),
});
