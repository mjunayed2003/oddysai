
-- Phase 1: shared analyses + cost tracking columns
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS odds_fingerprint text,
  ADD COLUMN IF NOT EXISTS lineup_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS tokens_in integer,
  ADD COLUMN IF NOT EXISTS tokens_out integer,
  ADD COLUMN IF NOT EXISTS cost_cents integer,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Make user_id nullable so service-role pre-generated analyses can be stored
-- without a specific owner. Existing rows keep their user_id.
ALTER TABLE public.analyses ALTER COLUMN user_id DROP NOT NULL;

-- Indexes for fast shared lookup
CREATE INDEX IF NOT EXISTS analyses_match_expires_idx
  ON public.analyses (match_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS analyses_match_odds_expires_idx
  ON public.analyses (match_id, odds_fingerprint, expires_at DESC);

-- Phase 1: switch analyses from per-user to shared cache.
-- Any authenticated user can READ any analysis (it's just match-level
-- prediction data, no PII). Inserts still require auth.uid() = user_id
-- when user_id is set, OR user_id null (service-role pre-generation).
DROP POLICY IF EXISTS analyses_select_own ON public.analyses;
DROP POLICY IF EXISTS analyses_insert_own ON public.analyses;

CREATE POLICY analyses_select_authed
  ON public.analyses
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY analyses_insert_self_or_system
  ON public.analyses
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
