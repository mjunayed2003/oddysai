
DROP POLICY IF EXISTS api_usage_insert_own ON public.api_usage;
REVOKE INSERT ON public.api_usage FROM authenticated, anon;
