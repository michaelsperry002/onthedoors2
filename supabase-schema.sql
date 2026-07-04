-- CORE KPIs Supabase Schema
-- Paste this into your Supabase SQL Editor and click "Run"

-- Teams
create table teams (
  id uuid default gen_random_uuid() primary key,
  name text not null default 'Field Team',
  created_at timestamptz default now()
);

-- Profiles (linked to Supabase auth.users)
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  team_id uuid references teams(id),
  region_id uuid,
  name text not null,
  role text not null default 'rep' check (role in ('admin','manager','rep','regional')),
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
  priority text default 'normal',
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

-- RLS Policies

-- Teams: members can read their own team
create policy "Members read team" on teams for select using (
  id in (select team_id from profiles where id = auth.uid())
);
create policy "Anyone can insert team" on teams for insert with check (true);

-- Profiles
create policy "Users see own profile" on profiles for select using (id = auth.uid());
create policy "Users see team members" on profiles for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Anyone can insert own profile" on profiles for insert with check (id = auth.uid());
create policy "Users update own profile" on profiles for update using (id = auth.uid());

-- Team settings
create policy "Team members read settings" on team_settings for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Admins update settings" on team_settings for update using (
  team_id in (select team_id from profiles where id = auth.uid())
  and (select role from profiles where id = auth.uid()) = 'admin'
);
create policy "Admins insert settings" on team_settings for insert with check (
  team_id in (select team_id from profiles where id = auth.uid())
);

-- Logs
create policy "Team read logs" on logs for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team insert logs" on logs for insert with check (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team delete logs" on logs for delete using (
  team_id in (select team_id from profiles where id = auth.uid())
);

-- Callbacks
create policy "Team read callbacks" on callbacks for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team insert callbacks" on callbacks for insert with check (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team update callbacks" on callbacks for update using (
  team_id in (select team_id from profiles where id = auth.uid())
);

-- Sales
create policy "Team read sales" on sales for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team insert sales" on sales for insert with check (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team delete sales" on sales for delete using (
  team_id in (select team_id from profiles where id = auth.uid())
);

-- Accounts
create policy "Team read accounts" on accounts for select using (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team insert accounts" on accounts for insert with check (
  team_id in (select team_id from profiles where id = auth.uid())
);
create policy "Team update accounts" on accounts for update using (
  team_id in (select team_id from profiles where id = auth.uid())
);
