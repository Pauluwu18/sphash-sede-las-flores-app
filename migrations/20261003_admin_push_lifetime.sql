-- After 20260928_admin_voice.sql. Device subscriptions last 30 days since the
-- last authenticated registration; web sessions still expire after 12 hours.
begin;
alter table splash_private.admin_push_devices
  add column if not exists expires_at timestamptz;
update splash_private.admin_push_devices set expires_at=registered_at+interval '30 days'
  where expires_at is null;
alter table splash_private.admin_push_devices alter column expires_at set not null;
alter table splash_private.admin_push_devices alter column expires_at set default now()+interval '30 days';
alter table splash_private.admin_push_devices alter column session_hash drop not null;
alter table splash_private.admin_push_devices drop constraint if exists admin_push_devices_session_hash_fkey;
alter table splash_private.admin_push_devices add constraint admin_push_devices_session_hash_fkey
  foreign key(session_hash) references splash_private.sessions(token_hash) on delete set null;

create or replace function public.splash_push_registration(action text,session_token text,device_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare admin_session splash_private.sessions%rowtype;
begin
  if device_token is null or length(device_token) not between 30 and 4096 then
    return jsonb_build_object('error','Token de dispositivo inválido.');
  end if;
  select * into admin_session from splash_private.sessions
    where token_hash=encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex')
      and is_admin and expires_at>now();
  if admin_session.token_hash is null then
    return jsonb_build_object('error','Inicia sesión como administrador.','code','SESSION');
  end if;
  if action='register' then
    delete from splash_private.admin_push_devices where expires_at<=now();
    insert into splash_private.admin_push_devices(fcm_token,session_hash,expires_at)
      values(device_token,admin_session.token_hash,now()+interval '30 days')
      on conflict(fcm_token) do update set session_hash=excluded.session_hash,
        registered_at=now(),expires_at=excluded.expires_at;
    return jsonb_build_object('ok',true,'expires_at',now()+interval '30 days');
  elsif action='unregister' then
    delete from splash_private.admin_push_devices where fcm_token=device_token;
    return '{"ok":true}'::jsonb;
  end if;
  return jsonb_build_object('error','Acción desconocida.');
end $$;

create or replace function public.splash_push_event(p_person_id uuid,p_work_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkin splash_private.checkins%rowtype; targets jsonb; voices jsonb;
begin
  select * into checkin from splash_private.checkins
    where person_id=p_person_id and work_date=p_work_date and source='QR';
  if checkin.person_id is null then return jsonb_build_object('error','Registro QR no encontrado.'); end if;
  select coalesce(jsonb_agg(fcm_token),'[]'::jsonb),
    coalesce(jsonb_agg(fcm_token) filter (where voice_enabled),'[]'::jsonb) into targets,voices
    from splash_private.admin_push_devices where expires_at>now();
  return jsonb_build_object('date',checkin.work_date,
    'time',to_char(checkin.checked_at at time zone 'America/Lima','HH24:MI'),
    'name',(select name from splash_private.people where id=p_person_id),
    'event_id',p_person_id::text || ':' || p_work_date::text,'tokens',targets,'voice_tokens',voices);
end $$;

-- Explicit logout revokes the subscription, but routine expired-session cleanup
-- merely clears its session reference. Keep the rest of the API unchanged.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure) into definition;
  if position('delete from splash_private.admin_push_devices where session_hash=sess.token_hash;' in definition)=0 then
    if position('if action=''logout'' then' in definition)=0 then
      raise exception 'No se encontró el cierre de sesión: revisar splash_api antes de aplicar.';
    end if;
    definition:=replace(definition,'if action=''logout'' then',
      E'if action=''logout'' then\n    delete from splash_private.admin_push_devices where session_hash=sess.token_hash;');
    execute definition;
  end if;
end $$;
revoke all on function public.splash_push_registration(text,text,text) from public;
grant execute on function public.splash_push_registration(text,text,text) to anon,authenticated;
revoke all on function public.splash_push_event(uuid,date) from public,anon,authenticated;
grant execute on function public.splash_push_event(uuid,date) to service_role;

-- Changing the administrator password revokes every push subscription too.
create or replace function splash_private.revoke_admin_push_on_password_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.admin_hash is distinct from old.admin_hash then
    delete from splash_private.admin_push_devices;
  end if;
  return new;
end $$;
revoke all on function splash_private.revoke_admin_push_on_password_change() from public,anon,authenticated;
drop trigger if exists splash_admin_push_password_changed on splash_private.settings;
create trigger splash_admin_push_password_changed after update of admin_hash on splash_private.settings
  for each row execute function splash_private.revoke_admin_push_on_password_change();
commit;
