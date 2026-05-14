
-- Track if a subscription has already paid commission (idempotent crediting)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS affiliate_credited_at timestamptz;

-- Public click tracker: anyone visiting /login?ref=CODE can call this.
CREATE OR REPLACE FUNCTION public.track_affiliate_click(_code text, _ip_hash text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_aff_id uuid;
BEGIN
  IF _code IS NULL OR length(_code) = 0 OR length(_code) > 32 THEN RETURN; END IF;
  SELECT id INTO v_aff_id FROM public.affiliates WHERE referral_code = upper(_code) LIMIT 1;
  IF v_aff_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.affiliate_clicks (affiliate_id, ip_hash, user_agent)
  VALUES (v_aff_id, _ip_hash, left(coalesce(_user_agent, ''), 256));
  UPDATE public.affiliates SET total_clicks = total_clicks + 1 WHERE id = v_aff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_affiliate_click(text, text, text) TO anon, authenticated;

-- Update the new-user trigger so a promo code in signup metadata attributes
-- the new user to the affiliate AND bumps total_signups.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code text;
  promo text;
  v_referrer_user uuid;
  v_aff_id uuid;
BEGIN
  promo := nullif(upper(trim(new.raw_user_meta_data->>'promo_code')), '');

  IF promo IS NOT NULL THEN
    SELECT id, user_id INTO v_aff_id, v_referrer_user
    FROM public.affiliates WHERE referral_code = promo LIMIT 1;
    -- Don't allow self-referrals
    IF v_referrer_user = new.id THEN
      v_referrer_user := NULL;
      v_aff_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, display_name, referred_by)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    v_referrer_user
  );
  INSERT INTO public.bankrolls (user_id, starting_amount, current_amount, is_initialized) VALUES (new.id, 0, 0, false);
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user');
  INSERT INTO public.subscriptions (user_id, plan, status) VALUES (new.id, 'free', 'active');
  ref_code := upper(substring(replace(new.id::text,'-',''), 1, 8));
  INSERT INTO public.affiliates (user_id, referral_code) VALUES (new.id, ref_code);

  IF v_aff_id IS NOT NULL THEN
    UPDATE public.affiliates SET total_signups = total_signups + 1 WHERE id = v_aff_id;
  END IF;

  RETURN new;
END;
$$;

-- Idempotent commission crediting, called by the Stripe webhook (service role).
CREATE OR REPLACE FUNCTION public.credit_affiliate_commission(
  _subscription_id uuid,
  _referred_user_id uuid,
  _plan_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_aff_id uuid;
  v_rate numeric;
  v_amount numeric;
  v_already timestamptz;
BEGIN
  IF _referred_user_id IS NULL OR _plan_amount IS NULL OR _plan_amount <= 0 THEN RETURN; END IF;

  -- Idempotency: only credit once per subscription row.
  SELECT affiliate_credited_at INTO v_already
  FROM public.subscriptions WHERE id = _subscription_id;
  IF v_already IS NOT NULL THEN RETURN; END IF;

  SELECT referred_by INTO v_referrer FROM public.profiles WHERE id = _referred_user_id;
  IF v_referrer IS NULL THEN RETURN; END IF;

  SELECT id, commission_rate INTO v_aff_id, v_rate
  FROM public.affiliates WHERE user_id = v_referrer LIMIT 1;
  IF v_aff_id IS NULL THEN RETURN; END IF;

  v_amount := round((_plan_amount * coalesce(v_rate, 30) / 100.0)::numeric, 2);

  INSERT INTO public.affiliate_commissions (affiliate_id, referred_user_id, amount, status, period_month)
  VALUES (v_aff_id, _referred_user_id, v_amount, 'pending', date_trunc('month', now())::date);

  UPDATE public.affiliates
     SET total_active_subs = total_active_subs + 1,
         total_earned = total_earned + v_amount,
         pending_payout = pending_payout + v_amount
   WHERE id = v_aff_id;

  UPDATE public.subscriptions
     SET affiliate_credited_at = now()
   WHERE id = _subscription_id;
END;
$$;
