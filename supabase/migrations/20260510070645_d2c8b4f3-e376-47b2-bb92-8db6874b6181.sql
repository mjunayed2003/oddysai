
-- Drop the broad ALL policy and replace with read-only for owners.
DROP POLICY IF EXISTS bets_own ON public.bets;

CREATE POLICY bets_select_own ON public.bets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Revoke direct table-level write privileges from end users.
-- All writes must go through SECURITY DEFINER server functions / service role.
REVOKE INSERT, UPDATE, DELETE ON public.bets FROM authenticated, anon;
