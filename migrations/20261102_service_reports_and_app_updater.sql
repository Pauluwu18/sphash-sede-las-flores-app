-- Migración: Registro de servicios de operarios, conexión con caja y control de actualizaciones APK
-- Ejecutar en Supabase: SQL Editor > New query

-- 1. Tabla de movimientos de caja (conectada entre operarios y administración)
create table if not exists public.cash_movements (
  id text primary key,
  date text not null,
  type text not null default 'ENTRADA' check (type in ('ENTRADA', 'SALIDA')),
  amount numeric(10,2) not null,
  operator text not null default '',
  service_number text not null default '',
  payment_method text not null default 'Efectivo',
  observation text not null default '',
  concept text not null default '',
  photo text not null default '',
  time text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_movements_date on public.cash_movements(date);
create index if not exists idx_cash_movements_operator on public.cash_movements(operator);

alter table public.cash_movements enable row level security;

drop policy if exists "anon can read cash movements" on public.cash_movements;
create policy "anon can read cash movements"
on public.cash_movements for select to anon using (true);

drop policy if exists "anon can insert cash movements" on public.cash_movements;
create policy "anon can insert cash movements"
on public.cash_movements for insert to anon with check (true);

drop policy if exists "anon can update cash movements" on public.cash_movements;
create policy "anon can update cash movements"
on public.cash_movements for update to anon using (true) with check (true);

drop policy if exists "anon can delete cash movements" on public.cash_movements;
create policy "anon can delete cash movements"
on public.cash_movements for delete to anon using (true);

-- 2. Tabla de versiones y actualizaciones de la app (APK)
create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_name text not null default 'operarios' check (app_name in ('operarios', 'admin')),
  version_name text not null,
  version_code integer not null,
  apk_url text not null,
  changelog text not null default '',
  is_mandatory boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_versions_app on public.app_versions(app_name, version_code desc);

alter table public.app_versions enable row level security;

drop policy if exists "anon can read app versions" on public.app_versions;
create policy "anon can read app versions"
on public.app_versions for select to anon using (true);

drop policy if exists "anon can insert app versions" on public.app_versions;
create policy "anon can insert app versions"
on public.app_versions for insert to anon with check (true);

drop policy if exists "anon can update app versions" on public.app_versions;
create policy "anon can update app versions"
on public.app_versions for update to anon using (true) with check (true);

drop policy if exists "anon can delete app versions" on public.app_versions;
create policy "anon can delete app versions"
on public.app_versions for delete to anon using (true);

-- Registro inicial de versión para operarios
insert into public.app_versions (app_name, version_name, version_code, apk_url, changelog)
values (
  'operarios',
  '1.1',
  2,
  'https://github.com/Pauluwu18/sphash-sede-las-flores-app/releases/download/v1.1/SPLASH-Sede-Las-Flores-v1.1.apk',
  'Reporte rápido de servicios a caja y WhatsApp, selector de método de pago y actualización integrada.'
) on conflict do nothing;
