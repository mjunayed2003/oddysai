import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

// Major coins only (per product decision). Use NOWPayments ticker codes.
const ALLOWED_PAY_CURRENCIES = new Set([
  "btc",
  "eth",
  "usdterc20",
  "usdttrc20",
  "usdcerc20",
]);

const PRICE_EUR = 5.99;

function normalizeNowPaymentsKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[\u200B-\u200D\uFEFF\s]/g, "");
}

export const createCryptoUnlockInvoice = createServerFn({ method: "POST" })
  .inputValidator((data: {
    matchId: string;
    returnUrl: string;
    payCurrency?: string;
  }) => {
    if (!data.matchId || data.matchId.length > 128 || !/^[A-Za-z0-9_\-:.]+$/.test(data.matchId)) {
      throw new Error("Invalid matchId");
    }
    try {
      new URL(data.returnUrl);
    } catch {
      throw new Error("Invalid returnUrl");
    }
    if (data.payCurrency && !ALLOWED_PAY_CURRENCIES.has(data.payCurrency.toLowerCase())) {
      throw new Error("Unsupported coin");
    }
    return data;
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const apiKey = normalizeNowPaymentsKey(process.env.NOWPAYMENTS_API_KEY);
    if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not configured");
    console.log("[nowpayments] creating invoice with configured API key", { keyLength: apiKey.length });

    const { userId, supabase } = context;

    // Eligibility gate (same rule as Stripe path)
    try {
      const { checkMatchUnlockEligibility } = await import("@/lib/ai-analysis.server");
      const eligibility = await checkMatchUnlockEligibility(data.matchId);
      if (!eligibility.eligible) {
        throw new Error(`Premium analysis is unavailable: ${eligibility.reason}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Premium analysis")) throw err;
      console.error("[nowpayments] eligibility check failed", err);
      throw new Error("Could not verify match data quality. Please try again later.");
    }

    const orderId = `unlock_${userId}_${data.matchId}_${Date.now()}`;
    const ipnBase =
      process.env.PUBLIC_SITE_URL ||
      "https://oddysai.com";
    const ipnUrl = `${ipnBase}/api/public/nowpayments/webhook`;

    const body: Record<string, unknown> = {
      price_amount: PRICE_EUR,
      price_currency: "EUR",
      order_id: orderId,
      order_description: `Analysis unlock for match ${data.matchId}`,
      ipn_callback_url: ipnUrl,
      success_url: data.returnUrl,
      cancel_url: data.returnUrl.replace("unlock=success", "unlock=cancelled"),
      is_fixed_rate: true,
    };
    if (data.payCurrency) body.pay_currency = data.payCurrency.toLowerCase();

    const res = await fetch(`${NOWPAYMENTS_API}/invoice`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[nowpayments] invoice failed", res.status, json);
      const apiMsg = (json as any)?.message || (json as any)?.error;
      if (res.status === 401 || res.status === 403 || /invalid.*api.*key/i.test(String(apiMsg))) {
        throw new Error(
          "NOWPayments rejected the API key. In NOWPayments, save your payout wallet first, then create a brand-new production API key under Store Settings → API Keys and update NOWPAYMENTS_API_KEY. Do not use the IPN secret, JWT token, or sandbox key.",
        );
      }
      throw new Error(apiMsg || `NOWPayments error (${res.status})`);
    }

    // Track the order so the webhook can resolve user_id + match_id
    await supabase.from("crypto_unlock_orders" as any).insert({
      user_id: userId,
      match_id: data.matchId,
      environment: "live",
      provider: "nowpayments",
      invoice_id: String((json as any).id ?? orderId),
      pay_currency: data.payCurrency?.toLowerCase() ?? null,
      price_amount: PRICE_EUR,
      price_currency: "EUR",
      status: "pending",
      raw: json,
    });

    return {
      invoiceUrl: (json as any).invoice_url as string,
      invoiceId: String((json as any).id ?? orderId),
    };
  });
