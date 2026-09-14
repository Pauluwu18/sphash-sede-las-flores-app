-- Ejecuta este script una vez en Supabase: SQL Editor > New query.
create table if not exists public.daily_records (
  record_date text primary key,
  arrivals jsonb not null default '[]'::jsonb,
  report text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.set_daily_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_records_updated_at on public.daily_records;
create trigger daily_records_updated_at
before update on public.daily_records
for each row execute function public.set_daily_records_updated_at();

alter table public.daily_records enable row level security;

drop policy if exists "anonymous users can read attendance" on public.daily_records;
create policy "anonymous users can read attendance"
on public.daily_records for select to anon using (true);

drop policy if exists "anonymous users can add attendance" on public.daily_records;
create policy "anonymous users can add attendance"
on public.daily_records for insert to anon with check (true);

drop policy if exists "anonymous users can update attendance" on public.daily_records;
create policy "anonymous users can update attendance"
on public.daily_records for update to anon using (true) with check (true);

create table if not exists public.inventory (
  name text primary key,
  owner text not null default '',
  borrower text not null default '',
  non_operative text not null default '',
  no_solution text not null default '',
  updated_at timestamptz not null default now()
);

drop trigger if exists inventory_updated_at on public.inventory;
create trigger inventory_updated_at
before update on public.inventory
for each row execute function public.set_daily_records_updated_at();

alter table public.inventory enable row level security;

drop policy if exists "anonymous users can read inventory" on public.inventory;
create policy "anonymous users can read inventory"
on public.inventory for select to anon using (true);

drop policy if exists "anonymous users can add inventory" on public.inventory;
create policy "anonymous users can add inventory"
on public.inventory for insert to anon with check (true);

drop policy if exists "anonymous users can update inventory" on public.inventory;
create policy "anonymous users can update inventory"
on public.inventory for update to anon using (true) with check (true);