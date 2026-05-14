-- 1) Fix the affiliate guard so SECURITY DEFINER functions can update counters
CREATE OR REPLACE FUNCTION public.guard_affiliate_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Allow service_role OR SECURITY DEFINER context (current_user differs from session_user)
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
     OR current_user <> session_user THEN
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

-- 2) Payout methods (bank or USDT ERC-20)
CREATE TABLE public.payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('bank','usdt_erc20')),
  label text,
  -- Bank fields
  bank_account_holder text,
  bank_iban text,
  bank_swift text,
  bank_name text,
  -- Crypto fields
  wallet_address text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_method_shape CHECK (
    (type = 'bank' AND bank_iban IS NOT NULL AND bank_account_holder IS NOT NULL)
    OR (type = 'usdt_erc20' AND wallet_address ~ '^0x[a-fA-F0-9]{40}$')
  )
);
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY pm_select_own ON public.payout_methods FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY pm_insert_own ON public.payout_methods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY pm_update_own ON public.payout_methods FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY pm_delete_own ON public.payout_methods FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER touch_payout_methods BEFORE UPDATE ON public.payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Payout requests
CREATE TABLE public.payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 150),
  method_id uuid REFERENCES public.payout_methods(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY pr_select_own ON public.payout_requests FOR SELECT
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::app_role));

-- 4) Withdrawal RPC
CREATE OR REPLACE FUNCTION public.request_payout(_amount numeric, _method_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':payout', 0));

  SELECT id, pending_payout INTO v_aff_id, v_pending FROM public.affiliates WHERE user_id=v_uid;
  IF v_aff_id IS NULL THEN RAISE EXCEPTION 'no affiliate account' USING ERRCODE='42501'; END IF;
  IF _amount > v_pending THEN RAISE EXCEPTION 'insufficient pending balance' USING ERRCODE='22023'; END IF;

  INSERT INTO public.payout_requests (user_id, amount, method_id) VALUES (v_uid, _amount, _method_id) RETURNING id INTO v_id;
  UPDATE public.affiliates SET pending_payout = pending_payout - _amount WHERE id=v_aff_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_payout(numeric,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_payout(numeric,uuid) TO authenticated;