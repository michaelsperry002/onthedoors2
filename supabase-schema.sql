-- CORE KPIs Supabase Schema
-- Paste this into your Supabase SQL Editor and click "Run"

-- Teams
create table teams (
  id uuid default gen_random_uuid() primary key,
  name text not null default 'Field Team',
  short_code text unique,
  created_at timestamptz default now()
);

-- Profiles (linked to Supabase auth.users)
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  team_id uuid references teams(id),
  region_id uuid,
  name text not null,
  role text not null default 'rep' check (role in ('admin','manager','rep','regional')),
  recruited_by_name text default '',
  email text default '',
  birthday date,
  phone text default '',
  address text default '',
  needs_onboarding boolean default true,
  disabled boolean default false,
  created_at timestamptz default now()
);

-- Team settings (one row per team)
create table team_settings (
  team_id uuid references teams(id) on delete cascade primary key,
  app_name text default 'CORE Kpi''s',
  daily_door_goal int default 100,
  daily_sales_goal int default 2,
  daily_appointment_goal int default 6,
  daily_revenue_goal int default 2500,
  target_answer_rate numeric default 35,
  target_pitch_rate numeric default 60,
  target_close_rate numeric default 12,
  timezone text default 'America/Denver'
);

-- Logs (every door knock)
create table logs (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references teams(id) not null,
  user_id uuid references auth.users(id) not null,
  user_name text not null,
  outcome text not null,
  label text not null,
  contract_value numeric default 0,
  customer_name text default '',
  address text default '',
  notes text default '',
  date text not null,
  created_at timestamptz default now()
);

-- Callbacks
create table callbacks (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references teams(id) not null,
  name text not null,
  address text default '',
  date text not null,
  remind_at timestamptz,
  window_end timestamptz,
  priority text default 'low',
  notes text default '',
  status text default 'open',
  created_at timestamptz default now()
);

-- Sales
create table sales (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references teams(id) not null,
  customer_name text not null,
  address text default '',
  value numeric default 0,
  user_name text not null,
  date text not null,
  created_at timestamptz default now()
);

-- Accounts (field-side account tracking: installs, status, contract value)
create table accounts (
  id uuid default gen_random_uuid() primary key,
  team_id uuid references teams(id) not null,
  user_id uuid references auth.users(id) not null,
  customer_name text not null,
  address text default '',
  status text not null default 'pending' check (status in ('pending','active','serviced','cancelled')),
  contract_value numeric default 0,
  install_date text default '',
  notes text default '',
  created_at timestamptz default now()
);

-- Enable Row Level Security on all tables
alter table teams enable row level security;
alter table profiles enable row level security;
alter table team_settings enable row level security;
alter table logs enable row level security;
alter table callbacks enable row level security;
alter table sales enable row level security;
alter table accounts enable row level security;

-- Helper functions to look up the caller's team_id / role without
-- triggering RLS recursion (querying profiles directly inside a
-- profiles policy causes "infinite recursion detected in policy" errors).
create or replace function my_team_id()
returns uuid
language sql
security definer
stable
as $$
  select team_id from profiles where id = auth.uid()
$$;

create or replace function my_role()
returns text
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid()
$$;

-- RLS Policies

-- Teams: members can read their own team
create policy "Members read team" on teams for select using (
  id = my_team_id()
);
create policy "Anyone can insert team" on teams for insert with check (true);

-- Profiles
create policy "Users see own profile" on profiles for select using (id = auth.uid());
create policy "Users see team members" on profiles for select using (
  team_id = my_team_id()
);
create policy "Anyone can insert own profile" on profiles for insert with check (id = auth.uid());
create policy "Users update own profile" on profiles for update using (id = auth.uid());

-- Team settings
create policy "Team members read settings" on team_settings for select using (
  team_id = my_team_id()
);
create policy "Admins update settings" on team_settings for update using (
  team_id = my_team_id()
  and my_role() = 'admin'
);
create policy "Admins insert settings" on team_settings for insert with check (
  team_id = my_team_id()
);

-- Logs
create policy "Team read logs" on logs for select using (
  team_id = my_team_id()
);
create policy "Team insert logs" on logs for insert with check (
  team_id = my_team_id()
);
create policy "Team delete logs" on logs for delete using (
  team_id = my_team_id()
);

-- Callbacks
create policy "Team read callbacks" on callbacks for select using (
  team_id = my_team_id()
);
create policy "Team insert callbacks" on callbacks for insert with check (
  team_id = my_team_id()
);
create policy "Team update callbacks" on callbacks for update using (
  team_id = my_team_id()
);

-- Sales
create policy "Team read sales" on sales for select using (
  team_id = my_team_id()
);
create policy "Team insert sales" on sales for insert with check (
  team_id = my_team_id()
);
create policy "Team delete sales" on sales for delete using (
  team_id = my_team_id()
);

-- Accounts
create policy "Team read accounts" on accounts for select using (
  team_id = my_team_id()
);
create policy "Team insert accounts" on accounts for insert with check (
  team_id = my_team_id()
);
create policy "Team update accounts" on accounts for update using (
  team_id = my_team_id()
);

-- ── Migration: run this alone if your database already has the tables
-- above and you just need to add short, shareable team codes. ──
-- alter table teams add column if not exists short_code text unique;
-- alter table profiles add column if not exists recruited_by_name text default '';

-- ── Org-wide admin access ──
-- The sole "admin" (owner) account can see and manage every team, not
-- just the one they signed up with, so they can create new teams and
-- move recruits between them.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

