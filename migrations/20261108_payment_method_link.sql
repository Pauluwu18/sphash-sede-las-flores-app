-- Ejecutar después de 20261106_worker_service_report.sql.
-- Agrega "Link" (pago por link de cobro, p. ej. Izipay) como método de pago válido en los
-- reportes de servicio de los operarios. Es repetible y no modifica datos existentes.
-- El link es un pago digital: entra a la cuenta de la empresa, no a la caja en efectivo.
begin;

create or replace function public.splash_report_service(session_token text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sess splash_private.sessions%rowtype;
  person splash_private.people%rowtype;
  amt numeric; svc text; method text; second_op text; obs text; photo text; report_id text;
  day_key text; hhmm text; op_name text; inserted int;
begin
  select * into sess from splash_private.sessions
    where token_hash = encode(extensions.digest(coalesce(session_token,''),'sha256'),'hex')
      and expires_at > now();
  if sess.token_hash is null or sess.is_admin then
    return jsonb_build_object('error','Tu sesión venció. Vuelve a iniciar sesión.','code','SESSION');
  end if;
  select * into person from splash_private.people
    where id = sess.person_id and active and deleted_at is null;
  if person.id is null then
    return jsonb_build_object('error','Cuenta desactivada.','code','SESSION');
  end if;

  begin
    amt := round((payload->>'amount')::numeric, 2);
  exception when others then
    return jsonb_build_object('error','Monto inválido.');
  end;
  svc := trim(coalesce(payload->>'service',''));
  method := coalesce(payload->>'payment_method','');
  second_op := trim(coalesce(payload->>'second_operator',''));
  obs := trim(coalesce(payload->>'observation',''));
  photo := coalesce(payload->>'photo','');
  report_id := coalesce(payload->>'id','');

  if amt is null or amt <= 0 or amt > 9999.99 then return jsonb_build_object('error','Monto inválido.'); end if;
  if length(svc) not between 1 and 60 then return jsonb_build_object('error','Indica el servicio.'); end if;
  if method not in ('Yape','Plin','Tarjeta','Link','Efectivo') then return jsonb_build_object('error','Método de pago inválido.'); end if;
  if length(second_op) > 100 or length(obs) > 200 then return jsonb_build_object('error','Texto demasiado largo.'); end if;
  if report_id !~ '^sr_[0-9]{10,}_[a-z0-9]{1,8}$' then return jsonb_build_object('error','Reporte inválido.'); end if;
  if photo <> '' and (photo not like 'data:image/jpeg;base64,%' or length(photo) > 900000) then
    return jsonb_build_object('error','La foto no es válida o es demasiado grande.');
  end if;

  day_key := to_char(now() at time zone 'America/Lima','DD/MM/YYYY');
  hhmm := to_char(now() at time zone 'America/Lima','HH24:MI');
  if (select count(*) from public.cash_movements where person_id = person.id and date = day_key) >= 60 then
    return jsonb_build_object('error','Se alcanzó el límite diario de reportes.');
  end if;
  op_name := case when second_op <> '' then person.name || ' y ' || second_op else person.name end;

  insert into public.cash_movements(id,date,type,amount,operator,service_number,payment_method,
      observation,concept,photo,time,person_id,source)
    values(report_id,day_key,'ENTRADA',amt,op_name,svc,method,obs,
      svc || ' - ' || method || case when obs <> '' then ' (' || obs || ')' else '' end,
      photo,hhmm,person.id,'worker')
    on conflict(id) do nothing;
  get diagnostics inserted = row_count;
  return jsonb_build_object('ok',true,'id',report_id,'date',day_key,'time',hhmm,'operator',op_name,'duplicate',inserted = 0);
end $$;

revoke all on function public.splash_report_service(text,jsonb) from public;
grant execute on function public.splash_report_service(text,jsonb) to anon, authenticated;

commit;
