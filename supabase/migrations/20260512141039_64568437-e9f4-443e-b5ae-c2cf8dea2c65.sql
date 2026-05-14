-- Holding-period support for unlock-based affiliate commissions
ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS available_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_id uuid,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'subscription';

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_commissions_unlock_id_uniq
  ON public.affiliate_commissions(unlock_id)
  WHERE unlock_id IS NOT NULL;

-- Credit a commission for a one-time analysis unlock, with a 7-day hold.
CREATE OR REPLACE FUNCTION public.credit_unlock_commission(_unlock_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid;
  v_amount_cents integer;
  v_created timestamptz;
  v_referrer uuid;
  v_aff_id uuid;
  v_rate numeric;
  v_amount numeric;
BEGIN
  IF _unlock_id IS NULL THEN RETURN; END IF;

  -- Idempotency: skip if we've already credited this unlock.
  IF EXISTS (SELECT 1 FROM public.affiliate_commissions WHERE unlock_id = _unlock_id) THEN
    RETURN;
  END IF;

  SELECT user_id, amount_cents, created_at
  INTO v_user, v_amount_cents, v_created
  FROM public.analysis_unlocks WHERE id = _unlock_id;
  IF v_user IS NULL OR v_amount_cents IS NULL OR v_amount_cents <= 0 THEN RETURN; END IF;

  SELECT referred_by INTO v_referrer FROM public.profiles WHERE id = v_user;
  IF v_referrer IS NULL OR v_referrer = v_user THEN RETURN; END IF;

  SELECT id, commission_rate INTO v_aff_id, v_rate
  FROM public.affiliates WHERE user_id = v_referrer LIMIT 1;
  IF v_aff_id IS NULL THEN RETURN; END IF;

  v_amount := round(((v_amount_cents::numeric / 100.0) * coalesce(v_rate, 30) / 100.0)::numeric, 2);
  IF v_amount <= 0 THEN RETURN; END IF;

  INSERT INTO public.affiliate_commissions
    (affiliate_id, referred_user_id, amount, status, period_month, source, unlock_id, available_at)
  VALUES
    (v_aff_id, v_user, v_amount, 'holding',
     date_trunc('month', coalesce(v_created, now()))::date,
     'unlock', _unlock_id,
     coalesce(v_created, now()) + interval '7 days');
END;
$$;

REVOKE ALL ON FUNCTION public.credit_unlock_commission(uuid) FROM PUBLIC, anon, authenticated;

-- Promote matured holding commissions to pending and bump affiliate balances.
CREATE OR REPLACE FUNCTION public.release_matured_affiliate_commissions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
  v_released integer := 0;
BEGIN
  FOR rec IN
    SELECT id, affiliate_id, amount
    FROM public.affiliate_commissions
    WHERE status = 'holding'
      AND available_at IS NOT NULL
      AND available_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.affiliate_commissions
      SET status = 'pending'
      WHERE id = rec.id;

    UPDATE public.affiliates
      SET total_earned = total_earned + rec.amount,
          pending_payout = pending_payout + rec.amount
      WHERE id = rec.affiliate_id;

    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_matured_affiliate_commissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_matured_affiliate_commissions() TO authenticated;

-- Make sure withdrawals see freshly matured commissions.
CREATE OR REPLACE FUNCTION public.request_payout(_amount numeric, _method_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_aff_id uuid;
  v_pending numeric;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF _amount IS NULL OR _amount < 150 THEN RAISE EXCEPTION 'minimum withdrawal is 150 EUR' USING ERRCODE='22023'; END IF;
  IF _method_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.payout_methods WHERE id=_method_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'invalid payout method' USING ERRCODE='22023';
  END IF;

  -- Release any matured holding commissions before checking balance.
  PERFORM public.release_matured_affiliate_commissions();

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':payout', 0));

  SELECT id, pending_payout INTO v_aff_id, v_pending FROM public.affiliates WHERE user_id=v_uid;
  IF v_aff_id IS NULL THEN RAISE EXCEPTION 'no affiliate account' USING ERRCODE='42501'; END IF;
  IF _amount > v_pending THEN RAISE EXCEPTION 'insufficient pending balance' USING ERRCODE='22023'; END IF;

  INSERT INTO public.payout_requests (user_id, amount, method_id) VALUES (v_uid, _amount, _method_id) RETURNING id INTO v_id;
  UPDATE public.affiliates SET pending_payout = pending_payout - _amount WHERE id=v_aff_id;
  RETURN v_id;
END;
$function$;
