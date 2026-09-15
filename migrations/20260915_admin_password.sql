-- Ejecutar después de 20260915_qr_attendance.sql para conservar la clave solicitada.
-- No modifica perfiles, PIN ni asistencias.
begin;
do $$
declare requested_password text := 'REEMPLAZAR_CLAVE_EN_SUPABASE';
begin
  if requested_password = 'REEMPLAZAR_' || 'CLAVE_EN_SUPABASE' then
    raise exception 'Introduce la clave solicitada en el SQL Editor antes de ejecutar.';
  end if;
  if not exists (select 1 from splash_private.settings where id) then
    raise exception 'Primero ejecuta 20260915_qr_attendance.sql.';
  end if;
  update splash_private.settings
  set admin_hash = extensions.crypt(requested_password, extensions.gen_salt('bf', 10))
  where id;
  delete from splash_private.sessions where is_admin;
  delete from splash_private.login_attempts where account = 'admin';
end $$;
commit;
select 'admin' as usuario, 'Clave de administrador actualizada.' as resultado;
