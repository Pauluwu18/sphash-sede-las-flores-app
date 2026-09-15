-- Ejecutar DESPUÉS de supabase-schema.sql. No volver a ejecutar el esquema antiguo.
-- La última consulta entrega la nueva contraseña inicial de admin UNA SOLA VEZ.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists splash_private;
revoke all on schema splash_private from public, anon, authenticated;

create table if not exists splash_private.settings (
  id boolean primary key default true check (id),
  admin_hash text not null,
  encryption_key text not null,
  qr_token text not null,
  qr_updated_at timestamptz not null default now()
);
create table if not exists splash_private.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  dni text unique check (dni ~ '^[0-9]{8}$'),
  person_type text not null default 'Operario' check (person_type in ('Operario','Capacitado')),
  pin_hash text,
  pin_cipher bytea,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists people_name_unique on splash_private.people (lower(name));
create table if not exists splash_private.sessions (
  token_hash text primary key,
  person_id uuid references splash_private.people(id),
  is_admin boolean not null default false,
  expires_at timestamptz not null,
  check (is_admin or person_id is not null)
);
create table if not exists splash_private.login_attempts (
  account text primary key,
  failures integer not null default 0,
  window_start timestamptz not null default now()
);
create table if not exists splash_private.checkins (
  person_id uuid not null references splash_private.people(id),
  work_date date not null,
  checked_at timestamptz not null default now(),
  source text not null check (source in ('QR','Manual')),
  late boolean not null default false,
  primary key (person_id, work_date)
);
alter table splash_private.checkins add column if not exists late boolean not null default false;
create table if not exists splash_private.pin_access_log (
  person_id uuid references splash_private.people(id),
  accessed_at timestamptz not null default now()
);

-- Defensa adicional: sin políticas para clientes; solo las funciones autorizadas
-- acceden como propietario. Se mantienen también los REVOKE del esquema/tablas.
alter table splash_private.settings enable row level security;
alter table splash_private.people enable row level security;
alter table splash_private.sessions enable row level security;
alter table splash_private.login_attempts enable row level security;
alter table splash_private.checkins enable row level security;
alter table splash_private.pin_access_log enable row level security;

-- Mantiene el contenido de asistencias y elimina su acceso anónimo directo.
drop policy if exists "anonymous users can read attendance" on public.daily_records;
drop policy if exists "anonymous users can add attendance" on public.daily_records;
drop policy if exists "anonymous users can update attendance" on public.daily_records;
revoke all on public.daily_records from anon, authenticated;

create or replace function splash_private.report(p_arrivals jsonb, p_date text, p_previous text default '')
returns text language plpgsql set search_path = '' as $$
declare result text := p_date; section text; person_kind text; missing text;
begin
  if jsonb_array_length(p_arrivals) = 0 then return ''; end if;
  foreach person_kind in array array['Operario','Capacitado'] loop
    select string_agg(n::text || '. ' || (a->>'name') ||
      case when a->>'late' = 'true' then '(tarde)' else '' end ||
      case when a->>'active' = 'false' then ' (fuera de servicio)' else '' end, E'\n' order by n)
    into section from (
      select a, row_number() over (order by ord) n
      from jsonb_array_elements(p_arrivals) with ordinality t(a, ord)
      where a->>'type' = person_kind
    ) items;
    if section is not null then
      result := result || E'\n' || case when person_kind = 'Operario' then '*operarios*' else '*Capacitados*' end || E'\n' || section;
    end if;
  end loop;
  select string_agg(n::text || '. ' || line, E'\n' order by n) into missing from (
    select line, row_number() over(order by ord) n from (
      select regexp_replace(line, '^[0-9]+\.[[:space:]]*', '') line, ord
      from regexp_split_to_table(split_part(p_previous, E'*Faltas*\n', 2), E'\n') with ordinality t(line,ord)
      where line <> ''
    ) lines where not exists (
      select 1 from jsonb_array_elements(p_arrivals) a
      where lower(a->>'name') = lower(regexp_replace(line, '\((falta|justificado)\)[[:space:]]*$', ''))
    )
  ) filtered;
  if missing is not null then result := result || E'\n*Faltas*\n' || missing; end if;
  return result;
