
-- Raise minimum withdrawal to 300 EUR
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
  IF _amount IS NULL OR _amount < 300 THEN RAISE EXCEPTION 'minimum withdrawal is 300 EUR' USING ERRCODE='22023'; END IF;
  IF _method_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.payout_methods WHERE id=_method_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'invalid payout method' USING ERRCODE='22023';
  END IF;

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

-- Allow 'revolut' as a payout method type. Revolut uses wallet_address column to
-- hold the @revtag, email, or phone number identifier.
ALTER TABLE public.payout_methods DROP CONSTRAINT IF EXISTS payout_methods_type_check;
ALTER TABLE public.payout_methods ADD CONSTRAINT payout_methods_type_check
  CHECK (type = ANY (ARRAY['bank'::text, 'usdt_erc20'::text, 'revolut'::text]));

ALTER TABLE public.payout_methods DROP CONSTRAINT IF EXISTS payout_method_shape;
ALTER TABLE public.payout_methods ADD CONSTRAINT payout_method_shape CHECK (
  ((type = 'bank') AND (bank_iban IS NOT NULL) AND (bank_account_holder IS NOT NULL))
  OR ((type = 'usdt_erc20') AND (wallet_address ~ '^0x[a-fA-F0-9]{40}$'))
  OR ((type = 'revolut') AND (wallet_address IS NOT NULL) AND (length(btrim(wallet_address)) >= 3))
);
