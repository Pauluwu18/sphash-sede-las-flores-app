-- Apply after the existing attendance/push migrations. Does not extend existing sessions.
begin;
do $migration$
declare
  definition text;
  original text := 'person.id,action=''admin_login'',now()+interval ''12 hours'');';
  replacement text := 'person.id,action=''admin_login'',now()+case when action=''admin_login'' and payload->''remember_session''=''true''::jsonb then interval ''30 days'' else interval ''12 hours'' end);';
begin
  select pg_get_functiondef('public.splash_api(text,jsonb,text)'::regprocedure) into definition;
  if position(replacement in definition)>0 then return; end if;
  if position(original in definition)=0 then
    raise exception 'No se encontró la creación de sesiones esperada. Revisar splash_api antes de aplicar.';
  end if;
  execute replace(definition,original,replacement);
end $migration$;
commit;
