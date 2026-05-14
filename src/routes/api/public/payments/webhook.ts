import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

const PRICE_TO_PLAN: Record<string, "basic" | "pro" | "elite"> = {
  basic_monthly: "basic",
  pro_monthly: "pro",
  elite_monthly: "elite",
};

// EUR price per monthly plan — keep in sync with src/routes/pricing.tsx.
const PLAN_AMOUNT: Record<"basic" | "pro" | "elite", number> = {
  basic: 19,
  pro: 29,
  elite: 79,
};

function planFromPrice(price: any): "basic" | "pro" | "elite" | "free" {
  const key =
    price?.lookup_key || price?.metadata?.lovable_external_id || "";
  return PRICE_TO_PLAN[key] ?? "free";
}

function isoFromUnix(s: number | null | undefined): string | null {
  return s ? new Date(s * 1000).toISOString() : null;
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata", subscription.id);
    return;
  }

  const item = subscription.items?.data?.[0];
  const lookupKey =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || null;
  const productId = typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  const plan = planFromPrice(item?.price);

  // Active / trialing / past_due => keep plan tier; canceled/etc => downgrade to free
  const stripeStatus = subscription.status as string;
  const isLive = ["active", "trialing", "past_due"].includes(stripeStatus);
  const dbStatus = isLive ? "active" : stripeStatus === "trialing" ? "trialing" : "canceled";

  const sb = getSupabase();

  // Find any existing row for this user (we keep one row per user that we update).
  const { data: existing } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    user_id: userId,
    plan: isLive ? plan : "free",
    status: dbStatus,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    product_id: productId,
    price_id: lookupKey,
    current_period_start: isoFromUnix(periodStart),
    current_period_end: isoFromUnix(periodEnd),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    environment: env,
    updated_at: new Date().toISOString(),
  };

  const table = sb.from("subscriptions") as any;
  let subscriptionRowId: string | null = null;
  if (existing) {
    subscriptionRowId = (existing as any).id;
    await table.update(row).eq("id", subscriptionRowId);
  } else {
    const inserted = await table.insert(row).select("id").maybeSingle();
    subscriptionRowId = (inserted.data as any)?.id ?? null;
  }

  // Credit affiliate commission once per paid subscription becoming active.
  if (isLive && plan !== "free" && subscriptionRowId) {
    const amount = PLAN_AMOUNT[plan];
    const { error: credErr } = await (sb.rpc as any)("credit_affiliate_commission", {
      _subscription_id: subscriptionRowId,
      _referred_user_id: userId,
      _plan_amount: amount,
    });
    if (credErr) console.error("credit_affiliate_commission failed:", credErr.message);
  }
}

async function handleAnalysisUnlock(session: any, env: StripeEnv) {
  const md = session?.metadata ?? {};
  if (md.kind !== "analysis_unlock") return;
  const userId = md.userId;
  const matchId = md.matchId;
  if (!userId || !matchId) {
    console.error("analysis_unlock missing userId/matchId", session.id);
    return;
  }
  if (
    session.payment_status &&
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return;
  }
  const sb = getSupabase();
  const { data: inserted, error } = await (sb.from("analysis_unlocks") as any)
    .insert({
      user_id: userId,
      match_id: matchId,
      environment: env,
      stripe_session_id: session.id,
      amount_cents: session.amount_total ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error && !/duplicate key|unique/i.test(error.message ?? "")) {
    console.error("analysis_unlock insert failed:", error.message);
    return;
  }

  // Resolve unlock id (insert may have been deduped by unique constraint).
  let unlockId: string | null = (inserted as any)?.id ?? null;
  if (!unlockId) {
    const { data: existing } = await (sb.from("analysis_unlocks") as any)
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();
    unlockId = (existing as any)?.id ?? null;
  }

  // Credit affiliate commission (7-day holding period). Idempotent.
  if (unlockId) {
    const { error: credErr } = await (sb.rpc as any)("credit_unlock_commission", {
      _unlock_id: unlockId,
    });
    if (credErr) console.error("credit_unlock_commission failed:", credErr.message);
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscription(event.data.object, env);
      break;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleAnalysisUnlock(event.data.object, env);
      break;
    default:
      console.log("Unhandled webhook event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook missing env param:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
