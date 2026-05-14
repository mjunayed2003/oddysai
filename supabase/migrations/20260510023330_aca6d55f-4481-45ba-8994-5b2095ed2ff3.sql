-- Restrict UPDATE on affiliates to safe columns only via column-level privileges.
-- Financial columns are also protected by guard_affiliate_columns trigger (defense in depth).
REVOKE UPDATE ON public.affiliates FROM anon, authenticated;
GRANT UPDATE (referral_code) ON public.affiliates TO authenticated;

-- Tighten the RLS policy to additionally enforce row ownership on WITH CHECK.
DROP POLICY IF EXISTS affiliates_update_own ON public.affiliates;
CREATE POLICY affiliates_update_own ON public.affiliates
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);