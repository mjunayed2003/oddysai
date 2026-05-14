DROP FUNCTION IF EXISTS public.get_affiliate_leaderboard();
CREATE FUNCTION public.get_affiliate_leaderboard()
 RETURNS TABLE(referral_code text, total_earned numeric, total_active_subs integer, total_signups integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select referral_code, total_earned, total_active_subs, total_signups
  from public.affiliates
  order by total_earned desc, total_signups desc
  limit 20;
$function$;
REVOKE ALL ON FUNCTION public.get_affiliate_leaderboard() FROM PUBLIC, anon, authenticated;