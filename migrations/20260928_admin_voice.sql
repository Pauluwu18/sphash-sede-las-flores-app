begin;
alter table splash_private.admin_push_devices
  add column if not exists voice_enabled boolean not null default false;

create or replace function public.splash_push_registration_voice(
  action text, session_token text, device_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.splash_push_registration(action,session_token,device_token);
  if action='register' and result->>'ok'='true' then
    update splash_private.admin_push_devices set voice_enabled=true
      where fcm_token=device_token;
  end if;
  return result;
end $$;
revoke all on function public.splash_push_registration_voice(text,text,text) from public;
grant execute on function public.splash_push_registration_voice(text,text,text) to anon,authenticated;

create or replace function public.splash_push_event(p_person_id uuid,p_work_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare checkin splash_private.checkins%rowtype; targets jsonb; voices jsonb; person_name text;
begin
  select * into checkin from splash_private.checkins
    where person_id=p_person_id and work_date=p_work_date and source='QR';
  if checkin.person_id is null then return jsonb_build_object('error','Registro QR no encontrado.'); end if;
  select name into person_name from splash_private.people where id=p_person_id;
  select coalesce(jsonb_agg(d.fcm_token),'[]'::jsonb),
         coalesce(jsonb_agg(d.fcm_token) filter (where d.voice_enabled),'[]'::jsonb)
    into targets,voices
    from splash_private.admin_push_devices d
    join splash_private.sessions s on s.token_hash=d.session_hash
    where s.is_admin and s.expires_at>now();
  return jsonb_build_object('date',checkin.work_date,
    'time',to_char(checkin.checked_at at time zone 'America/Lima','HH24:MI'),
    'name',left(person_name,160),'event_id',p_person_id::text||':'||p_work_date::text,
    'tokens',targets,'voice_tokens',voices);
end $$;
revoke all on function public.splash_push_event(uuid,date) from public,anon,authenticated;
grant execute on function public.splash_push_event(uuid,date) to service_role;
commit;
