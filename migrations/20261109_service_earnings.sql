-- Ejecutar después de 20261108_payment_method_link.sql.
-- Pago por servicio de cada operario (editable desde el panel admin) y resumen semanal
-- con servicios y ganancias. Valor inicial: S/ 30 por servicio; Yerson S/ 40.
-- El valor inicial se asigna solo la primera vez; volver a ejecutar no pisa lo que edite el admin.
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'splash_private' and table_name = 'people' and column_name = 'service_rate') then
    alter table splash_private.people
      add column service_rate numeric(8,2) not null default 30 check (service_rate >= 0 and service_rate <= 9999.99);
    update splash_private.people set service_rate = 40 where lower(name) like 'yerson%';
  end if;
end $$;

-- Lunes de la semana (hora de Lima) que contiene la fecha pedida; sin fecha = semana actual.
create or replace function splash_private.week_monday(p_day date default null)
returns date language sql stable set search_path = '' as $$
  select date_trunc('week', coalesce(p_day, (now() at time zone 'America/Lima')::date))::date
$$;

-- Servicios reportados por una persona en un rango; devuelve un registro por día.
create or replace function splash_private.service_days(p_person uuid, p_from date, p_to date)
returns table(day date, services int) language sql stable set search_path = '' as $$
  select d::date as day,
         (select count(*)::int from public.cash_movements m
           where m.person_id = p_person and m.type = 'ENTRADA' and m.source = 'worker'
             and m.date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' and to_date(m.date,'DD/MM/YYYY') = d::date) as services
  from generate_series(p_from, p_to, interval '1 day') d
$$;

-- Resumen de la semana del propio operario y de sus últimas semanas.
create or replace function public.splash_worker_week(session_token text, week_start date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sess splash_private.sessions%rowtype;
  person splash_private.people%rowtype;
  monday date; hist jsonb; days jsonb; n int; i int; svc int;
begin
  select * into sess from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex') and expires_at > now();
  if sess.token_hash is null or sess.is_admin then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  select * into person from splash_private.people where id = sess.person_id and active and deleted_at is null;
  if person.id is null then return jsonb_build_object('error','Cuenta desactivada.','code','SESSION'); end if;

  monday := splash_private.week_monday(week_start);
  select coalesce(jsonb_agg(jsonb_build_object('date', sd.day, 'services', sd.services) order by sd.day), '[]'::jsonb),
         coalesce(sum(sd.services), 0)
    into days, n from splash_private.service_days(person.id, monday, monday + 6) sd;

  hist := '[]'::jsonb;
  for i in reverse 5..0 loop
    select coalesce(sum(sd.services), 0) into svc
      from splash_private.service_days(person.id, monday - 7*i, monday - 7*i + 6) sd;
    hist := hist || jsonb_build_object('week_start', monday - 7*i, 'services', svc, 'total', svc * person.service_rate);
  end loop;

  return jsonb_build_object('ok', true, 'name', person.name, 'week_start', monday, 'week_end', monday + 6,
    'rate', person.service_rate, 'services', n, 'total', n * person.service_rate, 'days', days, 'history', hist);
end $$;

-- Resumen semanal de todo el personal activo, para administración.
create or replace function public.splash_admin_week(session_token text, week_start date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sess splash_private.sessions%rowtype;
  monday date; people_rows jsonb;
begin
  select * into sess from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex') and expires_at > now();
  if sess.token_hash is null or not sess.is_admin then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  monday := splash_private.week_monday(week_start);
  select coalesce(jsonb_agg(q.r order by q.r->>'name'), '[]'::jsonb) into people_rows from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'rate', p.service_rate,
      'services', (select coalesce(sum(sd.services), 0) from splash_private.service_days(p.id, monday, monday + 6) sd),
      'total', p.service_rate * (select coalesce(sum(sd.services), 0) from splash_private.service_days(p.id, monday, monday + 6) sd),
      'days', (select jsonb_agg(sd.services order by sd.day) from splash_private.service_days(p.id, monday, monday + 6) sd)) as r
    from splash_private.people p where p.active and p.deleted_at is null
  ) q;
  return jsonb_build_object('ok', true, 'week_start', monday, 'week_end', monday + 6, 'people', people_rows);
end $$;

-- Cambio del pago por servicio (solo administración).
create or replace function public.splash_set_service_rate(session_token text, person_id uuid, rate numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sess splash_private.sessions%rowtype; updated int;
begin
  select * into sess from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex') and expires_at > now();
  if sess.token_hash is null or not sess.is_admin then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  if rate is null or rate < 0 or rate > 9999.99 then return jsonb_build_object('error','Pago por servicio inválido.'); end if;
  update splash_private.people p set service_rate = round(rate, 2) where p.id = person_id and p.deleted_at is null;
  get diagnostics updated = row_count;
  if updated = 0 then return jsonb_build_object('error','Persona no encontrada.'); end if;
  return jsonb_build_object('ok', true, 'id', person_id, 'rate', round(rate, 2));
end $$;

revoke all on function public.splash_worker_week(text,date) from public;
revoke all on function public.splash_admin_week(text,date) from public;
revoke all on function public.splash_set_service_rate(text,uuid,numeric) from public;
grant execute on function public.splash_worker_week(text,date) to anon, authenticated;
grant execute on function public.splash_admin_week(text,date) to anon, authenticated;
grant execute on function public.splash_set_service_rate(text,uuid,numeric) to anon, authenticated;

commit;
