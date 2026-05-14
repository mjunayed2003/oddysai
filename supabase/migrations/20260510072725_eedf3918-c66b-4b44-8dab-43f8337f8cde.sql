
ALTER TABLE public.bankrolls
  ALTER COLUMN starting_amount SET DEFAULT 0,
  ALTER COLUMN current_amount SET DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_initialized boolean NOT NULL DEFAULT false;

-- Update trigger so new users get a zeroed, uninitialized bankroll
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ref_code text;
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  insert into public.bankrolls (user_id, starting_amount, current_amount, is_initialized) values (new.id, 0, 0, false);
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  insert into public.subscriptions (user_id, plan, status) values (new.id, 'free', 'active');
  ref_code := upper(substring(replace(new.id::text,'-',''), 1, 8));
  insert into public.affiliates (user_id, referral_code) values (new.id, ref_code);
  return new;
end; $function$;

-- Allow users to update is_initialized on their own bankroll (already covered by bankrolls_own ALL policy)

-- Anonymous quick prediction tracking (per IP, server-side only)
CREATE TABLE IF NOT EXISTS public.quick_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  user_agent text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quick_predictions_ip_created_idx ON public.quick_predictions (ip_hash, created_at DESC);

ALTER TABLE public.quick_predictions ENABLE ROW LEVEL SECURITY;

-- Admin read only; all writes via service role
CREATE POLICY "quick_predictions_admin_select"
  ON public.quick_predictions FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.quick_predictions FROM anon, authenticated;
GRANT SELECT ON public.quick_predictions TO authenticated;
