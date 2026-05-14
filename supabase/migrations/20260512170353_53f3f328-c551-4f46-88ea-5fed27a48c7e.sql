DROP FUNCTION IF EXISTS public.get_affiliate_leaderboard();

CREATE OR REPLACE FUNCTION public.get_affiliate_leaderboard()
 RETURNS TABLE(referral_code text, total_earned numeric, total_generated numeric, total_active_subs integer, total_signups integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    referral_code,
    total_earned,
    case when coalesce(commission_rate, 30) > 0
      then round((total_earned * 100.0 / coalesce(commission_rate, 30))::numeric, 2)
      else 0 end as total_generated,
    total_active_subs,
    total_signups
  from public.affiliates
  order by total_earned desc, total_signups desc
  limit 20;
$function$;