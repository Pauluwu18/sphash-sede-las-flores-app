-- Ejecutar después de 20260915_qr_attendance.sql.
-- Antes, habilitar pg_net en Supabase y crear en Vault el secreto
-- splash_push_webhook_secret con el mismo valor que el secreto de la Edge Function.
begin;

create table if not exists splash_private.admin_push_devices (
  fcm_token text primary key check (length(fcm_token) between 30 and 4096),
  session_hash text not null references splash_private.sessions(token_hash) on delete cascade,
  registered_at timestamptz not null default now()
);
create index if not exists admin_push_devices_session_idx
  on splash_private.admin_push_devices(session_hash);
alter table splash_private.admin_push_devices enable row level security;
revoke all on splash_private.admin_push_devices from public, anon, authenticated;

-- Solo una sesión administrativa vigente puede registrar el token de su propio dispositivo.
create or replace function public.splash_push_registration(
  action text, session_token text, device_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare admin_session splash_private.sessions%rowtype;
begin
  if device_token is null or length(device_token) not between 30 and 4096 then
    return jsonb_build_object('error','Token de dispositivo inválido.');
  end if;
  select * into admin_session from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex')
      and is_admin and expires_at > now();
  if admin_session.token_hash is null then
    return jsonb_build_object('error','Inicia sesión como administrador.','code','SESSION');
  end if;
  if action = 'register' then
    insert into splash_private.admin_push_devices(fcm_token,session_hash)
      values(device_token,admin_session.token_hash)
      on conflict(fcm_token) do update set
        session_hash=excluded.session_hash,registered_at=now();
    return '{"ok":true}'::jsonb;
  elsif action = 'unregister' then
    delete from splash_private.admin_push_devices
      where fcm_token=device_token and session_hash=admin_session.token_hash;
    return '{"ok":true}'::jsonb;
  end if;
  return jsonb_build_object('error','Acción desconocida.');
end $$;
revoke all on function public.splash_push_registration(text,text,text) from public;
grant execute on function public.splash_push_registration(text,text,text) to anon, authenticated;

-- La Edge Function recibe solo datos de un registro QR real y tokens de
-- dispositivos asociados a sesiones admin vigentes. Los clientes no pueden
-- ejecutar esta función ni consultar la tabla de tokens.
create or replace function public.splash_push_event(p_person_id uuid, p_work_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare checkin splash_private.checkins%rowtype; targets jsonb;
begin
  select * into checkin from splash_private.checkins
    where person_id=p_person_id and work_date=p_work_date and source='QR';
  if checkin.person_id is null then return jsonb_build_object('error','Registro QR no encontrado.'); end if;
  select coalesce(jsonb_agg(d.fcm_token),'[]'::jsonb) into targets
    from splash_private.admin_push_devices d
    join splash_private.sessions s on s.token_hash=d.session_hash
    where s.is_admin and s.expires_at > now();
  return jsonb_build_object(
    'date',checkin.work_date,
    'time',to_char(checkin.checked_at at time zone 'America/Lima','HH24:MI'),
    'tokens',targets
  );
end $$;
revoke all on function public.splash_push_event(uuid,date) from public, anon, authenticated;
grant execute on function public.splash_push_event(uuid,date) to service_role;

-- pg_net envía el aviso solo después del COMMIT. Un fallo de la red de push
-- nunca debe impedir que el operario registre su asistencia.
create or replace function splash_private.enqueue_admin_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare hook_secret text;
begin
  if new.source <> 'QR' then return new; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise warning 'splash push: habilita pg_net para enviar avisos';
    return new;
  end if;
  select decrypted_secret into hook_secret from vault.decrypted_secrets
    where name='splash_push_webhook_secret' limit 1;
  if nullif(hook_secret,'') is null then
    raise warning 'splash push: falta splash_push_webhook_secret en Vault';
    return new;
  end if;
  perform net.http_post(
    url := 'https://yyhvpbgvmnhonyqzevfr.supabase.co/functions/v1/splash-admin-push',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-splash-webhook-secret',hook_secret),
    body := jsonb_build_object('person_id',new.person_id,'work_date',new.work_date),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'splash push: no se pudo encolar el aviso';
  return new;
end $$;
revoke all on function splash_private.enqueue_admin_push() from public, anon, authenticated;
drop trigger if exists splash_admin_push_on_checkin on splash_private.checkins;
create trigger splash_admin_push_on_checkin
  after insert on splash_private.checkins
  for each row execute function splash_private.enqueue_admin_push();

commit;
