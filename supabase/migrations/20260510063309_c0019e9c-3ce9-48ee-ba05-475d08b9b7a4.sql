
-- =========================================================
-- 1) Move has_role to a private (unexposed) schema
-- =========================================================
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- =========================================================
-- 2) Recreate every RLS policy referencing public.has_role
--    so it points at private.has_role
-- =========================================================
DROP POLICY IF EXISTS admin_logs_admin ON public.admin_logs;
CREATE POLICY admin_logs_admin ON public.admin_logs
  FOR ALL USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS aff_clicks_admin ON public.affiliate_clicks;
CREATE POLICY aff_clicks_admin ON public.affiliate_clicks
  FOR SELECT USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS aff_comm_own ON public.affiliate_commissions;
CREATE POLICY aff_comm_own ON public.affiliate_commissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.affiliates a
      WHERE a.id = affiliate_commissions.affiliate_id AND a.user_id = auth.uid()
    )
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS affiliates_select_own ON public.affiliates;
CREATE POLICY affiliates_select_own ON public.affiliates
  FOR SELECT USING (
    auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS api_usage_admin ON public.api_usage;
CREATE POLICY api_usage_admin ON public.api_usage
  FOR SELECT USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS matches_admin_write ON public.matches;
CREATE POLICY matches_admin_write ON public.matches
  FOR ALL USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS subs_select_own ON public.subscriptions;
CREATE POLICY subs_select_own ON public.subscriptions
  FOR SELECT USING (
    auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
CREATE POLICY user_roles_admin_all ON public.user_roles
  FOR ALL USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT USING (
    auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- =========================================================
-- 3) Drop public.has_role (now unused by policies)
-- =========================================================
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- =========================================================
-- 4) Replace user-context functions with _user_id/_actor_id signatures
--    so they can be called by service_role from server functions
-- =========================================================
DROP FUNCTION IF EXISTS public.cancel_my_subscription();
CREATE OR REPLACE FUNCTION public.cancel_my_subscription(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.subscriptions
     SET status = 'canceled'::sub_status,
         cancel_at_period_end = true,
         updated_at = now()
   WHERE user_id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_my_subscription(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.subscribe_to_plan(text);
CREATE OR REPLACE FUNCTION public.subscribe_to_plan(_user_id uuid, _plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user required' USING ERRCODE = '22023';
  END IF;
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'plan is required' USING ERRCODE = '22023';
  END IF;
  v_plan := lower(trim(_plan));
  IF v_plan NOT IN ('free','basic','pro','elite') THEN
    RAISE EXCEPTION 'invalid plan' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = _user_id) THEN
    UPDATE public.subscriptions
       SET plan = v_plan::plan_tier,
           status = 'active'::sub_status,
           cancel_at_period_end = false,
           current_period_start = now(),
           current_period_end = now() + interval '30 days',
           updated_at = now()
     WHERE user_id = _user_id;
  ELSE
    INSERT INTO public.subscriptions (user_id, plan, status, current_period_start, current_period_end)
    VALUES (_user_id, v_plan::plan_tier, 'active'::sub_status, now(), now() + interval '30 days');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.subscribe_to_plan(uuid, text) FROM PUBLIC, anon, authenticated;

-- log_admin_action: actor passed explicitly (server fn validates admin first)
DROP FUNCTION IF EXISTS public.log_admin_action(text, text, jsonb);
CREATE OR REPLACE FUNCTION public.log_admin_action(
  _actor_id uuid, _action text, _target text DEFAULT NULL, _meta jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'actor required' USING ERRCODE = '22023';
  END IF;
  IF _action IS NULL OR length(_action) = 0 OR length(_action) > 64 THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.admin_logs (actor_id, action, target, meta)
  VALUES (_actor_id, _action, _target, _meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_admin_action(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- consume_free_preview: allow service_role caller (auth.uid() may be NULL)
CREATE OR REPLACE FUNCTION public.consume_free_preview(_user_id uuid, _limit integer DEFAULT 3)
RETURNS TABLE(allowed boolean, used integer, monthly_limit integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user required' USING ERRCODE = '22023';
  END IF;
  IF v_caller IS NOT NULL AND v_caller <> _user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 100 THEN
    RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':free_preview', 0));

  SELECT count(*)::int INTO v_count
  FROM public.api_usage
  WHERE user_id = _user_id
    AND kind = 'ai_preview'
    AND created_at >= date_trunc('month', now());

  IF v_count >= _limit THEN
    RETURN QUERY SELECT false, v_count, _limit;
    RETURN;
  END IF;

  INSERT INTO public.api_usage (user_id, kind, cost) VALUES (_user_id, 'ai_preview', 0);
  RETURN QUERY SELECT true, v_count + 1, _limit;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_free_preview(uuid, integer) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 5) Revoke EXECUTE from authenticated/anon on remaining definer functions
-- =========================================================
REVOKE ALL ON FUNCTION public.audit_function_grants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_table_grants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_affiliate_leaderboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, interval) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 6) Update audit functions to use private.has_role and reflect new state
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_function_grants()
RETURNS TABLE(function_signature text, role_name text, expected boolean, actual boolean, ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rec RECORD;
BEGIN
  -- Internal admin gate (also EXECUTE-revoked from authenticated, only service_role can call)
  IF auth.uid() IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('public.handle_new_user()',                          'anon',          false),
      ('public.handle_new_user()',                          'authenticated', false),
      ('public.touch_updated_at()',                         'anon',          false),
      ('public.touch_updated_at()',                         'authenticated', false),
      ('public.guard_affiliate_columns()',                  'anon',          false),
      ('public.guard_affiliate_columns()',                  'authenticated', false),
      ('public.guard_subscription_columns()',               'anon',          false),
      ('public.guard_subscription_columns()',               'authenticated', false),
      ('public.consume_ai_quota(uuid,integer)',             'anon',          false),
      ('public.consume_ai_quota(uuid,integer)',             'authenticated', false),
      ('public.consume_free_preview(uuid,integer)',         'anon',          false),
      ('public.consume_free_preview(uuid,integer)',         'authenticated', false),
      ('public.cancel_my_subscription(uuid)',               'anon',          false),
      ('public.cancel_my_subscription(uuid)',               'authenticated', false),
      ('public.subscribe_to_plan(uuid,text)',               'anon',          false),
      ('public.subscribe_to_plan(uuid,text)',               'authenticated', false),
      ('public.get_affiliate_leaderboard()',                'anon',          false),
      ('public.get_affiliate_leaderboard()',                'authenticated', false),
      ('public.log_admin_action(uuid,text,text,jsonb)',     'anon',          false),
      ('public.log_admin_action(uuid,text,text,jsonb)',     'authenticated', false),
      ('public.audit_table_grants()',                       'anon',          false),
      ('public.audit_table_grants()',                       'authenticated', false),
      ('public.audit_function_grants()',                    'anon',          false),
      ('public.audit_function_grants()',                    'authenticated', false),
      ('public.check_rate_limit(text,integer,interval)',    'anon',          false),
      ('public.check_rate_limit(text,integer,interval)',    'authenticated', false),
      ('private.has_role(uuid,app_role)',                   'anon',          false),
      ('private.has_role(uuid,app_role)',                   'authenticated', true)
    ) AS t(sig, role, exp)
  LOOP
    function_signature := rec.sig;
    role_name := rec.role;
    expected := rec.exp;
    BEGIN actual := has_function_privilege(rec.role, rec.sig, 'EXECUTE');
    EXCEPTION WHEN OTHERS THEN actual := NULL;
    END;
    ok := (actual IS NOT DISTINCT FROM expected);
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_function_grants() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_table_grants()
RETURNS TABLE(object_name text, role_name text, privilege text, expected boolean, actual boolean, ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rec RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('public.subscriptions',     'anon',          'INSERT', false),
      ('public.subscriptions',     'anon',          'UPDATE', false),
      ('public.subscriptions',     'anon',          'DELETE', false),
      ('public.subscriptions',     'authenticated', 'UPDATE', false),
      ('public.subscriptions',     'authenticated', 'DELETE', false),
      ('public.affiliates',        'anon',          'INSERT', false),
      ('public.affiliates',        'anon',          'UPDATE', false),
      ('public.affiliates',        'authenticated', 'UPDATE', false),
      ('public.affiliates',        'authenticated', 'DELETE', false),
      ('public.profiles',          'anon',          'INSERT', false),
      ('public.profiles',          'anon',          'UPDATE', false),
      ('public.profiles',          'anon',          'DELETE', false),
      ('public.analyses',          'anon',          'INSERT', false),
      ('public.api_usage',         'anon',          'INSERT', false),
      ('public.user_roles',        'anon',          'INSERT', false),
      ('public.user_roles',        'authenticated', 'INSERT', false),
      ('public.user_roles',        'anon',          'UPDATE', false),
      ('public.user_roles',        'authenticated', 'UPDATE', false),
      ('public.user_roles',        'anon',          'DELETE', false),
      ('public.user_roles',        'authenticated', 'DELETE', false),
      ('public.admin_logs',        'anon',          'INSERT', false),
      ('public.admin_logs',        'authenticated', 'INSERT', false),
      ('public.affiliate_commissions', 'anon',          'INSERT', false),
      ('public.affiliate_commissions', 'authenticated', 'INSERT', false),
      ('public.affiliate_commissions', 'authenticated', 'UPDATE', false),
      ('public.affiliate_clicks',  'anon',          'INSERT', false),
      ('public.affiliate_clicks',  'authenticated', 'INSERT', true),
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
    BEGIN actual := has_table_privilege(rec.role, rec.obj, rec.priv);
    EXCEPTION WHEN OTHERS THEN actual := NULL;
    END;
    ok := (actual IS NOT DISTINCT FROM expected);
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_table_grants() FROM PUBLIC, anon, authenticated;
