
-- ENUMS
create type public.app_role as enum ('admin', 'user');
create type public.plan_tier as enum ('free', 'basic', 'pro', 'elite');
create type public.sub_status as enum ('active', 'canceled', 'past_due', 'trialing', 'incomplete');
create type public.risk_level as enum ('low', 'medium', 'high');
create type public.bet_result as enum ('pending', 'won', 'lost', 'void', 'cashout');
create type public.match_status as enum ('scheduled', 'live', 'finished', 'postponed');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  country text,
  age_confirmed boolean default false,
  referred_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- USER ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "user_roles_select_own" on public.user_roles for select using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "user_roles_admin_all" on public.user_roles for all using (public.has_role(auth.uid(),'admin'));

-- SUBSCRIPTIONS
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan plan_tier not null default 'free',
  status sub_status not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "subs_select_own" on public.subscriptions for select using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "subs_insert_own" on public.subscriptions for insert with check (auth.uid() = user_id);
create policy "subs_update_own" on public.subscriptions for update using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- MATCHES
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  league text not null,
  country text,
  home_team text not null,
  away_team text not null,
  home_logo text,
  away_logo text,
  kickoff timestamptz not null,
  status match_status not null default 'scheduled',
  home_score int,
  away_score int,
  odds_home numeric(6,2),
  odds_draw numeric(6,2),
  odds_away numeric(6,2),
  created_at timestamptz not null default now()
);
alter table public.matches enable row level security;
create policy "matches_select_all" on public.matches for select using (true);
create policy "matches_admin_write" on public.matches for all using (public.has_role(auth.uid(),'admin'));

-- ANALYSES
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid references auth.users on delete set null,
  summary text not null,
  form_analysis text,
  injuries_impact text,
  motivation text,
  h2h_summary text,
  odds_movement text,
  best_market text not null,
  prob_home numeric(5,2),
  prob_draw numeric(5,2),
  prob_away numeric(5,2),
  confidence int not null check (confidence between 1 and 100),
  risk risk_level not null,
  value_bet boolean not null default false,
  suggested_stake_pct numeric(5,2),
  suggested_stake_amount numeric(10,2),
  reasoning text,
  created_at timestamptz not null default now()
);
alter table public.analyses enable row level security;
create policy "analyses_select_authed" on public.analyses for select using (auth.uid() is not null);
create policy "analyses_insert_own" on public.analyses for insert with check (auth.uid() = user_id or user_id is null);

-- BANKROLLS
create table public.bankrolls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  starting_amount numeric(12,2) not null default 1000,
  current_amount numeric(12,2) not null default 1000,
  daily_loss_limit numeric(12,2) not null default 100,
  max_stake_pct numeric(5,2) not null default 5,
  currency text not null default 'EUR',
  updated_at timestamptz not null default now()
);
alter table public.bankrolls enable row level security;
create policy "bankrolls_own" on public.bankrolls for all using (auth.uid() = user_id);

-- BETS
create table public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  match_label text not null,
  pick text not null,
  market text,
  odds numeric(6,2) not null,
  stake numeric(10,2) not null,
  result bet_result not null default 'pending',
  profit_loss numeric(10,2) not null default 0,
  ai_confidence int,
  ai_risk risk_level,
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.bets enable row level security;
create policy "bets_own" on public.bets for all using (auth.uid() = user_id);

-- AFFILIATES
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  referral_code text not null unique,
  commission_rate numeric(5,2) not null default 30,
  total_clicks int not null default 0,
  total_signups int not null default 0,
  total_active_subs int not null default 0,
  total_earned numeric(12,2) not null default 0,
  pending_payout numeric(12,2) not null default 0,
  paid_payout numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.affiliates enable row level security;
create policy "affiliates_select_own" on public.affiliates for select using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "affiliates_select_leaderboard" on public.affiliates for select using (true);
create policy "affiliates_update_own" on public.affiliates for update using (auth.uid() = user_id);

create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.affiliate_clicks enable row level security;
create policy "aff_clicks_admin" on public.affiliate_clicks for select using (public.has_role(auth.uid(),'admin'));
create policy "aff_clicks_insert_any" on public.affiliate_clicks for insert with check (true);

create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referred_user_id uuid references auth.users on delete set null,
  amount numeric(10,2) not null,
  status text not null default 'pending',
  period_month date,
  created_at timestamptz not null default now()
);
alter table public.affiliate_commissions enable row level security;
create policy "aff_comm_own" on public.affiliate_commissions for select using (
  exists(select 1 from public.affiliates a where a.id = affiliate_id and a.user_id = auth.uid())
  or public.has_role(auth.uid(),'admin')
);

-- ADMIN LOGS
create table public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users on delete set null,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_logs enable row level security;
create policy "admin_logs_admin" on public.admin_logs for all using (public.has_role(auth.uid(),'admin'));

-- API USAGE
create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  kind text not null,
  cost numeric(10,4) default 0,
  created_at timestamptz not null default now()
);
alter table public.api_usage enable row level security;
create policy "api_usage_admin" on public.api_usage for select using (public.has_role(auth.uid(),'admin'));
create policy "api_usage_own_select" on public.api_usage for select using (auth.uid() = user_id);
create policy "api_usage_insert_any" on public.api_usage for insert with check (true);

-- TRIGGER: bootstrap profile, bankroll, affiliate, role on new user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ref_code text;
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  insert into public.bankrolls (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  insert into public.subscriptions (user_id, plan, status) values (new.id, 'free', 'active');
  ref_code := upper(substring(replace(new.id::text,'-',''), 1, 8));
  insert into public.affiliates (user_id, referral_code) values (new.id, ref_code);
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at trigger helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger subs_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
