CREATE TABLE public.translation_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_hash text NOT NULL,
  target_lang text NOT NULL,
  source_text text NOT NULL,
  translated_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 1,
  UNIQUE (source_hash, target_lang)
);

CREATE INDEX idx_translation_cache_lookup ON public.translation_cache(source_hash, target_lang);

ALTER TABLE public.translation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translation_cache_public_read"
  ON public.translation_cache FOR SELECT
  USING (true);

CREATE POLICY "translation_cache_service_write"
  ON public.translation_cache FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "translation_cache_service_update"
  ON public.translation_cache FOR UPDATE
  USING (auth.role() = 'service_role');