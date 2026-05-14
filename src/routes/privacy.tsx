import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — OddysAI" },
      { name: "description", content: "How OddysAI collects, uses and protects your personal data. GDPR-compliant privacy policy for our AI sports analytics platform." },
      { property: "og:title", content: "Privacy Policy — OddysAI" },
      { property: "og:description", content: "GDPR-compliant privacy policy explaining how OddysAI handles your personal data." },
    ],
  }),
  component: PrivacyPage,
});

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-bold mb-2">{n}. {title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <article className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-xs font-mono uppercase tracking-wider text-primary">Legal</span>
        </div>
        <h1 className="font-display text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <p className="text-sm text-muted-foreground leading-relaxed">
          OddysAI ("we", "our", "us") respects your privacy. This policy explains what personal data we
          collect when you use our AI-powered sports analytics platform, why we collect it, how we use
          and store it, and the rights you have under the EU General Data Protection Regulation (GDPR),
          the UK GDPR, and similar data-protection laws.
        </p>

        <Section n={1} title="Data controller">
          <p>
            OddysAI is the data controller for personal data processed through this service. For data
            protection enquiries contact our DPO at <a className="text-primary hover:underline" href="mailto:mail@oddysai.com">mail@oddysai.com</a>.
          </p>
        </Section>

        <Section n={2} title="What we collect">
          <ul className="list-disc pl-6 space-y-1.5">
            <li><strong className="text-foreground">Account data</strong> — email address, display name, country, age confirmation, password hash, OAuth identifiers (if you sign in with Google).</li>
            <li><strong className="text-foreground">Subscription data</strong> — plan tier, billing status, customer/subscription IDs from our payment processor. We do <em>not</em> store full card numbers.</li>
            <li><strong className="text-foreground">Usage data</strong> — analyses requested, matches viewed, bankroll settings, bets you choose to log, AI quota counters, timestamps, IP address (kept short-term for security).</li>
            <li><strong className="text-foreground">Affiliate data</strong> — referral code, referred sign-ups, click counts (IPs are hashed), commission balances.</li>
            <li><strong className="text-foreground">Technical data</strong> — browser type, device type, error logs, anonymised analytics events.</li>
          </ul>
        </Section>

        <Section n={3} title="Why we process it (legal basis)">
          <ul className="list-disc pl-6 space-y-1.5">
            <li><strong className="text-foreground">Contract</strong> — to provide the service you signed up for, run AI analyses, and manage your subscription.</li>
            <li><strong className="text-foreground">Legitimate interest</strong> — to detect abuse, enforce rate limits, prevent fraud, and improve model quality.</li>
            <li><strong className="text-foreground">Legal obligation</strong> — to keep tax and accounting records, respond to lawful requests, and verify age where required.</li>
            <li><strong className="text-foreground">Consent</strong> — for non-essential cookies, optional product emails and marketing communications. You can withdraw consent at any time.</li>
          </ul>
        </Section>

        <Section n={4} title="AI model processing">
          <p>
            When you generate a match analysis, the match metadata (teams, league, kickoff, public odds,
            optional bankroll size) is sent to our AI provider for inference. We do not send your email,
            real name or payment details to the AI provider, and we instruct providers not to use the
            data to train their public models.
          </p>
        </Section>

        <Section n={5} title="Who we share data with">
          <p>We use a small number of carefully selected processors:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Cloud hosting and database (EU/US regions, encrypted at rest).</li>
            <li>AI inference provider for analysis generation.</li>
            <li>Payment processor for subscription billing.</li>
            <li>Email delivery for transactional messages.</li>
            <li>Sports data providers for fixtures and odds.</li>
          </ul>
          <p>We never sell your personal data and never share it with advertisers.</p>
        </Section>

        <Section n={6} title="International transfers">
          <p>
            Some processors are based outside the EEA/UK. Where this happens we rely on Standard
            Contractual Clauses, the UK International Data Transfer Addendum, or an adequacy decision to
            ensure your data receives equivalent protection.
          </p>
        </Section>

        <Section n={7} title="How long we keep it">
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Account data — while your account is active, plus up to 24 months after deletion.</li>
            <li>Billing records — 7 years to comply with tax law.</li>
            <li>Analyses cache — up to 30 minutes per match.</li>
            <li>API usage logs — 12 months for rate-limit and abuse detection.</li>
            <li>Hashed IPs in affiliate clicks — 12 months.</li>
          </ul>
        </Section>

        <Section n={8} title="Your GDPR rights">
          <p>If GDPR or UK GDPR applies to you, you have the right to:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>access the personal data we hold about you;</li>
            <li>request correction of inaccurate data;</li>
            <li>request deletion ("right to be forgotten") subject to legal retention;</li>
            <li>restrict or object to certain processing;</li>
            <li>request a portable copy of your data in a machine-readable format;</li>
            <li>withdraw consent at any time where processing is based on consent;</li>
            <li>lodge a complaint with your local data-protection authority.</li>
          </ul>
          <p>
            To exercise any right email <a className="text-primary hover:underline" href="mailto:mail@oddysai.com">mail@oddysai.com</a>. We respond within 30 days.
          </p>
        </Section>

        <Section n={9} title="Cookies and tracking">
          <p>
            We use strictly necessary cookies for login and session management, and limited first-party
            analytics to understand how the product is used. We do not use third-party advertising
            cookies. You can control cookies through your browser settings.
          </p>
        </Section>

        <Section n={10} title="Security">
          <p>
            We use TLS in transit, encryption at rest, hashed passwords, role-based database access and
            row-level security to protect your data. No system is perfectly secure; if we discover a
            breach affecting your data we will notify you and the relevant authorities as required by law.
          </p>
        </Section>

        <Section n={11} title="Children">
          <p>
            OddysAI is for adults only. We do not knowingly process data of anyone under 18. If you believe
            a minor has created an account, contact us and we will delete it.
          </p>
        </Section>

        <Section n={12} title="Changes to this policy">
          <p>
            We will notify you of material changes by email or in-app notice. The date at the top of this
            page reflects the latest version.
          </p>
        </Section>

        <Section n={13} title="Contact">
          <p>
            Privacy questions: <a className="text-primary hover:underline" href="mailto:mail@oddysai.com">mail@oddysai.com</a>. General support: <Link to="/contact" className="text-primary hover:underline">Contact page</Link>.
          </p>
        </Section>
      </article>
      <PublicFooter />
    </div>
  );
}
