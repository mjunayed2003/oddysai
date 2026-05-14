create table public.analysis_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null,
  environment text not null default 'sandbox',
  stripe_session_id text unique,
  amount_cents integer,
  created_at timestamptz not null default now()
);

create index idx_analysis_unlocks_user_match on public.analysis_unlocks(user_id, match_id);

alter table public.analysis_unlocks enable row level security;

create policy "Users can view their own unlocks"
  on public.analysis_unlocks for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.analysis_unlocks from anon, authenticated;