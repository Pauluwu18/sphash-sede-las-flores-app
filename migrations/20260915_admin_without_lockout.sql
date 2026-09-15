-- Aplicar en Supabase para quitar únicamente el bloqueo temporal de admin.
-- Mantiene la comprobación de contraseña y el bloqueo de PIN de operarios.
begin;
do $migration$
declare
  definition text;
  old_guard text := 'if attempts.failures >= 5 then';
  new_guard text := 'if action <> ''admin_login'' and attempts.failures >= 5 then';
begin
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure)
    into definition;
  if position(new_guard in definition) > 0 then
    null; -- Ya actualizado.
  elsif position(old_guard in definition) > 0 then
    execute replace(definition, old_guard, new_guard);
  else
    raise exception 'La función tiene otra versión. No se realizó ningún cambio.';
  end if;
  delete from splash_private.login_attempts where account = 'admin';
end $migration$;
notify pgrst, 'reload schema';
commit;
select 'Administrador sin bloqueo temporal. Se conserva su contraseña.' as resultado;
