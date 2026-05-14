CREATE OR REPLACE FUNCTION public.audit_function_grants()
RETURNS TABLE(
  function_signature text,
  role_name text,
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
      -- function signature, role, expected EXECUTE
      ('public.handle_new_user()',                       'anon',          false),
      ('public.handle_new_user()',                       'authenticated', false),
      ('public.touch_updated_at()',                      'anon',          false),
      ('public.touch_updated_at()',                      'authenticated', false),
      ('public.guard_affiliate_columns()',               'anon',          false),
      ('public.guard_affiliate_columns()',               'authenticated', false),
      ('public.guard_subscription_columns()',            'anon',          false),
      ('public.guard_subscription_columns()',            'authenticated', false),
      ('public.consume_ai_quota(uuid,integer)',          'anon',          false),
      ('public.consume_ai_quota(uuid,integer)',          'authenticated', false),
      ('public.cancel_my_subscription()',                'anon',          false),
      ('public.cancel_my_subscription()',                'authenticated', true),
      ('public.subscribe_to_plan(text)',                 'anon',          false),
      ('public.subscribe_to_plan(text)',                 'authenticated', true),
      ('public.get_affiliate_leaderboard()',             'anon',          false),
      ('public.get_affiliate_leaderboard()',             'authenticated', true),
      ('public.has_role(uuid,app_role)',                 'anon',          false),
      ('public.has_role(uuid,app_role)',                 'authenticated', true),
      ('public.audit_function_grants()',                 'anon',          false),
      ('public.audit_function_grants()',                 'authenticated', true)
    ) AS t(sig, role, exp)
  LOOP
    function_signature := rec.sig;
    role_name := rec.role;
    expected := rec.exp;
    BEGIN
      actual := has_function_privilege(rec.role, rec.sig, 'EXECUTE');
    EXCEPTION WHEN OTHERS THEN
      actual := NULL;
    END;
    ok := (actual IS NOT DISTINCT FROM expected);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_function_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_function_grants() TO authenticated;