create policy "Admin reads all teams" on teams for select using (is_admin());
create policy "Admin updates all teams" on teams for update using (is_admin());
create policy "Admin reads all profiles" on profiles for select using (is_admin());
create policy "Admin updates all profiles" on profiles for update using (is_admin());
create policy "Admin reads all team_settings" on team_settings for select using (is_admin());
create policy "Admin reads all logs" on logs for select using (is_admin());
create policy "Admin reads all accounts" on accounts for select using (is_admin());

-- ── Migration: expanded recruit profile info + onboarding flag ──
-- alter table profiles add column if not exists email text default '';
-- alter table profiles add column if not exists birthday date;
-- alter table profiles add column if not exists phone text default '';
-- alter table profiles add column if not exists address text default '';
-- alter table profiles add column if not exists needs_onboarding boolean default true;

-- ── Migration: CRITICAL - callbacks table was missing the remind_at
-- column this whole time, so every callback silently failed to save.
-- Run this now if callbacks aren't working. ──
-- alter table callbacks add column if not exists remind_at timestamptz;
-- alter table callbacks add column if not exists window_end timestamptz;

-- ── Migration: CORE admin app ──
-- The CORE app (admin control hub) needs the org admin to be able to
-- read and manage everything across every team. Run this whole block.
create policy "Admin reads all sales" on sales for select using (is_admin());
create policy "Admin reads all callbacks" on callbacks for select using (is_admin());
create policy "Admin inserts any team_settings" on team_settings for insert with check (is_admin());
create policy "Admin updates any team_settings" on team_settings for update using (is_admin());
create policy "Admin updates all accounts" on accounts for update using (is_admin());
create policy "Admin deletes teams" on teams for delete using (is_admin());

-- ── Migration: CORE recruiting + people management ──
-- recruited_by links a person to their direct recruiter (a profile).
-- The delete policy lets the admin remove a person from CORE's People tab.
alter table profiles add column if not exists recruited_by uuid references profiles(id);
drop policy if exists "Admin deletes profiles" on profiles;
create policy "Admin deletes profiles" on profiles for delete using (is_admin());

-- ── Migration: CORE multi-user (everyone views, edits gated by role) ──
-- can_add lets a manager/regional be granted account-creation rights.
alter table profiles add column if not exists can_add boolean default false;

-- Any signed-in user may VIEW org-wide data in CORE (read-only).
drop policy if exists "Auth read profiles" on profiles;
create policy "Auth read profiles" on profiles for select using (auth.uid() is not null);
drop policy if exists "Auth read logs" on logs;
create policy "Auth read logs" on logs for select using (auth.uid() is not null);
drop policy if exists "Auth read teams" on teams;
create policy "Auth read teams" on teams for select using (auth.uid() is not null);
drop policy if exists "Auth read sales" on sales;
create policy "Auth read sales" on sales for select using (auth.uid() is not null);
drop policy if exists "Auth read team_settings" on team_settings;
create policy "Auth read team_settings" on team_settings for select using (auth.uid() is not null);

-- Managers may edit profiles on their own team; regionals within their region.
drop policy if exists "Managers update team profiles" on profiles;
create policy "Managers update team profiles" on profiles for update
  using (my_role() = 'manager' and team_id = my_team_id());
drop policy if exists "Regionals update region profiles" on profiles;
create policy "Regionals update region profiles" on profiles for update
  using (my_role() = 'regional' and region_id = (select region_id from profiles where id = auth.uid()));

-- ════════════════════════════════════════════════════════════════
--  RECRUITING PIPELINE APP
-- ════════════════════════════════════════════════════════════════
-- Editable pipeline configuration: kind='stage' are the board columns,
-- kind='flag' are the extenuating-circumstance tags. Org-wide, admin-managed.
create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'stage' check (kind in ('stage', 'flag')),
  position int not null default 0,
  is_final boolean default false,
  created_at timestamptz default now()
);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text default '',
  email text default '',
  source text default '',
  notes text default '',
  stage_id uuid references pipeline_stages(id),
  flag_id uuid references pipeline_stages(id),
  recruiter_id uuid references profiles(id),
  team_id uuid references teams(id),
  owner_id uuid references profiles(id),
  follow_up_date date,
  appt_at timestamptz,
  hired boolean default false,
  hired_profile_id uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table pipeline_stages enable row level security;
alter table candidates enable row level security;

-- Everyone signed in can see the pipeline configuration; only admin edits it.
drop policy if exists "Auth read stages" on pipeline_stages;
create policy "Auth read stages" on pipeline_stages for select using (auth.uid() is not null);
drop policy if exists "Admin writes stages" on pipeline_stages;
create policy "Admin writes stages" on pipeline_stages for all using (is_admin()) with check (is_admin());

-- Candidates are role-scoped: reps see their own, managers/regionals their
-- team, admin sees all. Same rule governs read and write.
drop policy if exists "Scoped read candidates" on candidates;
create policy "Scoped read candidates" on candidates for select using (
  is_admin()
  or owner_id = auth.uid()
  or recruiter_id = auth.uid()
  or (my_role() in ('manager', 'regional') and team_id = my_team_id())
);
drop policy if exists "Insert own candidates" on candidates;
create policy "Insert own candidates" on candidates for insert with check (
  auth.uid() is not null and (owner_id = auth.uid() or is_admin())
);
drop policy if exists "Scoped update candidates" on candidates;
create policy "Scoped update candidates" on candidates for update using (
  is_admin()
  or owner_id = auth.uid()
  or (my_role() in ('manager', 'regional') and team_id = my_team_id())
);
drop policy if exists "Scoped delete candidates" on candidates;
create policy "Scoped delete candidates" on candidates for delete using (
  is_admin()
  or owner_id = auth.uid()
  or (my_role() in ('manager', 'regional') and team_id = my_team_id())
);
