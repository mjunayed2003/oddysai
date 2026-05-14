create or replace function public.consume_ai_quota(_user_id uuid, _limit integer)
returns table(allowed boolean, used integer, hourly_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and v_caller <> _user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));

  select count(*)::int into v_count
  from public.api_usage
  where user_id = _user_id
    and kind = 'ai_analysis'
    and created_at >= now() - interval '1 hour';

  if v_count >= _limit then
    return query select false, v_count, _limit;
    return;
  end if;

  insert into public.api_usage (user_id, kind, cost)
  values (_user_id, 'ai_analysis', 0);

  return query select true, v_count + 1, _limit;
end;
$$;