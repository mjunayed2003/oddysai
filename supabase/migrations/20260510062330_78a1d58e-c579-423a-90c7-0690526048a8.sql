-- Free preview quota: 3 AI analyses/month for free-tier users
CREATE OR REPLACE FUNCTION public.consume_free_preview(_user_id uuid, _limit integer DEFAULT 3)
RETURNS TABLE(allowed boolean, used integer, monthly_limit integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_caller IS NULL OR v_caller <> _user_id THEN
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

REVOKE ALL ON FUNCTION public.consume_free_preview(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_free_preview(uuid, integer) TO authenticated;

-- Admin audit log writer (server-only via SECURITY DEFINER + role check)
CREATE OR REPLACE FUNCTION public.log_admin_action(_action text, _target text, _meta jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _action IS NULL OR length(_action) = 0 OR length(_action) > 64 THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_logs (actor_id, action, target, meta)
  VALUES (v_caller, _action, _target, _meta)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, jsonb) TO authenticated;