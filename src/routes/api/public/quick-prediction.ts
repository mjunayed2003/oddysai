import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logSecurityEvent } from "@/lib/security-audit.server";

const MONTHLY_LIMIT = 1;

const inputSchema = z.object({
  homeTeam: z.string().trim().min(1).max(80),
  awayTeam: z.string().trim().min(1).max(80),
  league: z.string().trim().min(1).max(80).optional(),
  oddsHome: z.number().min(1.01).max(1000).optional(),
  oddsDraw: z.number().min(1.01).max(1000).optional(),
  oddsAway: z.number().min(1.01).max(1000).optional(),
});

function hashIp(ip: string | null): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(`${salt}:quick:${ip ?? "unknown"}`).digest("hex").slice(0, 32);
}

function extractIp(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

interface QuickResult {
  bestMarket: "home" | "draw" | "away";
  pickLabel: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  summary: string;
  warning: string;
  reduced: true;
}

async function runQuickPrediction(input: z.infer<typeof inputSchema>): Promise<QuickResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    // Fallback heuristic if AI gateway not configured
    return heuristic(input);
  }
  const prompt = `Reduced football prediction. Return strict JSON: {"bestMarket":"home|draw|away","confidence":0-99,"summary":"<<=180 chars>"}\nMatch: ${input.homeTeam} vs ${input.awayTeam}${input.league ? ` (${input.league})` : ""}.\nOdds: H=${input.oddsHome ?? "?"} D=${input.oddsDraw ?? "?"} A=${input.oddsAway ?? "?"}.\nKeep it neutral and brief. No guarantees.`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You output only valid compact JSON. No markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return heuristic(input);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { bestMarket?: string; confidence?: number; summary?: string };
    const bm = (parsed.bestMarket === "home" || parsed.bestMarket === "draw" || parsed.bestMarket === "away")
      ? parsed.bestMarket : "home";
    const conf = Math.max(35, Math.min(96, Math.round(Number(parsed.confidence) || 60)));
    return finish(input, bm, conf, String(parsed.summary || "").slice(0, 220));
  } catch {
    return heuristic(input);
  }
}

function heuristic(input: z.infer<typeof inputSchema>): QuickResult {
  const oH = input.oddsHome ?? 2.1, oD = input.oddsDraw ?? 3.4, oA = input.oddsAway ?? 3.5;
  const inv = { home: 1 / oH, draw: 1 / oD, away: 1 / oA };
  const sum = inv.home + inv.draw + inv.away;
  const probs = { home: inv.home / sum, draw: inv.draw / sum, away: inv.away / sum };
  const best = (Object.entries(probs) as Array<[keyof typeof probs, number]>).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  const conf = Math.round(40 + probs[best] * 50);
  const summary = `Implied market favourite: ${best === "home" ? input.homeTeam : best === "away" ? input.awayTeam : "Draw"}. Quick read only — full AI analysis is available with an account.`;
  return finish(input, best, conf, summary);
}

function finish(input: z.infer<typeof inputSchema>, bm: "home" | "draw" | "away", conf: number, summary: string): QuickResult {
  const risk: "low" | "medium" | "high" = conf >= 75 ? "low" : conf >= 60 ? "medium" : "high";
  const label = bm === "home" ? `${input.homeTeam} Win` : bm === "away" ? `${input.awayTeam} Win` : "Draw";
  return {
    bestMarket: bm,
    pickLabel: label,
    confidence: conf,
    risk,
    summary,
    warning: "Informational only. Betting involves risk. 18+.",
    reduced: true,
  };
}

export const Route = createFileRoute("/api/public/quick-prediction")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try { raw = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const parsed = inputSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid input" }, { status: 400 });
        }

        const ipHash = hashIp(extractIp(request));
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);

        const { count, error: countErr } = await supabaseAdmin
          .from("quick_predictions")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", monthStart.toISOString());
        if (countErr) {
          return Response.json({ error: "Quota lookup failed" }, { status: 500 });
        }
        if ((count ?? 0) >= MONTHLY_LIMIT) {
          return Response.json(
            { error: "Free monthly prediction already used. Sign up for full AI analysis.", code: "quota_exceeded" },
            { status: 402 },
          );
        }

        const result = await runQuickPrediction(parsed.data);

        await supabaseAdmin.from("quick_predictions").insert({
          ip_hash: ipHash,
          user_agent: request.headers.get("user-agent")?.slice(0, 256) ?? null,
          meta: { home: parsed.data.homeTeam, away: parsed.data.awayTeam, pick: result.bestMarket } as never,
        });
        await logSecurityEvent({
          action: "quick_prediction.consumed",
          request,
          meta: { home: parsed.data.homeTeam, away: parsed.data.awayTeam },
        });

        return Response.json({ ok: true, result, remaining: 0 });
      },
    },
  },
});
