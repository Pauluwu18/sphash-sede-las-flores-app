-- Ejecutar después de 20261109_service_earnings.sql.
-- Agenda del día (la sube la extensión desde splashapp.net.pe/agenda o el botón "Subir Excel" del
-- panel admin) y seguimiento de servicios pendientes por reportar de cada operario.
-- Un servicio queda "pendiente" cuando la agenda asigna más servicios a un operario en un día que
-- los que reportó: pendientes = agenda − reportados (nunca menos de cero).
begin;

create table if not exists splash_private.agenda_services (
  id bigserial primary key,
  work_date date not null,
  slot text not null default 'MAÑANA',
  operator_name text not null default '',
  client text not null default '',
  phone text not null default '',
  district text not null default '',
  amount numeric(10,2) not null default 0,
  extra numeric(10,2) not null default 0,
  payment_method text not null default '',
  movilidad text not null default '',
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_agenda_services_date on splash_private.agenda_services(work_date);
alter table splash_private.agenda_services enable row level security;

-- Vínculo manual entre el nombre completo de la agenda y una persona registrada.
create table if not exists splash_private.agenda_aliases (
  agenda_name text primary key,
  person_id uuid not null references splash_private.people(id) on delete cascade
);
alter table splash_private.agenda_aliases enable row level security;

-- Mayúsculas, sin tildes ni signos, espacios simples: para comparar nombres.
create or replace function splash_private.norm(t text)
returns text language sql immutable set search_path = '' as $$
  select trim(regexp_replace(upper(translate(coalesce(t,''),
    'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñ','AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuuNn')),
    '[^A-Z0-9]+',' ','g'))
$$;

-- Persona de la agenda: primero el vínculo manual; si no, la persona cuyo nombre aparece completo
-- dentro del nombre de la agenda (p. ej. "Aramis" dentro de "JOSUÉ ARAMIS SOTO CARDENAS").
create or replace function splash_private.agenda_person(p_name text)
returns uuid language sql stable set search_path = '' as $$
  select coalesce(
    (select a.person_id from splash_private.agenda_aliases a where a.agenda_name = splash_private.norm(p_name)),
    (select p.id from splash_private.people p
      where p.deleted_at is null and splash_private.norm(p.name) <> ''
        and not exists (
          select 1 from unnest(string_to_array(splash_private.norm(p.name),' ')) tok
          where tok <> '' and tok <> all(string_to_array(splash_private.norm(p_name),' ')))
      order by length(splash_private.norm(p.name)) desc, p.created_at limit 1))
$$;

-- Servicios que un operario reportó en un día: los de su cuenta en la app y los que el admin anotó
-- a mano con su nombre en caja.
create or replace function splash_private.reported_count(p_person uuid, p_agenda_name text, p_day date)
returns int language sql stable set search_path = '' as $$
  select count(*)::int from public.cash_movements m
  where m.type = 'ENTRADA' and m.date = to_char(p_day,'DD/MM/YYYY')
    and ((p_person is not null and m.person_id = p_person)
      or (m.person_id is null
          and splash_private.norm(regexp_replace(m.operator,'^[0-9]+\.\s*','')) <> ''
          and not exists (
            select 1 from unnest(string_to_array(splash_private.norm(regexp_replace(m.operator,'^[0-9]+\.\s*','')),' ')) tok
            where tok <> all(string_to_array(splash_private.norm(p_agenda_name),' ')))))
$$;

create or replace function splash_private.require_admin(session_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from splash_private.sessions s
    where s.token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex')
      and s.expires_at > now() and s.is_admin)
$$;

-- Sube (reemplaza) la agenda de un día. Solo administración.
create or replace function public.splash_agenda_upload(session_token text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d date; items jsonb; item jsonb; n int := 0; unlinked jsonb;
  op text; amt numeric; ext numeric; slot text;
begin
  if not splash_private.require_admin(session_token) then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  begin d := (payload->>'date')::date; exception when others then
    return jsonb_build_object('error','Fecha de agenda inválida.'); end;
  items := coalesce(payload->'services','[]'::jsonb);
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 400 then
    return jsonb_build_object('error','Lista de servicios inválida.');
  end if;

  delete from splash_private.agenda_services where work_date = d;
  for item in select * from jsonb_array_elements(items) loop
    op := left(trim(coalesce(item->>'operator','')), 120);
    begin amt := coalesce(nullif(item->>'amount','')::numeric, 0); exception when others then amt := 0; end;
    begin ext := coalesce(nullif(item->>'extra','')::numeric, 0); exception when others then ext := 0; end;
    slot := upper(coalesce(item->>'slot','MAÑANA'));
    if slot not in ('MAÑANA','TARDE','EXTRAS') then slot := 'MAÑANA'; end if;
    if amt < 0 or amt > 9999.99 or ext < 0 or ext > 9999.99 then continue; end if;
    insert into splash_private.agenda_services(work_date,slot,operator_name,client,phone,district,amount,extra,payment_method,movilidad)
      values(d, slot, op, left(trim(coalesce(item->>'client','')),120), left(trim(coalesce(item->>'phone','')),30),
             left(trim(coalesce(item->>'district','')),80), amt, ext,
             left(trim(coalesce(item->>'payment_method','')),30), left(trim(coalesce(item->>'movilidad','')),30));
    n := n + 1;
  end loop;

  select coalesce(jsonb_agg(distinct s.operator_name), '[]'::jsonb) into unlinked
    from splash_private.agenda_services s
    where s.work_date = d and s.operator_name <> '' and splash_private.norm(s.operator_name) <> 'SIN ASIGNAR'
      and splash_private.agenda_person(s.operator_name) is null;
  return jsonb_build_object('ok', true, 'date', d, 'count', n, 'unlinked', unlinked);
end $$;

-- Pendientes por operario de un día. Solo administración.
create or replace function public.splash_agenda_pending(session_token text, day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d date; result jsonb; unassigned int; uploaded timestamptz;
begin
  if not splash_private.require_admin(session_token) then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  d := coalesce(day, (now() at time zone 'America/Lima')::date);
  select count(*)::int into unassigned from splash_private.agenda_services s
    where s.work_date = d and (s.operator_name = '' or splash_private.norm(s.operator_name) = 'SIN ASIGNAR');
  select max(s.uploaded_at) into uploaded from splash_private.agenda_services s where s.work_date = d;

  select coalesce(jsonb_agg(o order by o->>'operator'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'operator', g.operator_name, 'person_id', g.person_id,
      'person_name', (select p.name from splash_private.people p where p.id = g.person_id),
      'linked', g.person_id is not null, 'agenda', g.agenda, 'reported', g.reported,
      'pending', greatest(g.agenda - g.reported, 0),
      'services', (select jsonb_agg(jsonb_build_object('slot', s.slot, 'client', s.client, 'district', s.district,
                     'amount', s.amount, 'extra', s.extra, 'payment_method', s.payment_method) order by s.id)
                   from splash_private.agenda_services s where s.work_date = d and s.operator_name = g.operator_name)) as o
    from (
      select a.operator_name, a.person_id, a.agenda,
             splash_private.reported_count(a.person_id, a.operator_name, d) as reported
      from (
        select s.operator_name, splash_private.agenda_person(s.operator_name) as person_id, count(*)::int as agenda
        from splash_private.agenda_services s
        where s.work_date = d and s.operator_name <> '' and splash_private.norm(s.operator_name) <> 'SIN ASIGNAR'
        group by s.operator_name
      ) a
    ) g
  ) q;
  return jsonb_build_object('ok', true, 'date', d, 'operators', result, 'unassigned', unassigned, 'uploaded_at', uploaded,
    'total_pending', coalesce((select sum((x->>'pending')::int) from jsonb_array_elements(result) x), 0));
end $$;

-- Vincula un nombre de la agenda con una persona registrada. Solo administración.
create or replace function public.splash_agenda_link(session_token text, agenda_label text, target_person uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not splash_private.require_admin(session_token) then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  if splash_private.norm(agenda_label) = '' then return jsonb_build_object('error','Nombre inválido.'); end if;
  if target_person is null then
    delete from splash_private.agenda_aliases a where a.agenda_name = splash_private.norm(agenda_label);
  else
    if not exists (select 1 from splash_private.people p where p.id = target_person and p.deleted_at is null) then
      return jsonb_build_object('error','Persona no encontrada.');
    end if;
    insert into splash_private.agenda_aliases(agenda_name, person_id)
      values(splash_private.norm(agenda_label), target_person)
      on conflict (agenda_name) do update set person_id = excluded.person_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Servicios pendientes del propio operario hoy (hora de Lima).
create or replace function public.splash_worker_pending(session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sess splash_private.sessions%rowtype;
  person splash_private.people%rowtype;
  d date; agenda int := 0; reported int := 0; svc jsonb; r record;
begin
  select * into sess from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex') and expires_at > now();
  if sess.token_hash is null or sess.is_admin then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  select * into person from splash_private.people where id = sess.person_id and active and deleted_at is null;
  if person.id is null then return jsonb_build_object('error','Cuenta desactivada.','code','SESSION'); end if;

  d := (now() at time zone 'America/Lima')::date;
  select coalesce(jsonb_agg(jsonb_build_object('slot', s.slot, 'district', s.district, 'amount', s.amount,
           'payment_method', s.payment_method) order by s.id), '[]'::jsonb), count(*)::int
    into svc, agenda
    from splash_private.agenda_services s
    where s.work_date = d and splash_private.agenda_person(s.operator_name) = person.id;
  for r in select distinct s.operator_name from splash_private.agenda_services s
           where s.work_date = d and splash_private.agenda_person(s.operator_name) = person.id loop
    reported := greatest(reported, splash_private.reported_count(person.id, r.operator_name, d));
  end loop;
  if agenda > 0 and reported = 0 then
    reported := splash_private.reported_count(person.id, '', d);
  end if;
  return jsonb_build_object('ok', true, 'date', d, 'agenda', agenda, 'reported', reported,
    'pending', greatest(agenda - reported, 0), 'services', svc);
end $$;

revoke all on function splash_private.require_admin(text) from public;
revoke all on function public.splash_agenda_upload(text,jsonb) from public;
revoke all on function public.splash_agenda_pending(text,date) from public;
revoke all on function public.splash_agenda_link(text,text,uuid) from public;
revoke all on function public.splash_worker_pending(text) from public;
grant execute on function public.splash_agenda_upload(text,jsonb) to anon, authenticated;
grant execute on function public.splash_agenda_pending(text,date) to anon, authenticated;
grant execute on function public.splash_agenda_link(text,text,uuid) to anon, authenticated;
grant execute on function public.splash_worker_pending(text) to anon, authenticated;

commit;
