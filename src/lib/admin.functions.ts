import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * All admin server fns route through `requireAdmin`. Every successful call
 * also writes an entry to `admin_logs` via the `log_admin_action` RPC for
 * a tamper-evident audit trail. Calls go through the service-role client
 * because the elevated-privilege RPCs no longer expose EXECUTE to authenticated.
 */

async function audit(
  actorId: string,
  action: string,
  target: string | null = null,
  meta: Record<string, unknown> | null = null,
) {
  const { error } = await supabaseAdmin.rpc("log_admin_action", {
    _actor_id: actorId,
    _action: action,
    _target: target ?? undefined,
    _meta: (meta ?? undefined) as any,
  });
  if (error) console.error("admin audit failed:", error, { action, target });
}

// ---------- Reads ----------

// Lightweight server-side admin assertion for use in route `beforeLoad`.
// Returns `{ ok: true }` for admins; throws 401/403 otherwise so the route
// can redirect before any admin HTML is rendered.
export const assertAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => ({ ok: true as const }));

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { userId } = context;
    const [subsRes, usageRes] = await Promise.all([
      supabaseAdmin.from("subscriptions").select("*"),
      supabaseAdmin.from("api_usage").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (subsRes.error) {
      console.error("admin overview subs error:", subsRes.error);
      throw new Response("Failed to load admin overview.", { status: 500 });
    }
    if (usageRes.error) {
      console.error("admin overview usage error:", usageRes.error);
      throw new Response("Failed to load admin overview.", { status: 500 });
    }

    await audit(userId, "admin.overview.read");
    return { subs: subsRes.data ?? [], usage: usageRes.data ?? [] };
  });

export const getAdminAuditGrants = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { userId } = context;
    const [fnRes, tblRes] = await Promise.all([
      supabaseAdmin.rpc("audit_function_grants"),
      supabaseAdmin.rpc("audit_table_grants"),
    ]);
    if (fnRes.error) {
      console.error("audit_function_grants error:", fnRes.error);
      throw new Response("Failed to load security audit.", { status: 500 });
    }
    if (tblRes.error) {
      console.error("audit_table_grants error:", tblRes.error);
      throw new Response("Failed to load security audit.", { status: 500 });
    }

    await audit(userId, "admin.security_audit.read");
    return { functionGrants: fnRes.data ?? [], tableGrants: tblRes.data ?? [] };
  });

export const getAdminLogs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("admin_logs read error:", error);
      throw new Response("Failed to load admin logs.", { status: 500 });
    }
    return { logs: data ?? [] };
  });

// ---------- Writes (always audited) ----------

const noteSchema = z.object({ note: z.string().min(1).max(500) });

export const recordAdminNote = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => noteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await audit(userId, "admin.note.create", null, { note: data.note });
    return { ok: true };
  });
