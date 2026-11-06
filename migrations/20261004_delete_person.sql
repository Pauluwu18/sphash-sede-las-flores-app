-- Elimina del listado y revoca el acceso sin borrar asistencias ni auditoría.
-- Actualiza únicamente las ramas necesarias de la API existente.
begin;
alter table splash_private.people add column if not exists deleted_at timestamptz;
do $migration$
declare definition text;
  deletion text := $branch$    when 'delete_person' then
      update splash_private.people set active=false,deleted_at=coalesce(deleted_at,now()),pin_hash=null,pin_cipher=null
        where id=(payload->>'id')::uuid;
      if not found then return jsonb_build_object('error','La persona no existe.'); end if;
      delete from splash_private.sessions where person_id=(payload->>'id')::uuid;
      return '{"ok":true}'::jsonb;
$branch$;
begin
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure) into definition;
  if position('deleted_at=coalesce(deleted_at,now())' in definition)>0 then return; end if;
  if position('when ''delete_person'' then' in definition)>0 then
    raise exception 'Ya existe otra implementación de delete_person. Revisar antes de reemplazar.';
  end if;
  if position('into result from splash_private.people; return result;' in definition)=0
    or position('    when ''deactivate_person'' then' in definition)=0 then
    raise exception 'No se encontró la API esperada. No se aplicaron cambios.';
  end if;
  definition:=replace(definition,'into result from splash_private.people; return result;',
    'into result from splash_private.people where deleted_at is null; return result;');
  definition:=replace(definition,'where id=(payload->>''id'')::uuid for update;',
    'where id=(payload->>''id'')::uuid and deleted_at is null for update;');
  definition:=replace(definition,'    when ''deactivate_person'' then',deletion || '    when ''deactivate_person'' then');
  execute definition;
end $migration$;
commit;
