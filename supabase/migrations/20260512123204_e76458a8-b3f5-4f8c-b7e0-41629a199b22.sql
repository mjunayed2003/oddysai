-- 1) analyses: forbid all client-side INSERTs. Server code uses supabaseAdmin
--    (service role) which bypasses RLS, so the shared cache still works.
DROP POLICY IF EXISTS analyses_insert_own ON public.analyses;

-- 2) affiliate_clicks: drop the permissive client INSERT policy. Clients
--    already record clicks via the SECURITY DEFINER RPC `track_affiliate_click`,
--    which we harden below to ignore self-clicks.
DROP POLICY IF EXISTS aff_clicks_insert_authed ON public.affiliate_clicks;

CREATE OR REPLACE FUNCTION public.track_affiliate_click(
  _code text,
  _ip_hash text DEFAULT NULL::text,
  _user_agent text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_aff_id uuid;
  v_owner uuid;
BEGIN
  IF _code IS NULL OR length(_code) = 0 OR length(_code) > 32 THEN RETURN; END IF;

  SELECT id, user_id INTO v_aff_id, v_owner
  FROM public.affiliates
  WHERE referral_code = upper(_code)
  LIMIT 1;

  IF v_aff_id IS NULL THEN RETURN; END IF;

  -- Anti-fraud: ignore self-clicks (the affiliate's own account clicking
  -- their own referral link can't inflate their click count).
  IF auth.uid() IS NOT NULL AND auth.uid() = v_owner THEN
    RETURN;
  END IF;

  INSERT INTO public.affiliate_clicks (affiliate_id, ip_hash, user_agent)
  VALUES (v_aff_id, _ip_hash, left(coalesce(_user_agent, ''), 256));

  UPDATE public.affiliates
  SET total_clicks = total_clicks + 1
  WHERE id = v_aff_id;
END;
$function$;
