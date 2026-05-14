-- Ensure trigger exists
DROP TRIGGER IF EXISTS guard_subscription_columns_trg ON public.subscriptions;
CREATE TRIGGER guard_subscription_columns_trg
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_columns();

-- Lock down column-level UPDATE privileges
REVOKE UPDATE ON public.subscriptions FROM anon, authenticated, public;
GRANT UPDATE (cancel_at_period_end, updated_at) ON public.subscriptions TO authenticated;