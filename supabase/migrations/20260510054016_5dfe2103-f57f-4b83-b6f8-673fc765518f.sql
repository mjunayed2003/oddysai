
-- 1. Subscriptions: restrict UPDATE at column level + scope to authenticated
DROP POLICY IF EXISTS subs_update_own ON public.subscriptions;

REVOKE UPDATE ON public.subscriptions FROM anon, authenticated, public;
GRANT UPDATE (cancel_at_period_end, updated_at) ON public.subscriptions TO authenticated;

CREATE POLICY subs_update_own ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Ensure trigger is in place (idempotent)
DROP TRIGGER IF EXISTS guard_subscription_columns_trg ON public.subscriptions;
CREATE TRIGGER guard_subscription_columns_trg
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_columns();

-- 2. Affiliates: restrict UPDATE at column level (referral_code only) + scope already authenticated
REVOKE UPDATE ON public.affiliates FROM anon, authenticated, public;
GRANT UPDATE (referral_code) ON public.affiliates TO authenticated;

-- Ensure trigger is in place (idempotent)
DROP TRIGGER IF EXISTS guard_affiliate_columns_trg ON public.affiliates;
CREATE TRIGGER guard_affiliate_columns_trg
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.guard_affiliate_columns();

-- 3. api_usage: scope INSERT policy to authenticated role explicitly
DROP POLICY IF EXISTS api_usage_insert_own ON public.api_usage;

CREATE POLICY api_usage_insert_own ON public.api_usage
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
