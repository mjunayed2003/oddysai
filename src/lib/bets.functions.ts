import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logSecurityEvent } from "./security-audit.server";

const logBetSchema = z.object({
  match_label: z.string().min(1).max(200),
  pick: z.string().min(1).max(120),
  market: z.string().min(1).max(60),
  odds: z.number().min(1.01).max(1000),
  stake: z.number().min(0.01).max(100000),
  match_id: z.string().uuid().optional(),
});

export const logBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => logBetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: inserted, error } = await supabaseAdmin.from("bets").insert({
      user_id: userId,
      match_label: data.match_label,
      pick: data.pick,
      market: data.market,
      odds: data.odds,
      stake: data.stake,
      match_id: data.match_id ?? null,
    }).select("id").maybeSingle();
    if (error) {
      console.error("logBet insert failed:", error);
      throw new Response("Failed to log bet. Please try again.", { status: 400 });
    }

    await logSecurityEvent({
      action: "bet.placed",
      userId,
      target: inserted?.id ?? null,
      request: getRequest(),
      meta: { stake: data.stake, odds: data.odds, market: data.market },
    });
    return { ok: true };
  });

const settleSchema = z.object({
  id: z.string().uuid(),
  result: z.enum(["won", "lost", "void"]),
});

export const settleBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: bet, error: readErr } = await supabaseAdmin
      .from("bets")
      .select("odds, stake, result, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Response("Lookup failed", { status: 500 });
    if (!bet || bet.user_id !== userId) throw new Response("Not found", { status: 404 });
    if (bet.result !== "pending") throw new Response("Bet already settled", { status: 409 });

    const odds = Number(bet.odds);
    const stake = Number(bet.stake);
    const pl = data.result === "won" ? stake * (odds - 1) : data.result === "lost" ? -stake : 0;

    const { error } = await supabaseAdmin
      .from("bets")
      .update({ result: data.result, profit_loss: pl, settled_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) {
      console.error("settleBet update failed:", error);
      throw new Response("Failed to settle bet. Please try again.", { status: 400 });
    }

    await logSecurityEvent({
      action: "bet.settled",
      userId,
      target: data.id,
      request: getRequest(),
      meta: { result: data.result, profit_loss: pl },
    });
    return { ok: true, profit_loss: pl };
  });
