-- Lock down the analyses table: clients can only see their own rows.
-- Shared cache reuse is performed by server code via the service role,
-- which bypasses RLS.

DROP POLICY IF EXISTS analyses_select_authed ON public.analyses;
DROP POLICY IF EXISTS analyses_insert_self_or_system ON public.analyses;

CREATE POLICY analyses_select_own
  ON public.analyses
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY analyses_insert_own
  ON public.analyses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
