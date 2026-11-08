const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

test('pago por servicio: valores iniciales, resumen semanal del operario y edición solo para admin',async t=>{
  const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated;');
  await db.exec(`create schema realtime; create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select';`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
  for(const f of ['20260915_qr_attendance','20261004_delete_person','20261102_service_reports_and_app_updater','20261106_worker_service_report','20261108_payment_method_link'])
    await db.exec(fs.readFileSync(`migrations/${f}.sql`,'utf8'));
  const api=async(action,payload={},token='')=>(await db.query('select public.splash_api($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),token])).rows[0].result;
  const password=(await db.query('select password from splash_initial_access')).rows[0].password;
  const admin=await api('admin_login',{username:'admin',password});
  await api('save_person',{name:'Yerson Prueba',dni:'00112233'},admin.token);
  await api('save_person',{name:'Aramis Prueba',dni:'00445566'},admin.token);
  const migration=fs.readFileSync('migrations/20261109_service_earnings.sql','utf8');
  await db.exec(migration);

  const rates=Object.fromEntries((await db.query('select name, service_rate from splash_private.people')).rows.map(r=>[r.name,Number(r.service_rate)]));
  assert.equal(rates['Yerson Prueba'],40);
  assert.equal(rates['Aramis Prueba'],30);

  const qr=(await api('qr',{},admin.token)).token;
  const yerson=await api('activate',{dni:'00112233',pin:'1234',qr});
  const aramis=await api('activate',{dni:'00445566',pin:'5678',qr});
  const report=(token,id)=>db.query('select public.splash_report_service($1,$2::jsonb)',[token,JSON.stringify({id,amount:130,service:'Primer servicio',payment_method:'Efectivo'})]);
  await report(yerson.token,'sr_1762400000000_a1');await report(yerson.token,'sr_1762400000001_a2');await report(yerson.token,'sr_1762400000002_a3');
  await report(aramis.token,'sr_1762400000003_b1');

  const week=async(token,d=null)=>(await db.query('select public.splash_worker_week($1,$2) r',[token,d])).rows[0].r;
  const y=await week(yerson.token);
  assert.equal(y.services,3);assert.equal(y.rate,40);assert.equal(y.total,120);
  assert.equal(y.days.length,7);assert.equal(y.history.length,6);
  assert.equal(y.history[5].total,120,'la semana actual es la última del historial');
  assert.equal((await week(aramis.token)).total,30);
  assert.equal((await week(yerson.token,'2020-01-06')).services,0,'otra semana sin servicios');
  assert.equal((await week(admin.token)).code,'SESSION','el admin no usa la vista del operario');

  const adminWeek=async token=>(await db.query('select public.splash_admin_week($1,null) r',[token])).rows[0].r;
  assert.equal((await adminWeek(yerson.token)).code,'SESSION','un operario no ve el resumen de todos');
  const all=await adminWeek(admin.token);
  assert.equal(all.people.length,2);
  assert.equal(all.people.find(p=>p.name==='Yerson Prueba').total,120);

  const setRate=(token,id,rate)=>db.query('select public.splash_set_service_rate($1,$2,$3) r',[token,id,rate]).then(r=>r.rows[0].r);
  const aramisId=all.people.find(p=>p.name==='Aramis Prueba').id;
  assert.equal((await setRate(yerson.token,aramisId,99)).code,'SESSION','un operario no cambia pagos');
  assert.ok((await setRate(admin.token,aramisId,-1)).error);
  assert.equal((await setRate(admin.token,aramisId,35)).ok,true);
  assert.equal((await week(aramis.token)).total,35);

  await db.exec(migration);
  assert.equal((await week(aramis.token)).rate,35,'volver a ejecutar no pisa lo editado');
});
