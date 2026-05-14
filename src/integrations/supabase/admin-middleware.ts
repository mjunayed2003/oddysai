import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server middleware that requires the caller to be an authenticated user
 * with the `admin` role. Uses the service-role client to read user_roles
 * (definer role-check helpers are no longer exposed to authenticated).
 */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) {
      console.error("admin role check failed:", error);
      throw new Response("Role check failed", { status: 500 });
    }
    if (!data) throw new Response("Forbidden", { status: 403 });
    return next({ context });
  });