end $$;

create or replace function splash_private.attendance_late(p_checked_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select (p_checked_at at time zone 'America/Lima')::time >= time '07:45';
$$;

create or replace function public.splash_api(action text, payload jsonb default '{}'::jsonb, token text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg splash_private.settings%rowtype;
  sess splash_private.sessions%rowtype;
  person splash_private.people%rowtype;
  attempts splash_private.login_attempts%rowtype;
  rec public.daily_records%rowtype;
  result jsonb; item jsonb; account_key text; secret text; new_token text;
  work_day date := (now() at time zone 'America/Lima')::date;
  day_key text; existing jsonb; merged jsonb; old_item jsonb;
begin
  select * into cfg from splash_private.settings where id;
  if cfg.id is null then return jsonb_build_object('error','El sistema todavía no está activado.'); end if;
  if action = 'status' then return '{"ready":true}'::jsonb; end if;

  if action in ('admin_login','worker_login','activate') then
    account_key := case when action = 'admin_login' then 'admin' else coalesce(payload->>'dni','') end;
    if account_key <> 'admin' and account_key !~ '^[0-9]{8}$' then return jsonb_build_object('error','El DNI debe tener 8 dígitos.'); end if;
    insert into splash_private.login_attempts(account) values(account_key) on conflict do nothing;
    select * into attempts from splash_private.login_attempts where account = account_key for update;
    if attempts.window_start < now() - interval '15 minutes' then
      update splash_private.login_attempts set failures=0, window_start=now() where account=account_key;
      attempts.failures := 0;
    end if;
    if action <> 'admin_login' and attempts.failures >= 5 then return jsonb_build_object('error','Demasiados intentos. Espera 15 minutos.'); end if;
    if action = 'admin_login' then
      secret := payload->>'password';
      if payload->>'username' is distinct from 'admin' or secret is null or
         extensions.crypt(secret, cfg.admin_hash) is distinct from cfg.admin_hash then
        update splash_private.login_attempts set failures=failures+1 where account=account_key;
        return jsonb_build_object('error','Usuario o contraseña incorrectos.');
      end if;
    else
      select * into person from splash_private.people where dni=account_key and active for update;
      if person.id is null then
        update splash_private.login_attempts set failures=failures+1 where account=account_key;
        return jsonb_build_object('error','DNI no habilitado. Consulta al administrador.');
      end if;
      if person.pin_hash is null and action = 'worker_login' then return '{"needs_pin":true}'::jsonb; end if;
      secret := payload->>'pin';
      if secret is null or secret !~ '^[0-9]{4}$' then return jsonb_build_object('error','El PIN debe tener 4 dígitos.'); end if;
      if action = 'activate' then
        if person.pin_hash is not null then return jsonb_build_object('error','La cuenta ya tiene PIN. Inicia sesión.'); end if;
        if payload->>'qr' is distinct from cfg.qr_token then return jsonb_build_object('error','Escanea el QR de la base para crear tu PIN.'); end if;
        update splash_private.people set pin_hash=extensions.crypt(secret,extensions.gen_salt('bf',10)),
          pin_cipher=extensions.pgp_sym_encrypt(secret,cfg.encryption_key) where id=person.id;
      elsif extensions.crypt(secret,person.pin_hash) is distinct from person.pin_hash then
        update splash_private.login_attempts set failures=failures+1 where account=account_key;
        return jsonb_build_object('error','DNI o PIN incorrectos.');
      end if;
    end if;
    update splash_private.login_attempts set failures=0 where account=account_key;
    delete from splash_private.sessions where expires_at < now();
    new_token := encode(extensions.gen_random_bytes(32),'hex');
    insert into splash_private.sessions(token_hash,person_id,is_admin,expires_at)
      values(encode(extensions.digest(new_token,'sha256'),'hex'),person.id,action='admin_login',now()+interval '12 hours');
    return jsonb_build_object('token',new_token,'name',person.name,'admin',action='admin_login');
  end if;

  select * into sess from splash_private.sessions
    where token_hash=encode(extensions.digest(token,'sha256'),'hex') and expires_at>now();
  if sess.token_hash is null then return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION'); end if;
  if action='logout' then
    delete from splash_private.sessions where token_hash=sess.token_hash;
    return '{"ok":true}'::jsonb;
  end if;
  if not sess.is_admin then
    select * into person from splash_private.people where id=sess.person_id and active;
    if person.id is null then return jsonb_build_object('error','Cuenta desactivada.','code','SESSION'); end if;
    if action='me' then return jsonb_build_object('name',person.name,'dni',person.dni); end if;
    if action='my_attendance' then
      select coalesce(jsonb_agg(jsonb_build_object('date',work_date,'time',to_char(checked_at at time zone 'America/Lima','HH24:MI'),'source',source,
        'late',case when source='QR' then splash_private.attendance_late(checked_at) else late end) order by work_date desc),'[]'::jsonb)
      into result from splash_private.checkins where person_id=person.id;
      return result;
    end if;
    if action <> 'checkin' then return jsonb_build_object('error','Acceso exclusivo de administración.'); end if;
    if payload->>'qr' is distinct from cfg.qr_token then return jsonb_build_object('error','QR inválido o reemplazado. Escanea el QR vigente de la base.'); end if;
    day_key := to_char(work_day,'DD/MM/YYYY');
    perform pg_advisory_xact_lock(hashtextextended(day_key,0));
    insert into public.daily_records(record_date) values(day_key) on conflict do nothing;
    select * into rec from public.daily_records where record_date=day_key for update;
    select a into existing from jsonb_array_elements(rec.arrivals) a
      where a->>'personId'=person.id::text or lower(a->>'name')=lower(person.name) limit 1;
    if existing is not null or exists(select 1 from splash_private.checkins where person_id=person.id and work_date=work_day) then
      return jsonb_build_object('already',true,'message','Tu asistencia de hoy ya está registrada.');
    end if;
    item := jsonb_build_object('personId',person.id,'name',person.name,'type',person.person_type,'late',splash_private.attendance_late(now()),'active',true,
      'arrivalTime',to_char(now() at time zone 'America/Lima','HH24:MI'),'departureTime','','source','QR');
    merged := rec.arrivals || jsonb_build_array(item);
    insert into splash_private.checkins(person_id,work_date,source,late)
      values(person.id,work_day,'QR',splash_private.attendance_late(now()));
    update public.daily_records set arrivals=merged,report=splash_private.report(merged,day_key,rec.report) where record_date=day_key;
    return jsonb_build_object('ok',true,'message','Asistencia registrada correctamente.');
  end if;

  -- Todas las acciones restantes requieren la sesión de administrador validada arriba.
  case action
    when 'people' then
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'dni',dni,'type',person_type,'active',active,'has_pin',pin_hash is not null) order by name),'[]'::jsonb)
      into result from splash_private.people; return result;
    when 'save_person' then
      if nullif(trim(payload->>'name'),'') is null then return jsonb_build_object('error','Escribe el nombre.'); end if;
      if nullif(payload->>'dni','') is null or payload->>'dni' !~ '^[0-9]{8}$' then return jsonb_build_object('error','El DNI debe tener 8 dígitos.'); end if;
      if nullif(payload->>'id','') is null then
        insert into splash_private.people(name,dni,person_type) values(trim(payload->>'name'),payload->>'dni',coalesce(payload->>'type','Operario')) returning id into person.id;
      else
        select * into person from splash_private.people where id=(payload->>'id')::uuid for update;
        if person.id is null then return jsonb_build_object('error','La persona no existe.'); end if;
        -- Cambiar DNI revoca PIN y sesiones para no reutilizar credenciales de otra persona.
        if person.dni is distinct from payload->>'dni' then
          delete from splash_private.sessions where person_id=person.id;
          update splash_private.people set pin_hash=null,pin_cipher=null where id=person.id;
        end if;
        update splash_private.people set name=trim(payload->>'name'),dni=payload->>'dni',person_type=coalesce(payload->>'type','Operario'),
          active=coalesce((payload->>'active')::boolean,true) where id=person.id;
      end if;
      return jsonb_build_object('ok',true,'id',person.id);
    when 'import_people' then
      for item in select value from jsonb_array_elements(payload->'names') loop
        if length(trim(item #>> '{}')) between 1 and 100 then
          insert into splash_private.people(name) values(trim(item #>> '{}')) on conflict do nothing;
        end if;
      end loop;
      return '{"ok":true}'::jsonb;
    when 'person_pin' then
      select * into person from splash_private.people where id=(payload->>'id')::uuid;
      insert into splash_private.pin_access_log(person_id) values(person.id);
      return jsonb_build_object('pin',case when person.pin_cipher is not null then extensions.pgp_sym_decrypt(person.pin_cipher,cfg.encryption_key) end);
    when 'deactivate_person' then
      update splash_private.people set active=false where id=(payload->>'id')::uuid;
      delete from splash_private.sessions where person_id=(payload->>'id')::uuid;
      return '{"ok":true}'::jsonb;
    when 'qr' then return jsonb_build_object('token',cfg.qr_token,'updated_at',cfg.qr_updated_at);
    when 'rotate_qr' then
      update splash_private.settings set qr_token=encode(extensions.gen_random_bytes(32),'hex'),qr_updated_at=now() where id returning * into cfg;
      return jsonb_build_object('token',cfg.qr_token,'updated_at',cfg.qr_updated_at);
    when 'records' then
      if payload->>'date' is not null then
        select to_jsonb(r) into result from public.daily_records r where record_date=payload->>'date';
      else
        select coalesce(jsonb_agg(to_jsonb(r) order by to_date(record_date,'DD/MM/YYYY') desc),'[]'::jsonb) into result from public.daily_records r;
      end if;
      return result;
    when 'save_record' then
      day_key := payload->>'date';
      if day_key is null or day_key !~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' or jsonb_typeof(payload->'arrivals') is distinct from 'array' then
        return jsonb_build_object('error','Registro inválido.');
      end if;
      perform pg_advisory_xact_lock(hashtextextended(day_key,0));
      select * into rec from public.daily_records where record_date=day_key for update;
      if coalesce(rec.updated_at::text,'') is distinct from coalesce(payload->>'expected','') then
        -- Comparar instantes, ya que PostgREST usa una representación ISO distinta.
        if rec.updated_at is distinct from nullif(payload->>'expected','')::timestamptz then
          return jsonb_build_object('error','Llegaron cambios de otro dispositivo. Actualiza el registro y repite el cambio.','code','CONFLICT');
        end if;
      end if;
      merged := '[]'::jsonb;
      for item in select value from jsonb_array_elements(payload->'arrivals') loop
        select * into person from splash_private.people where
          (id::text=item->>'personId' or lower(name)=lower(item->>'name')) and active limit 1;
        select a into old_item from jsonb_array_elements(coalesce(rec.arrivals,'[]'::jsonb)) a
          where lower(a->>'name')=lower(item->>'name') limit 1;
        if person.id is null and old_item is null then return jsonb_build_object('error','Solo se permite registrar personas del padrón.'); end if;
        if person.id is not null then
          item := item || jsonb_build_object('personId',person.id,'name',person.name);
        end if;
        if exists(select 1 from jsonb_array_elements(merged) a where lower(a->>'name')=lower(item->>'name') or
          (item->>'personId' is not null and a->>'personId'=item->>'personId')) then
          return jsonb_build_object('error','Hay una asistencia duplicada.');
        end if;
        merged := merged || jsonb_build_array(item);
      end loop;
      -- Validar todo antes de escribir: un rechazo nunca guarda asistencias parciales.
      for item in select value from jsonb_array_elements(merged) loop
        if item->>'personId' is not null then
          select a into old_item from jsonb_array_elements(coalesce(rec.arrivals,'[]'::jsonb)) a
            where a->>'personId'=item->>'personId' limit 1;
          insert into splash_private.checkins(person_id,work_date,checked_at,source,late)
            values((item->>'personId')::uuid,to_date(day_key,'DD/MM/YYYY'),
              (to_date(day_key,'DD/MM/YYYY') + coalesce(nullif(item->>'arrivalTime','')::time,'00:00'::time)) at time zone 'America/Lima',
              case when old_item->>'source'='QR' then 'QR' else 'Manual' end,
              coalesce((item->>'late')::boolean,false))
            on conflict(person_id,work_date) do update set
              checked_at=excluded.checked_at,source=excluded.source,late=excluded.late;
        end if;
      end loop;
      delete from splash_private.checkins c where work_date=to_date(day_key,'DD/MM/YYYY') and not exists(
        select 1 from jsonb_array_elements(merged) a where a->>'personId'=c.person_id::text);
      insert into public.daily_records(record_date,arrivals,report) values(day_key,merged,coalesce(payload->>'report',splash_private.report(merged,day_key)))
        on conflict(record_date) do update set arrivals=excluded.arrivals,report=excluded.report returning * into rec;
      return to_jsonb(rec);
    else return jsonb_build_object('error','Acción desconocida.');
  end case;
exception when unique_violation then return jsonb_build_object('error','El DNI o el nombre ya pertenece a otra cuenta.');
end $$;

-- Aviso sin nombres, DNI, PIN ni asistencias; cada cliente consulta con su sesión.
create or replace function splash_private.broadcast_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send('{"changed":true}'::jsonb,'attendance_changed','splash-attendance',false);
  end if;
  return new;
end $$;
drop trigger if exists splash_attendance_changed on public.daily_records;
create trigger splash_attendance_changed after insert or update on public.daily_records
  for each row execute function splash_private.broadcast_attendance();

revoke all on all tables in schema splash_private from public, anon, authenticated;
revoke all on all functions in schema splash_private from public, anon, authenticated;
revoke all on function public.splash_api(text,jsonb,text) from public;
grant execute on function public.splash_api(text,jsonb,text) to anon, authenticated;

-- Importa los nombres históricos; el administrador completa los DNI reales después.
insert into splash_private.people(name)
select distinct trim(a->>'name') from public.daily_records r cross join lateral jsonb_array_elements(r.arrivals) a
where length(trim(a->>'name')) between 1 and 100 on conflict do nothing;
-- Añade identidad estable a las llegadas históricas sin alterar nombres ni reportes.
update public.daily_records r set arrivals=(
  select coalesce(jsonb_agg(case when p.id is not null then a || jsonb_build_object('personId',p.id) else a end order by ord),'[]'::jsonb)
  from jsonb_array_elements(r.arrivals) with ordinality t(a,ord)
  left join splash_private.people p on lower(p.name)=lower(trim(a->>'name'))
) where exists(select 1 from jsonb_array_elements(r.arrivals) a where a->>'personId' is null);
insert into splash_private.checkins(person_id,work_date,checked_at,source)
select distinct on (p.id,r.record_date) p.id,to_date(r.record_date,'DD/MM/YYYY'),
  (to_date(r.record_date,'DD/MM/YYYY') + case when a->>'arrivalTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (a->>'arrivalTime')::time else '00:00'::time end) at time zone 'America/Lima',
  'Manual'
from public.daily_records r cross join lateral jsonb_array_elements(r.arrivals) a
join splash_private.people p on lower(p.name)=lower(trim(a->>'name'))
where r.record_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
on conflict do nothing;

create temporary table if not exists splash_initial_access(password text);
alter table splash_initial_access enable row level security;
revoke all on splash_initial_access from public, anon, authenticated;
truncate splash_initial_access;
with password as (select encode(extensions.gen_random_bytes(12),'hex') value), inserted as (
  insert into splash_private.settings(id,admin_hash,encryption_key,qr_token)
  select true,extensions.crypt(value,extensions.gen_salt('bf',10)),encode(extensions.gen_random_bytes(32),'hex'),encode(extensions.gen_random_bytes(32),'hex') from password
  on conflict do nothing returning id
)
insert into splash_initial_access select value from password where exists(select 1 from inserted);
notify pgrst, 'reload schema';
commit;
select 'admin' as usuario, coalesce((select password from splash_initial_access),'Ya estaba activado: se conserva la contraseña anterior.') as clave_inicial;
