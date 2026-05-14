
REVOKE EXECUTE ON FUNCTION public.credit_affiliate_commission(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
-- Tighten click tracker too: keep anon (intentional public endpoint) but block authenticated misuse via a guard.
REVOKE EXECUTE ON FUNCTION public.track_affiliate_click(text, text, text) FROM authenticated;
