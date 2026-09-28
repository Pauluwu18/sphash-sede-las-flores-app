-- Ejecutar en Supabase después de las migraciones anteriores.
-- La APK permite crear el PIN inicial sin QR; el QR sigue siendo obligatorio para checkin.
do $$
declare function_definition text;
begin
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure)
    into function_definition;
  function_definition := regexp_replace(
    function_definition,
    E'\\n[[:space:]]*if payload->>''qr'' is distinct from cfg\\.qr_token then return jsonb_build_object\\(''error'',''Escanea el QR de la base para crear tu PIN\\.''\\); end if;',
    '',
    'g'
  );
  execute function_definition;
end $$;