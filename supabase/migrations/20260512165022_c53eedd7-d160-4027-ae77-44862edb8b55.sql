
CREATE TABLE public.crypto_unlock_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  match_id text NOT NULL,
  environment text NOT NULL DEFAULT 'live',
  provider text NOT NULL DEFAULT 'nowpayments',
  payment_id text UNIQUE,
  invoice_id text,
  pay_currency text,
  price_amount numeric NOT NULL,
  price_currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crypto_unlock_orders_user_idx ON public.crypto_unlock_orders(user_id);
CREATE INDEX crypto_unlock_orders_payment_idx ON public.crypto_unlock_orders(payment_id);

ALTER TABLE public.crypto_unlock_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crypto_orders_select_own"
ON public.crypto_unlock_orders FOR SELECT
USING (auth.uid() = user_id);
