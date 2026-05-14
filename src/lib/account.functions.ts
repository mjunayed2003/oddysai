import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logSecurityEvent } from "./security-audit.server";

// Plan upgrades are gated by Stripe — only handled by the verified webhook
// (see src/routes/api/public/payments/webhook.ts) which calls subscribe_to_plan
// via the service role. This server function only allows the user to set
// themselves to "free" (e.g. legacy self-downgrade). Paid tiers must come
// through Stripe to prevent unpaid privilege escalation.
const planSchema = z.object({ plan: z.literal("free") });

export const subscribeToPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => planSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Per-user rate limit: max 10 plan changes per hour (re-implemented inline
    // since check_rate_limit relies on auth.uid() which is null under service role).
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "plan_change")
      .gte("created_at", since);
    if (countErr) throw new Response("rate-limit check failed", { status: 500 });
    if ((count ?? 0) >= 10) throw new Response("rate limit exceeded", { status: 429 });

    const { error } = await supabaseAdmin.rpc("subscribe_to_plan", {
      _user_id: userId,
      _plan: data.plan,
    });
    if (error) {
      console.error("subscribe_to_plan failed:", error);
      throw new Response("Could not change plan. Please try again.", { status: 500 });
    }

    await supabaseAdmin.from("api_usage").insert({ user_id: userId, kind: "plan_change", cost: 0 });
    await logSecurityEvent({
      action: "subscription.changed",
      userId,
      target: data.plan,
      request: getRequest(),
      meta: { plan: data.plan },
    });
    return { ok: true };
  });

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "subscription_cancel")
      .gte("created_at", since);
    if (countErr) throw new Response("rate-limit check failed", { status: 500 });
    if ((count ?? 0) >= 5) throw new Response("rate limit exceeded", { status: 429 });

    const { error } = await supabaseAdmin.rpc("cancel_my_subscription", { _user_id: userId });
    if (error) {
      console.error("cancel_my_subscription failed:", error);
      throw new Response("Could not cancel subscription. Please try again.", { status: 500 });
    }

    await supabaseAdmin.from("api_usage").insert({ user_id: userId, kind: "subscription_cancel", cost: 0 });
    await logSecurityEvent({
      action: "subscription.canceled",
      userId,
      request: getRequest(),
    });
    return { ok: true };
  });

export const getAffiliateLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin.rpc("get_affiliate_leaderboard");
    if (error) {
      console.error("get_affiliate_leaderboard failed:", error);
      throw new Response("Could not load leaderboard.", { status: 500 });
    }
    // Anonymize: never expose other affiliates' referral codes or precise
    // earnings to authenticated users. Mask code to a short hash, bucket
    // earnings to the nearest €10, and keep only an approximate sub count.
    const rows = (data ?? []) as Array<{ referral_code: string; total_earned: number; total_generated: number; total_active_subs: number; total_signups: number }>;
    const masked = rows.map((r, i) => ({
      rank: i + 1,
      referral_code: `${r.referral_code.slice(0, 2)}••••`,
      total_earned: Math.floor(Number(r.total_earned ?? 0) / 10) * 10,
      total_generated: Math.floor(Number(r.total_generated ?? 0) / 10) * 10,
      total_active_subs: r.total_active_subs ?? 0,
      total_signups: r.total_signups ?? 0,
    }));
    return { leaderboard: masked };
  });

function maskEmail(email: string | null | undefined): string {
  if (!email) return "anonymous";
  const [local, domain] = email.split("@");
  if (!domain) return "anonymous";
  const visible = local.slice(0, Math.min(4, Math.max(2, local.length - 4)));
  return `${visible}${"•".repeat(5)}@${domain}`;
}

export const getReferralActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    const { data: affiliate } = await supabaseAdmin
      .from("affiliates")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: referred, error: refErr } = await supabaseAdmin
      .from("profiles")
      .select("id, created_at")
      .eq("referred_by", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (refErr) throw new Response(refErr.message, { status: 500 });

    const referredIds = (referred ?? []).map((r) => r.id as string);
    if (referredIds.length === 0) return { referrals: [] };

    const { data: unlocks } = await supabaseAdmin
      .from("analysis_unlocks")
      .select("user_id")
      .in("user_id", referredIds);
    const unlockCount = new Map<string, number>();
    for (const u of unlocks ?? []) {
      const id = (u as { user_id: string }).user_id;
      unlockCount.set(id, (unlockCount.get(id) ?? 0) + 1);
    }

    const commissionTotal = new Map<string, number>();
    if (affiliate?.id) {
      const { data: commissions } = await supabaseAdmin
        .from("affiliate_commissions")
        .select("referred_user_id, amount")
        .eq("affiliate_id", affiliate.id)
        .in("referred_user_id", referredIds);
      for (const c of commissions ?? []) {
        const row = c as { referred_user_id: string; amount: number };
        commissionTotal.set(
          row.referred_user_id,
          (commissionTotal.get(row.referred_user_id) ?? 0) + Number(row.amount ?? 0),
        );
      }
    }

    const referrals = await Promise.all(
      (referred ?? []).map(async (r) => {
        const profile = r as { id: string; created_at: string };
        let email: string | null = null;
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(profile.id);
          email = data.user?.email ?? null;
        } catch {
          email = null;
        }
        return {
          maskedEmail: maskEmail(email),
          unlocks: unlockCount.get(profile.id) ?? 0,
          commission: Number((commissionTotal.get(profile.id) ?? 0).toFixed(2)),
          joinedAt: profile.created_at,
        };
      }),
    );

    return {
      referrals: referrals
        .filter((r) => r.unlocks > 0 || r.commission > 0)
        .sort((a, b) => b.commission - a.commission || b.unlocks - a.unlocks),
    };
  });
