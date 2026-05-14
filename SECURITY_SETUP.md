# Infrastructure Hardening Setup Guide

This app now ships with the following defenses. A few are wired into code; others need one-time configuration in the dashboards listed below.

## 1. Cloudflare Turnstile (bot protection on login/signup)

Wired into: `src/routes/login.tsx` via `TurnstileWidget`. The token is forwarded to Supabase Auth (`captchaToken` option).

**You must enable CAPTCHA in Lovable Cloud (Auth → Settings → Bot and Abuse Protection):**
1. Provider: **Cloudflare Turnstile**
2. Paste the **same secret** you saved as `TURNSTILE_SECRET_KEY` in Lovable Cloud secrets.
3. Save.

Site key is already saved as `TURNSTILE_SITE_KEY` and exposed safely to the browser via the `getPublicConfig` server function.

To get keys: https://dash.cloudflare.com → Turnstile → Add site (Widget mode: Managed). Domains to allowlist: `oddysai.com`, `www.oddysai.com`, `*.lovable.app`.

## 2. Sentry error monitoring

Wired into: `src/components/sentry-init.tsx`, mounted in `__root.tsx`. DSN is loaded at runtime from `SENTRY_DSN`.

- 10% transaction sampling, 100% replay-on-error.
- No further setup needed. Verify events flow at https://sentry.io → your project → Issues.

## 3. Hardened `/admin` route

`src/routes/_app/admin.tsx` now:
- Uses the `useIsAdmin` hook backed by the `has_role` SECURITY DEFINER RPC (canonical server-side check).
- Redirects non-admins to `/dashboard` and refuses to render until admin status is confirmed.

Belt-and-suspenders: the underlying `user_roles` table has RLS, and admin RPCs (`audit_table_grants`, `audit_function_grants`) raise `forbidden` if the caller is not an admin.

## 4. Stripe — held off

Lovable's built-in Stripe is **enabled** in the dashboard, but no checkout/webhook code has been added per your decision. When you're ready, the webhook signature secret (`PAYMENTS_SANDBOX_WEBHOOK_SECRET`) is already provisioned.

## 5. Edge / WAF / CDN (recommended)

OddysAI runs on Lovable's edge. To layer a WAF/CDN in front:
- **Cloudflare proxy**: point `oddysai.com` DNS through Cloudflare (orange cloud). Enable: Bot Fight Mode, Rate Limiting Rules (e.g. `/auth/*` → 10 req/min/IP), Managed WAF rules, "Under Attack Mode" toggle for emergencies.
- **Edge rate limits** on auth endpoints: Cloudflare Rules → expression `(http.request.uri.path contains "/auth/")` → action: Block above N rps per IP.
- DB-level rate limits already exist in `check_rate_limit()` for `subscription_cancel` and `plan_change`.

## 6. Recommended next steps

- Enable **Leaked Password Protection** in Lovable Cloud Auth settings.
- Set Auth **OTP expiry** to ≤ 1 hour.
- Restrict allowed redirect URLs to `oddysai.com`, `www.oddysai.com`, and your preview domain only.
- Rotate `LOVABLE_API_KEY` quarterly.
