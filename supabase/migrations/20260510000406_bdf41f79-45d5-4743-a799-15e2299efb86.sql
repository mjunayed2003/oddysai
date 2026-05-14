
-- Fix touch_updated_at search_path
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- Revoke public execute on security definer functions
revoke execute on function public.has_role(uuid, app_role) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Replace permissive policies
drop policy if exists "affiliates_select_leaderboard" on public.affiliates;
-- Leaderboard view via SECURITY DEFINER function instead
create or replace function public.get_affiliate_leaderboard()
returns table(referral_code text, total_earned numeric, total_active_subs int)
language sql stable security definer set search_path = public as $$
  select referral_code, total_earned, total_active_subs
  from public.affiliates
  order by total_earned desc
  limit 20;
$$;
revoke execute on function public.get_affiliate_leaderboard() from public, anon;
grant execute on function public.get_affiliate_leaderboard() to authenticated;
grant execute on function public.has_role(uuid, app_role) to authenticated;

-- Tighten affiliate_clicks insert: only allow when affiliate exists
drop policy if exists "aff_clicks_insert_any" on public.affiliate_clicks;
create policy "aff_clicks_insert_valid" on public.affiliate_clicks for insert
  with check (exists(select 1 from public.affiliates a where a.id = affiliate_id));

-- Tighten api_usage insert: only signed-in users for their own row
drop policy if exists "api_usage_insert_any" on public.api_usage;
create policy "api_usage_insert_own" on public.api_usage for insert
  with check (auth.uid() = user_id);
