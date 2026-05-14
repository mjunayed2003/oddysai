DROP POLICY IF EXISTS analyses_insert_own ON public.analyses;
CREATE POLICY analyses_insert_own ON public.analyses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);