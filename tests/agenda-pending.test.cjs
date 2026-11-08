const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

test('agenda: se sube por admin, calcula pendientes por operario y día y avisa al operario',async t=>{
  const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated;');
  await db.exec(`create schema realtime; create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select';`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
  for(const f of ['20260915_qr_attendance','20261004_delete_person','20261102_service_reports_and_app_updater','20261106_worker_service_report','20261108_payment_method_link','20261109_service_earnings'])
    await db.exec(fs.readFileSync(`migrations/${f}.sql`,'utf8'));
  const migration=fs.readFileSync('migrations/20261110_agenda_pending.sql','utf8');
  await db.exec(migration);await db.exec(migration);

  const api=async(action,payload={},token='')=>(await db.query('select public.splash_api($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),token])).rows[0].result;
  const rpc=async(fn,args)=>(await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args)).rows[0].r;
  const password=(await db.query('select password from splash_initial_access')).rows[0].password;
  const admin=await api('admin_login',{username:'admin',password});
  await api('save_person',{name:'Aramis',dni:'00112233'},admin.token);
  const yerson=(await api('save_person',{name:'Yerson Alvarado',dni:'00445566'},admin.token));
  await api('save_person',{name:'Fabrizio Cruz',dni:'00778899'},admin.token);
  const qr=(await api('qr',{},admin.token)).token;
  const aramis=await api('activate',{dni:'00112233',pin:'1234',qr});
  const yersonW=await api('activate',{dni:'00445566',pin:'5678',qr});

  const today=(await db.query(`select (now() at time zone 'America/Lima')::date::text d`)).rows[0].d;
  const services=[
    {slot:'MAÑANA',operator:'JOSUÉ ARAMIS SOTO CARDENAS',client:'C1',district:'ATE',amount:130,payment_method:'Efectivo'},
    {slot:'TARDE',operator:'JOSUÉ ARAMIS SOTO CARDENAS',client:'C2',district:'LINCE',amount:120,payment_method:'Yape / Plin'},
    {slot:'MAÑANA',operator:'YERSON ROBIÑO ALVARADO CAMPOS',client:'C3',district:'SURCO',amount:130,payment_method:'Tarjeta'},
    {slot:'MAÑANA',operator:'FABRIZIO ANTONY CRUZ MARTINEZ',client:'C4',district:'CALLAO',amount:130,payment_method:'Efectivo'},
    {slot:'MAÑANA',operator:'LIONEL MATÍAS ROJAS PICON',client:'C5',district:'ATE',amount:160,payment_method:'Efectivo'},
    {slot:'MAÑANA',operator:'Sin asignar',client:'C6',district:'RIMAC',amount:140,payment_method:'Efectivo'}
  ];

  assert.equal((await rpc('splash_agenda_upload',['',{date:today,services}])).code,'SESSION','sin sesión no sube');
  assert.equal((await rpc('splash_agenda_upload',[aramis.token,{date:today,services}])).code,'SESSION','un operario no sube');
  const up=await rpc('splash_agenda_upload',[admin.token,{date:today,services}]);
  assert.equal(up.ok,true);assert.equal(up.count,6);
  assert.deepEqual(up.unlinked,['LIONEL MATÍAS ROJAS PICON'],'quien no coincide con una persona queda sin vincular');
  assert.equal((await rpc('splash_agenda_upload',[admin.token,{date:today,services}])).count,6,'volver a subir reemplaza, no duplica');

  let pending=await rpc('splash_agenda_pending',[admin.token,today]);
  const byOp=()=>Object.fromEntries(['ARAMIS','YERSON','FABRIZIO','LIONEL'].map(k=>[k,pending.operators.find(o=>o.operator.includes(k))]));
  assert.equal(pending.operators.length,4);
  assert.equal(byOp().ARAMIS.agenda,2);assert.equal(byOp().ARAMIS.pending,2);
  assert.equal(pending.unassigned,1);
  assert.equal(pending.total_pending,5);

  // Aramis reporta 1 desde la app; el admin anota a mano uno de Fabrizio.
  await rpc('splash_report_service',[aramis.token,{id:'sr_1762400000000_a1',amount:130,service:'Primer servicio',payment_method:'Efectivo'}]);
  await db.query(`insert into public.cash_movements(id,date,type,amount,operator,payment_method,concept)
    values('adm1',to_char((now() at time zone 'America/Lima')::date,'DD/MM/YYYY'),'ENTRADA',130,'3. FABRIZIO','Efectivo','servicio')`);
  pending=await rpc('splash_agenda_pending',[admin.token,today]);
  assert.equal(byOp().ARAMIS.reported,1);assert.equal(byOp().ARAMIS.pending,1);
  assert.equal(byOp().FABRIZIO.pending,0,'lo anotado a mano en caja también cuenta');
  assert.equal(byOp().YERSON.pending,1);

  // Vincular un nombre de la agenda con una persona.
  const people=await api('people',{},admin.token);
  assert.equal((await rpc('splash_agenda_link',[aramis.token,'LIONEL MATÍAS ROJAS PICON',null])).code,'SESSION');
  const link=await rpc('splash_agenda_link',[admin.token,'LIONEL MATÍAS ROJAS PICON',yerson.id||(await db.query(`select id from splash_private.people where name='Yerson Alvarado'`)).rows[0].id]);
  assert.equal(link.ok,true);
  pending=await rpc('splash_agenda_pending',[admin.token,today]);
  assert.equal(byOp().LIONEL.linked,true);

  // Vista del operario.
  const mine=await rpc('splash_worker_pending',[aramis.token]);
  assert.equal(mine.agenda,2);assert.equal(mine.reported,1);assert.equal(mine.pending,1);
  assert.equal(mine.services.length,2);
  assert.equal(JSON.stringify(mine).includes('C1'),false,'el operario no recibe los datos del cliente');
  const mineY=await rpc('splash_worker_pending',[yersonW.token]);
  assert.equal(mineY.agenda,2,'Yerson recibe también el servicio vinculado de Lionel');
  assert.equal((await rpc('splash_worker_pending',[admin.token])).code,'SESSION');

  // Otro día sin agenda: nada pendiente.
  const empty=await rpc('splash_agenda_pending',[admin.token,'2020-01-01']);
  assert.equal(empty.total_pending,0);
});
