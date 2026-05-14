import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { Mail, LifeBuoy, Briefcase, Megaphone, Scale, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — OddysAI" },
      { name: "description", content: "Get in touch with OddysAI. Support, billing, privacy, partnerships and press contact details for our AI sports analytics platform." },
      { property: "og:title", content: "Contact OddysAI" },
      { property: "og:description", content: "Reach the OddysAI team for support, billing, privacy or partnership enquiries." },
    ],
  }),
  component: ContactPage,
});

const inboxes = [
  { icon: LifeBuoy, label: "Customer support", email: "mail@oddysai.com", desc: "Account questions, technical issues, how-to help. Replies within 1 business day." },
  { icon: Briefcase, label: "Billing & refunds", email: "mail@oddysai.com", desc: "Invoices, subscription changes, refund requests under our Refund Policy." },
  { icon: Scale, label: "Privacy & GDPR", email: "mail@oddysai.com", desc: "Data access, deletion, portability, and any data-protection request." },
  { icon: Megaphone, label: "Affiliates & partners", email: "mail@oddysai.com", desc: "Affiliate program, B2B data licensing, integrations, press." },
];

function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <section className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="h-5 w-5 text-primary" />
          <span className="text-xs font-mono uppercase tracking-wider text-primary">Get in touch</span>
        </div>
        <h1 className="font-display text-4xl font-bold mb-3">Contact OddysAI</h1>
        <p className="text-muted-foreground mb-10 max-w-2xl">
          OddysAI is an AI-powered sports analytics platform. We are not a bookmaker and do not accept
          wagers — but we are happy to help with anything related to your account, our analyses, billing
          or partnerships.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {inboxes.map((c) => (
            <a
              key={c.email}
              href={`mailto:${c.email}`}
              className="rounded-xl border border-border bg-card/40 p-5 hover:border-primary/40 hover:bg-card/60 transition-colors"
            >
              <c.icon className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-display font-semibold">{c.label}</h3>
              <p className="text-sm text-primary mt-0.5">{c.email}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{c.desc}</p>
            </a>
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-warning/30 bg-warning/5 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-warning leading-relaxed">
            <strong>Important:</strong> OddysAI provides analysis for educational purposes only. We do not
            place bets on your behalf and we do not guarantee outcomes. If gambling is causing you harm,
            please visit our <Link to="/responsible-gambling" className="underline font-semibold">Responsible Gambling</Link> page or call a confidential helpline immediately.
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
