-- ============================================================
-- 1. Per-user rate limit helper (uses api_usage as counter store)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_rate_limit(_kind text, _limit integer, _window interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _window IS NULL THEN
    RAISE EXCEPTION 'invalid rate limit parameters' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_kind, '')) = 0 OR length(_kind) > 64 THEN
    RAISE EXCEPTION 'invalid rate limit kind' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || _kind, 0));

  SELECT count(*)::int INTO v_count
  FROM public.api_usage
  WHERE user_id = v_uid AND kind = _kind AND created_at >= now() - _window;

  IF v_count >= _limit THEN
    RAISE EXCEPTION 'rate limit exceeded for %', _kind USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_usage (user_id, kind, cost) VALUES (v_uid, _kind, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, interval) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Harden subscribe_to_plan: stricter input validation + rate limit
-- ============================================================
CREATE OR REPLACE FUNCTION public.subscribe_to_plan(_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'plan is required' USING ERRCODE = '22023';
  END IF;
  v_plan := lower(trim(_plan));
  IF length(v_plan) > 16 THEN
    RAISE EXCEPTION 'invalid plan' USING ERRCODE = '22023';
  END IF;
  IF v_plan NOT IN ('free','basic','pro','elite') THEN
    RAISE EXCEPTION 'invalid plan' USING ERRCODE = '22023';
  END IF;

  -- Rate limit: max 10 plan changes per hour per user
  PERFORM public.check_rate_limit('plan_change', 10, interval '1 hour');

  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = v_uid) THEN
    UPDATE public.subscriptions
       SET plan = v_plan::plan_tier,
           status = 'active'::sub_status,
           cancel_at_period_end = false,
           current_period_start = now(),
           current_period_end = now() + interval '30 days',
           updated_at = now()
     WHERE user_id = v_uid;
  ELSE
    INSERT INTO public.subscriptions (user_id, plan, status, current_period_start, current_period_end)
    VALUES (v_uid, v_plan::plan_tier, 'active'::sub_status, now(), now() + interval '30 days');
  END IF;
END;
$$;

-- ============================================================
-- 3. Harden cancel_my_subscription: rate limit
-- ============================================================
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

  -- Rate limit: max 5 cancellations per hour
  PERFORM public.check_rate_limit('subscription_cancel', 5, interval '1 hour');

  UPDATE public.subscriptions
     SET status = 'canceled'::sub_status,
         cancel_at_period_end = true,
         updated_at = now()
   WHERE user_id = v_uid;
END;
$$;

-- ============================================================
-- 4. Re-affirm SECURITY DEFINER grants (defense against drift)
-- ============================================================
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_affiliate_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_subscription_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cancel_my_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;
REVOKE ALL ON FUNCTION public.subscribe_to_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscribe_to_plan(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_affiliate_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_affiliate_leaderboard() TO authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- ============================================================
-- 5. RBAC table-privilege audit (admin-only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_table_grants()
RETURNS TABLE(
  object_name text,
  role_name text,
  privilege text,
  expected boolean,
  actual boolean,
  ok boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      -- subscriptions: only column-level UPDATE for authenticated; no broad UPDATE/DELETE
      ('public.subscriptions',     'anon',          'INSERT', false),
      ('public.subscriptions',     'anon',          'UPDATE', false),
      ('public.subscriptions',     'anon',          'DELETE', false),
      ('public.subscriptions',     'authenticated', 'UPDATE', false),
      ('public.subscriptions',     'authenticated', 'DELETE', false),
      -- affiliates: only column-level UPDATE; no broad UPDATE/DELETE
      ('public.affiliates',        'anon',          'INSERT', false),
      ('public.affiliates',        'anon',          'UPDATE', false),
      ('public.affiliates',        'authenticated', 'UPDATE', false),
      ('public.affiliates',        'authenticated', 'DELETE', false),
      -- profiles: anon must not write
      ('public.profiles',          'anon',          'INSERT', false),
      ('public.profiles',          'anon',          'UPDATE', false),
      ('public.profiles',          'anon',          'DELETE', false),
      -- analyses: anon must not insert (regression guard for prior fix)
      ('public.analyses',          'anon',          'INSERT', false),
      -- api_usage: anon must not insert
      ('public.api_usage',         'anon',          'INSERT', false),
      -- user_roles: nobody but admin role mgmt should write
      ('public.user_roles',        'anon',          'INSERT', false),
      ('public.user_roles',        'authenticated', 'INSERT', false),
      ('public.user_roles',        'anon',          'UPDATE', false),
      ('public.user_roles',        'authenticated', 'UPDATE', false),
      ('public.user_roles',        'anon',          'DELETE', false),
      ('public.user_roles',        'authenticated', 'DELETE', false),
      -- admin_logs: no client-side writes
      ('public.admin_logs',        'anon',          'INSERT', false),
      ('public.admin_logs',        'authenticated', 'INSERT', false),
      -- affiliate_commissions: read-only for users (writes via service role)
      ('public.affiliate_commissions', 'anon',          'INSERT', false),
      ('public.affiliate_commissions', 'authenticated', 'INSERT', false),
      ('public.affiliate_commissions', 'authenticated', 'UPDATE', false),
      -- affiliate_clicks: only authenticated INSERT allowed
      ('public.affiliate_clicks',  'anon',          'INSERT', false),
      ('public.affiliate_clicks',  'authenticated', 'INSERT', true),
      -- matches: public read, no writes from clients
      ('public.matches',           'anon',          'INSERT', false),
      ('public.matches',           'authenticated', 'INSERT', false),
      ('public.matches',           'authenticated', 'UPDATE', false),
      ('public.matches',           'authenticated', 'DELETE', false)
    ) AS t(obj, role, priv, exp)
  LOOP
    object_name := rec.obj;
    role_name := rec.role;
    privilege := rec.priv;
    expected := rec.exp;
    BEGIN
      actual := has_table_privilege(rec.role, rec.obj, rec.priv);
    EXCEPTION WHEN OTHERS THEN
      actual := NULL;
    END;
    ok := (actual IS NOT DISTINCT FROM expected);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_table_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_table_grants() TO authenticated;