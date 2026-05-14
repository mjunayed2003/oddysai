import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient } from "@/lib/stripe.server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_RETURN_HOSTS = new Set([
  "oddysai.com",
  "www.oddysai.com",
  "bet-iq-ai-insights.lovable.app",
  // Stable preview host for this project (immutable, scoped to project ID)
  "project--48f03e84-6905-4900-89ea-1767b1d52885-dev.lovable.app",
  "project--48f03e84-6905-4900-89ea-1767b1d52885.lovable.app",
  "id-preview--48f03e84-6905-4900-89ea-1767b1d52885.lovable.app",
  "48f03e84-6905-4900-89ea-1767b1d52885.lovableproject.com",
]);

function validateReturnUrl(returnUrl: string): string {
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    throw new Error("Invalid returnUrl");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid returnUrl protocol");
  }
  const host = url.hostname;
  // Strict allowlist — no wildcard subdomain matching. Localhost is allowed
  // for local dev only (http). All production hosts must be enumerated above
  // to prevent open-redirect via attacker-controlled lovable.app subdomains.
  const ok = ALLOWED_RETURN_HOSTS.has(host) || host === "localhost" || host === "127.0.0.1";
  if (!ok) throw new Error("Invalid returnUrl host");
  return returnUrl;
}

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId: string },
): Promise<string> {
  if (!/^[a-zA-Z0-9-]+$/.test(options.userId)) throw new Error("Invalid userId");

  const found = await stripe.customers.search({
    query: `metadata['userId']:'${options.userId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;

  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const c = existing.data[0];
      if (c.metadata?.userId !== options.userId) {
        await stripe.customers.update(c.id, {
          metadata: { ...c.metadata, userId: options.userId },
        });
      }
      return c.id;
    }
  }

  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    metadata: { userId: options.userId },
  });
  return created.id;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

let _adminSupabase: ReturnType<typeof createClient> | null = null;
function getAdminSupabase() {
  if (!_adminSupabase) {
    _adminSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminSupabase;
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    priceId: string;
    returnUrl: string;
    environment: StripeEnv;
    uiMode?: "embedded" | "hosted";
  }) => {
    if (!/^[a-zA-Z0-9_]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (data.uiMode && data.uiMode !== "embedded" && data.uiMode !== "hosted") {
      throw new Error("Invalid uiMode");
    }
    validateReturnUrl(data.returnUrl);
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const uiMode = data.uiMode ?? "hosted";
    const { data: { user } } = await supabase.auth.getUser();
    const stripe = createStripeClient(data.environment);
    console.log("[stripe] createCheckoutSession start", {
      env: data.environment,
      priceId: data.priceId,
      uiMode,
      userId,
    });

    const prices = await withTimeout(
      stripe.prices.list({ lookup_keys: [data.priceId] }),
      10_000,
      "stripe.prices.list",
    );
    if (!prices.data.length) {
      console.error("[stripe] price not found for lookup_key", { priceId: data.priceId, env: data.environment });
      throw new Error(`Price "${data.priceId}" not found in ${data.environment}. Verify product setup.`);
    }
    const stripePrice = prices.data[0];
    console.log("[stripe] resolved price", {
      lookupKey: data.priceId,
      stripePriceId: stripePrice.id,
      livemode: stripePrice.livemode,
    });

    if (data.environment === "live" && !stripePrice.livemode) {
      throw new Error("Mode mismatch: live env resolved a test-mode price");
    }
    if (data.environment === "sandbox" && stripePrice.livemode) {
      throw new Error("Mode mismatch: sandbox env resolved a live-mode price");
    }

    const customerId = await withTimeout(
      resolveOrCreateCustomer(stripe, { email: user?.email ?? undefined, userId }),
      10_000,
      "resolveOrCreateCustomer",
    );

    const baseSessionParams = {
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      automatic_tax: { enabled: true },
      metadata: { userId },
      subscription_data: { metadata: { userId } },
    };
    let sessionParams: any;
    if (uiMode === "embedded") {
      sessionParams = {
        ...baseSessionParams,
        ui_mode: "embedded",
        return_url: data.returnUrl,
      };
      console.log("[stripe] embedded branch params", {
        ui_mode: sessionParams.ui_mode,
        return_url: sessionParams.return_url,
        priceId: data.priceId,
        env: data.environment,
        userId,
      });
    } else {
      // Hosted Stripe-page checkout
      // Cancel back to the same origin's pricing page
      let cancelUrl: string;
      try {
        const u = new URL(data.returnUrl);
        cancelUrl = `${u.origin}/pricing?checkout=cancelled`;
      } catch {
        cancelUrl = data.returnUrl;
      }
      sessionParams = {
        ...baseSessionParams,
        success_url: data.returnUrl,
        cancel_url: cancelUrl,
      };
      console.log("[stripe] hosted branch params", {
        success_url: sessionParams.success_url,
        cancel_url: sessionParams.cancel_url,
        has_ui_mode: "ui_mode" in sessionParams,
        has_return_url: "return_url" in sessionParams,
        env: data.environment,
      });
    }

    console.log("[stripe] exact checkout sessionParams", sessionParams);

    let session;
    try {
      session = await withTimeout(
        stripe.checkout.sessions.create(sessionParams),
        10_000,
        "stripe.checkout.sessions.create",
      );
    } catch (err: any) {
      console.error("[stripe] checkout.sessions.create failed:", {
        message: err?.message,
        type: err?.type,
        code: err?.code,
        param: err?.param,
        priceId: data.priceId,
        env: data.environment,
        uiMode,
        userId,
      });
      throw new Error(err?.message || "Could not start checkout. Please try again.");
    }

    console.log("[stripe] checkout session created", {
      id: session.id,
      url: session.url,
      client_secret: session.client_secret,
      ui_mode: session.ui_mode,
      mode: session.mode,
      env: data.environment,
      requestedUiMode: uiMode,
    });

    let hostedUrl = session.url ?? null;
    if (uiMode === "hosted" && !hostedUrl && session.id) {
      console.warn("[stripe] hosted session missing url on create response; retrieving session", {
        sessionId: session.id,
        has_ui_mode: "ui_mode" in sessionParams,
        has_return_url: "return_url" in sessionParams,
      });
      const retrieved = await withTimeout(
        stripe.checkout.sessions.retrieve(session.id),
        10_000,
        "stripe.checkout.sessions.retrieve",
      );
      console.log("[stripe] checkout session retrieved", {
        id: retrieved.id,
        url: retrieved.url,
        client_secret: retrieved.client_secret,
        ui_mode: retrieved.ui_mode,
        mode: retrieved.mode,
        env: data.environment,
        requestedUiMode: uiMode,
      });
      session = retrieved;
      hostedUrl = retrieved.url ?? null;
    }

    if (uiMode === "embedded") {
      if (!session.client_secret) throw new Error("Stripe returned a session without a client_secret");
      if (session.mode !== "subscription") {
        throw new Error(`Unexpected session mode: ${session.mode}`);
      }
    } else {
      if (!hostedUrl) {
        console.warn("[stripe] hosted checkout continuing without url; client will redirect with sessionId", {
          sessionId: session.id,
          has_ui_mode: "ui_mode" in sessionParams,
          has_return_url: "return_url" in sessionParams,
        });
      }
    }

    return {
      clientSecret: session.client_secret ?? null,
      hostedUrl,
      sessionId: session.id,
      mode: session.mode,
      livemode: session.livemode,
      uiMode,
    };
  });

export const createAnalysisUnlockCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    matchId: string;
    returnUrl: string;
    environment: StripeEnv;
  }) => {
    if (!data.matchId || data.matchId.length > 128 || !/^[A-Za-z0-9_\-:.]+$/.test(data.matchId)) {
      throw new Error("Invalid matchId");
    }
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    validateReturnUrl(data.returnUrl);
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: { user } } = await supabase.auth.getUser();

    // Verified-data gate: only allow paid unlock when we have enough verified
    // signals to produce a reliable analysis. Better to refuse the sale than
    // to deliver hallucinated H2H / scorelines for €5.99.
    try {
      const { checkMatchUnlockEligibility } = await import("@/lib/ai-analysis.server");
      const eligibility = await checkMatchUnlockEligibility(data.matchId);
      if (!eligibility.eligible) {
        throw new Error(
          `Premium analysis is unavailable for this match: ${eligibility.reason}. We only sell unlocks where verified data is sufficient.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Premium analysis is unavailable")) throw err;
      console.error("[unlock] eligibility check failed", err);
      throw new Error("Could not verify match data quality. Please try again later.");
    }

    const stripe = createStripeClient(data.environment);

    const prices = await withTimeout(
      stripe.prices.list({ lookup_keys: ["analysis_unlock_one_time"] }),
      10_000,
      "stripe.prices.list",
    );
    if (!prices.data.length) throw new Error("Unlock price not configured");
    const stripePrice = prices.data[0];

    const customerId = await withTimeout(
      resolveOrCreateCustomer(stripe, { email: user?.email ?? undefined, userId }),
      10_000,
      "resolveOrCreateCustomer",
    );

    let cancelUrl: string;
    try {
      const u = new URL(data.returnUrl);
      cancelUrl = `${u.origin}/analyzer?matchId=${encodeURIComponent(data.matchId)}&unlock=cancelled`;
    } catch {
      cancelUrl = data.returnUrl;
    }

    const successUrl = data.returnUrl.includes("{CHECKOUT_SESSION_ID}")
      ? data.returnUrl
      : `${data.returnUrl}${data.returnUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        matchId: data.matchId,
        kind: "analysis_unlock",
        environment: data.environment,
      },
      payment_intent_data: {
        metadata: {
          userId,
          matchId: data.matchId,
          kind: "analysis_unlock",
          environment: data.environment,
        },
      },
    });

    return { hostedUrl: session.url, sessionId: session.id };
  });

export const confirmAnalysisUnlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    sessionId: string;
    matchId: string;
    environment: StripeEnv;
  }) => {
    if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    if (!data.matchId || data.matchId.length > 128 || !/^[A-Za-z0-9_\-:.]+$/.test(data.matchId)) {
      throw new Error("Invalid matchId");
    }
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const stripe = createStripeClient(data.environment);
    const session = await withTimeout(
      stripe.checkout.sessions.retrieve(data.sessionId),
      10_000,
      "stripe.checkout.sessions.retrieve",
    );

    if (session.mode !== "payment") throw new Error("Invalid checkout session");
    if (session.metadata?.kind !== "analysis_unlock") throw new Error("Invalid unlock session");
    if (session.metadata?.userId !== userId || session.metadata?.matchId !== data.matchId) {
      throw new Error("Checkout session does not match this account or match");
    }
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      throw new Error("Payment has not completed yet");
    }

    const sb = getAdminSupabase();
    const { error } = await (sb.from("analysis_unlocks") as any).insert({
      user_id: userId,
      match_id: data.matchId,
      environment: data.environment,
      stripe_session_id: session.id,
      amount_cents: session.amount_total ?? null,
    });
    if (error && !/duplicate key|unique/i.test(error.message ?? "")) {
      throw new Error(error.message);
    }

    return { unlocked: true };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => {
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (data.returnUrl) validateReturnUrl(data.returnUrl);
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !sub?.stripe_customer_id) throw new Error("No subscription found");

    const stripe = createStripeClient(data.environment);
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      ...(data.returnUrl && { return_url: data.returnUrl }),
    });
    return portal.url;
  });
