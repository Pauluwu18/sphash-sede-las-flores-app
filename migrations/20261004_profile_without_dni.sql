-- Update only profile saving. Keep attendance, push and session behavior.
begin;
do $migration$
declare definition text;
  original text := $old$    when 'save_person' then
      if nullif(trim(payload->>'name'),'') is null then return jsonb_build_object('error','Escribe el nombre.'); end if;
      if nullif(payload->>'dni','') is null or payload->>'dni' !~ '^[0-9]{8}$' then return jsonb_build_object('error','El DNI debe tener 8 dígitos.'); end if;
      if nullif(payload->>'id','') is null then
        insert into splash_private.people(name,dni,person_type) values(trim(payload->>'name'),payload->>'dni',coalesce(payload->>'type','Operario')) returning id into person.id;
      else
        select * into person from splash_private.people where id=(payload->>'id')::uuid and deleted_at is null for update;
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
$old$;
  replacement text := $new$    when 'save_person' then
      if nullif(trim(payload->>'name'),'') is null then return jsonb_build_object('error','Escribe el nombre.'); end if;
      if (nullif(payload->>'id','') is null and nullif(payload->>'dni','') is null)
        or (nullif(payload->>'dni','') is not null and payload->>'dni' !~ '^[0-9]{8}$') then
        return jsonb_build_object('error','El DNI debe tener 8 dígitos.'); end if;
      if nullif(payload->>'id','') is null then
        insert into splash_private.people(name,dni,person_type) values(trim(payload->>'name'),payload->>'dni',coalesce(payload->>'type','Operario')) returning id into person.id;
      else
        select * into person from splash_private.people where id=(payload->>'id')::uuid and deleted_at is null for update;
        if person.id is null then return jsonb_build_object('error','La persona no existe.'); end if;
        if person.dni is not null and nullif(payload->>'dni','') is null then
          return jsonb_build_object('error','El DNI registrado debe conservar 8 dígitos.'); end if;
        -- Cambiar DNI revoca PIN y sesiones para no reutilizar credenciales de otra persona.
        if person.dni is distinct from nullif(payload->>'dni','') then
          delete from splash_private.sessions where person_id=person.id;
          update splash_private.people set pin_hash=null,pin_cipher=null where id=person.id;
        end if;
        update splash_private.people set name=trim(payload->>'name'),dni=nullif(payload->>'dni',''),person_type=coalesce(payload->>'type','Operario'),
          active=coalesce((payload->>'active')::boolean,true) where id=person.id;
        if payload->>'active'='false' then
          delete from splash_private.sessions where person_id=person.id;
        end if;
      end if;
      return jsonb_build_object('ok',true,'id',person.id);
$new$;
begin
  original:=replace(original,E'\r\n',E'\n');
  replacement:=replace(replacement,E'\r\n',E'\n');
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure) into definition;
  definition:=replace(definition,E'\r\n',E'\n');
  if position(replacement in definition)>0 then return; end if;
  if position(original in definition)=0 then
    raise exception 'Unexpected save_person definition. No changes applied.';
  end if;
  execute replace(definition,original,replacement);
end $migration$;
commit;
