-- Trigger-only functions: nobody should call directly
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_affiliate_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_subscription_columns() FROM PUBLIC, anon, authenticated;

-- Server-side only (called via service role from server functions)
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;

-- User-callable RPCs: authenticated only
REVOKE ALL ON FUNCTION public.cancel_my_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;

REVOKE ALL ON FUNCTION public.subscribe_to_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscribe_to_plan(text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_affiliate_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliate_leaderboard() TO authenticated;

-- has_role: needed by RLS policies (authenticated). Revoke from anon/public.
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;