import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SecurityAuditEvent =
  | "bet.placed"
  | "bet.settled"
  | "subscription.changed"
  | "subscription.canceled"
  | "bankroll.set"
  | "bankroll.edit"
  | "bankroll.reset"
  | "quick_prediction.consumed"
  | "auth.failed"
  | "ratelimit.exceeded";

interface LogArgs {
  action: SecurityAuditEvent;
  userId?: string | null;
  target?: string | null;
  request?: Request;
  meta?: Record<string, unknown>;
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

function extractIp(req?: Request): string | null {
  if (!req) return null;
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

/**
 * Append-only security audit trail. Failures are swallowed so audit logging
 * never blocks the primary action — but server logs still surface the error.
 */
export async function logSecurityEvent({ action, userId, target, request, meta }: LogArgs): Promise<void> {
  try {
    await supabaseAdmin.from("security_audit_log").insert({
      action,
      user_id: userId ?? null,
      target: target ?? null,
      ip_hash: hashIp(extractIp(request)),
      user_agent: request?.headers.get("user-agent")?.slice(0, 256) ?? null,
      meta: (meta ?? null) as never,
    });
  } catch (err) {
    console.error("[security-audit] failed to record event", action, err);
  }
}
