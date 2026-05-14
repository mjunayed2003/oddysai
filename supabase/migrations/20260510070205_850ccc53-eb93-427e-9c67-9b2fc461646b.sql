
DROP POLICY IF EXISTS analyses_insert_own ON public.analyses;
CREATE POLICY analyses_insert_own ON public.analyses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS analyses_select_own ON public.analyses;
CREATE POLICY analyses_select_own ON public.analyses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE UPDATE ON public.subscriptions FROM authenticated;
GRANT UPDATE (cancel_at_period_end, updated_at) ON public.subscriptions TO authenticated;

REVOKE UPDATE ON public.affiliates FROM authenticated;
GRANT UPDATE (referral_code) ON public.affiliates TO authenticated;
