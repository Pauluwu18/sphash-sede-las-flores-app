const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

test('splash_report_service valida la sesión del operario, toma su nombre de la cuenta y no duplica reenvíos',async t=>{
  const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated;');
  await db.exec(`create schema realtime; create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select';`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/20260915_qr_attendance.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/20261004_delete_person.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/20261102_service_reports_and_app_updater.sql','utf8'));
  const migration=fs.readFileSync('migrations/20261106_worker_service_report.sql','utf8');
  await db.exec(migration);await db.exec(migration);

  await db.exec(fs.readFileSync('migrations/20261108_payment_method_link.sql','utf8'));
  const api=async(action,payload={},token='')=>(await db.query('select public.splash_api($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),token])).rows[0].result;
  const report=async(token,payload)=>(await db.query('select public.splash_report_service($1,$2::jsonb) result',[token,JSON.stringify(payload)])).rows[0].result;
  const password=(await db.query('select password from splash_initial_access')).rows[0].password;
  const admin=await api('admin_login',{username:'admin',password});
  const person=await api('save_person',{name:'Yerson Prueba',dni:'00112233'},admin.token);
  const qr=(await api('qr',{},admin.token)).token;
  const worker=await api('activate',{dni:'00112233',pin:'1234',qr});
  const valid={id:'sr_1762400000000_ab12',amount:150,service:'Cuarto servicio',payment_method:'Yape',observation:'vuelto en yape',second_operator:'Paul',operator:'Suplantado'};

  assert.equal((await report(worker.token,{...valid,id:'sr_1762400000001_link',payment_method:'Link'})).ok,true,'Link es un método válido');
  await db.exec("delete from public.cash_movements where id='sr_1762400000001_link'");
  assert.equal((await report('',valid)).code,'SESSION','sin sesión se rechaza');
  assert.equal((await report(admin.token,valid)).code,'SESSION','una sesión admin no sirve para reportar como operario');

  const ok=await report(worker.token,valid);
  assert.equal(ok.ok,true);
  assert.match(ok.date,/^\d{2}\/\d{2}\/\d{4}$/,'fecha en el formato que consulta administración');
  assert.equal(ok.operator,'Yerson Prueba y Paul','el nombre sale de la cuenta, no del cliente');
  const row=(await db.query('select * from public.cash_movements')).rows[0];
  assert.equal(row.source,'worker');
  assert.equal(row.person_id,person.id);
  assert.equal(Number(row.amount),150);
  assert.equal(row.concept,'Cuarto servicio - Yape (vuelto en yape)');
  assert.equal(row.date,ok.date);

  const retry=await report(worker.token,valid);
  assert.equal(retry.duplicate,true);
  assert.equal((await db.query('select count(*)::int n from public.cash_movements')).rows[0].n,1,'el reenvío no duplica');

  for(const bad of [{amount:0},{amount:-5},{amount:'abc'},{amount:100000},{service:''},{payment_method:'Bitcoin'},{id:'otro'},{photo:'data:text/html;base64,AAAA'},{observation:'x'.repeat(201)}]){
    const result=await report(worker.token,{...valid,id:'sr_1762400000001_cd34',...bad});
    assert.ok(result.error,`debe rechazar ${JSON.stringify(bad).slice(0,40)}`);
  }
  assert.equal((await report(worker.token,{...valid,id:'sr_1762400000002_ef56',photo:'data:image/jpeg;base64,AAAA'})).ok,true);
  assert.equal((await db.query('select count(*)::int n from public.cash_movements')).rows[0].n,2);

  await api('save_person',{id:person.id,name:'Yerson Prueba',dni:'00112233',active:false},admin.token);
  assert.equal((await report(worker.token,{...valid,id:'sr_1762400000003_gh78'})).code,'SESSION','una cuenta desactivada ya no reporta');
});
