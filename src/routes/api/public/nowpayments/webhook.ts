import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Sort object keys recursively, then JSON.stringify — NOWPayments IPN signing rule.
function sortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${sortedStringify((obj as any)[k])}`)
    .join(",")}}`;
}

export const Route = createFileRoute("/api/public/nowpayments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
        if (!ipnSecret) {
          console.error("[nowpayments] IPN secret not configured");
          return new Response("Misconfigured", { status: 500 });
        }

        const signature = request.headers.get("x-nowpayments-sig");
        const body = await request.text();
        if (!signature) return new Response("Missing signature", { status: 401 });

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const expected = createHmac("sha512", ipnSecret)
          .update(sortedStringify(payload))
          .digest("hex");

        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          console.warn("[nowpayments] invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        const status: string = payload.payment_status;
        const paymentId: string = String(payload.payment_id ?? "");
        const invoiceId: string | null = payload.invoice_id ? String(payload.invoice_id) : null;
        const orderId: string | undefined = payload.order_id;

        // Locate our order row
        let row: any = null;
        if (invoiceId) {
          const { data } = await (supabaseAdmin
            .from("crypto_unlock_orders" as any) as any)
            .select("*")
            .eq("invoice_id", invoiceId)
            .maybeSingle();
          row = data;
        }
        if (!row && orderId) {
          // order_id format: unlock_{userId}_{matchId}_{ts}
          const m = orderId.match(/^unlock_([0-9a-f-]{36})_(.+)_(\d+)$/i);
          if (m) {
            const { data } = await (supabaseAdmin
              .from("crypto_unlock_orders" as any) as any)
              .select("*")
              .eq("user_id", m[1])
              .eq("match_id", m[2])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            row = data;
          }
        }

        if (!row) {
          console.warn("[nowpayments] order not found", { invoiceId, orderId });
          return new Response("ok"); // ack to avoid endless retries
        }

        await (supabaseAdmin.from("crypto_unlock_orders" as any) as any)
          .update({
            payment_id: paymentId || null,
            status,
            raw: payload,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        // Grant unlock on success
        if (status === "finished" || status === "confirmed" || status === "partially_paid") {
          const { error } = await (supabaseAdmin
            .from("analysis_unlocks" as any) as any)
            .insert({
              user_id: row.user_id,
              match_id: row.match_id,
              environment: "live",
              stripe_session_id: `nowpay_${paymentId || row.invoice_id}`,
              amount_cents: Math.round(Number(row.price_amount) * 100),
            });
          if (error && !/duplicate key|unique/i.test(error.message ?? "")) {
            console.error("[nowpayments] unlock insert failed", error);
          }
        }

        return new Response("ok");
      },
    },
  },
});
