
-- 1. Restrict analyses SELECT to owner only (or shared rows where user_id IS NULL)
DROP POLICY IF EXISTS analyses_select_authed ON public.analyses;
CREATE POLICY analyses_select_own
  ON public.analyses
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- 2. Subscriptions: rewrite INSERT to force plan='free' + status='active'
DROP POLICY IF EXISTS subs_insert_own ON public.subscriptions;
CREATE POLICY subs_insert_own
  ON public.subscriptions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND plan = 'free'
    AND status = 'active'
    AND stripe_subscription_id IS NULL
    AND stripe_customer_id IS NULL
  );

-- 3. Subscriptions: prevent users from mutating sensitive columns via UPDATE.
--    Keep policy in place (so cancel via SECURITY DEFINER fn still works for owner check),
--    but block sensitive column changes with a trigger that only the service role bypasses.
CREATE OR REPLACE FUNCTION public.guard_subscription_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / postgres bypass guard
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'forbidden: subscription field cannot be modified directly'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_subscription_columns_trg ON public.subscriptions;
CREATE TRIGGER guard_subscription_columns_trg
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_columns();

-- 4. SECURITY DEFINER subscribe / cancel functions (test mode plan changes)
CREATE OR REPLACE FUNCTION public.subscribe_to_plan(_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _plan NOT IN ('free','basic','pro','elite') THEN
    RAISE EXCEPTION 'invalid plan' USING ERRCODE = '22023';
  END IF;

  -- Upsert: if a subscription exists, update it; else insert.
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = v_uid) THEN
    UPDATE public.subscriptions
       SET plan = _plan::plan_tier,
           status = 'active'::sub_status,
           cancel_at_period_end = false,
           current_period_start = now(),
           current_period_end = now() + interval '30 days',
           updated_at = now()
     WHERE user_id = v_uid;
  ELSE
    INSERT INTO public.subscriptions (user_id, plan, status, current_period_start, current_period_end)
    VALUES (v_uid, _plan::plan_tier, 'active'::sub_status, now(), now() + interval '30 days');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_subscription()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.subscriptions
     SET status = 'canceled'::sub_status,
         cancel_at_period_end = true,
         updated_at = now()
   WHERE user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_to_plan(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.subscribe_to_plan(text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_my_subscription() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;

-- 5. Affiliates: explicit, restrictive INSERT policy
DROP POLICY IF EXISTS affiliates_insert_own ON public.affiliates;
CREATE POLICY affiliates_insert_own
  ON public.affiliates
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND commission_rate = 30
    AND total_earned = 0
    AND total_active_subs = 0
    AND total_signups = 0
    AND total_clicks = 0
    AND pending_payout = 0
    AND paid_payout = 0
  );

-- Prevent users from changing commission_rate / payout columns via UPDATE
CREATE OR REPLACE FUNCTION public.guard_affiliate_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.total_earned IS DISTINCT FROM OLD.total_earned
     OR NEW.total_active_subs IS DISTINCT FROM OLD.total_active_subs
     OR NEW.total_signups IS DISTINCT FROM OLD.total_signups
     OR NEW.total_clicks IS DISTINCT FROM OLD.total_clicks
     OR NEW.pending_payout IS DISTINCT FROM OLD.pending_payout
     OR NEW.paid_payout IS DISTINCT FROM OLD.paid_payout
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'forbidden: affiliate field cannot be modified directly'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_affiliate_columns_trg ON public.affiliates;
CREATE TRIGGER guard_affiliate_columns_trg
BEFORE UPDATE ON public.affiliates
FOR EACH ROW EXECUTE FUNCTION public.guard_affiliate_columns();

-- 6. Affiliate clicks: require authenticated insert
DROP POLICY IF EXISTS aff_clicks_insert_valid ON public.affiliate_clicks;
CREATE POLICY aff_clicks_insert_authed
  ON public.affiliate_clicks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.affiliates a WHERE a.id = affiliate_clicks.affiliate_id)
  );

-- 7. Lock down SECURITY DEFINER helpers from anon. Keep `has_role` callable
--    by authenticated (RLS policies need it). Restrict the rest.
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.get_affiliate_leaderboard() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliate_leaderboard() TO authenticated;
