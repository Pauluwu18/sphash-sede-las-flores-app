const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('Migración y flujos de asistencia sobre PostgreSQL aislado', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated;');
  await db.exec(`create schema realtime; create table realtime.events(payload jsonb,event text,topic text,private boolean);
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'insert into realtime.events values($1,$2,$3,$4)';`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
  const migration = fs.readFileSync('migrations/20260915_qr_attendance.sql','utf8');
  await db.exec(migration);
  const initial = (await db.query('select password from splash_initial_access')).rows[0].password;
  async function api(action, payload={}, token='') {
    return (await db.query('select public.splash_api($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),token])).rows[0].result;
  }
  const admin = await api('admin_login',{username:'admin',password:initial});
  assert.ok(admin.token);
  let qr = (await api('qr',{},admin.token)).token;
  let worker;
  let personId;
  const today = (await db.query("select to_char(now() at time zone 'America/Lima','DD/MM/YYYY') as workday")).rows[0].workday;

  await t.test('las tablas privadas y asistencias no son públicas', async () => {
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from splash_private.people'), /permission denied/);
    await assert.rejects(db.query('select * from public.daily_records'), /permission denied/);
    assert.equal((await api('people')).code,'SESSION');
    await db.exec('reset role');
  });
  await t.test('DNI único, creación de PIN y cifrado recuperable solo por admin', async () => {
    personId = (await api('save_person',{name:'Operario de prueba',dni:'00000001'},admin.token)).id;
    assert.ok(personId);
    assert.ok((await api('save_person',{name:'Otro operario',dni:'00000001'},admin.token)).error);
    assert.ok((await api('worker_login',{dni:'00000001'})).needs_pin);
    assert.ok((await api('activate',{dni:'00000001',pin:'0123',qr:'incorrecto'})).error);
    worker = await api('activate',{dni:'00000001',pin:'0123',qr});
    assert.ok(worker.token);
    assert.ok((await api('activate',{dni:'00000001',pin:'9999',qr})).error);
    assert.equal((await api('person_pin',{id:personId},admin.token)).pin,'0123');
    assert.ok((await api('person_pin',{id:personId},worker.token)).error);
    const row = (await db.query('select pin_hash, pin_cipher::text cipher from splash_private.people where id=$1',[personId])).rows[0];
    assert.notEqual(row.pin_hash,'0123'); assert.notEqual(row.cipher,'0123');
    assert.ok((await api('worker_login',{dni:'00000001',pin:'0123'})).token);
  });
  await t.test('QR válido, registro único e historial personal', async () => {
    assert.ok((await api('checkin',{qr:'incorrecto'},worker.token)).error);
    assert.ok((await api('checkin',{qr},worker.token)).ok);
    assert.ok((await api('checkin',{qr},worker.token)).already);
    const record = await api('records',{date:today},admin.token);
    assert.equal(record.arrivals.length,1);
    assert.equal(record.arrivals[0].source,'QR');
    assert.match(record.report,/Operario de prueba/);
    const history = await api('my_attendance',{},worker.token);
    assert.equal(history.length,1); assert.equal(history[0].source,'QR');
    assert.ok((await api('people',{},worker.token)).error);
    assert.ok((await api('records',{},worker.token)).error);
  });
  await t.test('un guardado antiguo no pisa una llegada QR; solo padrón para manual', async () => {
    const old = await api('records',{date:today},admin.token);
    await api('save_person',{name:'Segundo operario',dni:'00000002'},admin.token);
    const second = await api('activate',{dni:'00000002',pin:'5678',qr});
    await api('checkin',{qr},second.token);
    assert.equal((await api('save_record',{date:today,arrivals:old.arrivals,expected:old.updated_at},admin.token)).code,'CONFLICT');
    const current = await api('records',{date:today},admin.token);
    assert.equal(current.arrivals.length,2);
    assert.ok((await api('save_record',{date:today,arrivals:[...current.arrivals,{name:'Desconocido'}],expected:current.updated_at},admin.token)).error);
    await api('save_person',{name:'Manual de prueba',dni:'00000003'},admin.token);
    const saved = await api('save_record',{date:today,arrivals:[...current.arrivals,{name:'Manual de prueba',type:'Operario',arrivalTime:'09:15',active:true}],expected:current.updated_at},admin.token);
    assert.equal(saved.arrivals.length,3);
    const third = await api('activate',{dni:'00000003',pin:'0000',qr});
    assert.equal((await api('my_attendance',{},third.token))[0].source,'Manual');
    assert.ok((await api('checkin',{qr},third.token)).already);
  });
  await t.test('reemplazar QR invalida el anterior y cinco intentos bloquean el PIN', async () => {
    const next = await api('rotate_qr',{},admin.token);
    assert.notEqual(next.token,qr);
    assert.ok((await api('checkin',{qr},worker.token)).error);
    qr=next.token;
    for(let i=0;i<5;i++) assert.ok((await api('worker_login',{dni:'00000001',pin:'9999'})).error);
    assert.match((await api('worker_login',{dni:'00000001',pin:'0123'})).error,/15 minutos/);
  });
  await t.test('los avisos realtime no contienen datos personales', async () => {
    const events=(await db.query('select * from realtime.events')).rows;
    assert.ok(events.length);
    for(const event of events) { assert.deepEqual(event.payload,{changed:true}); assert.equal(event.event,'attendance_changed'); }
  });
  await t.test('un lote inválido no guarda asistencias parciales', async () => {
    const p = await api('save_person',{name:'Prueba atomicidad',dni:'00000005'},admin.token);
    const rec = await api('records',{date:today},admin.token);
    const invalid = await api('save_record',{date:today,expected:rec.updated_at,arrivals:[...rec.arrivals,{name:'Prueba atomicidad',type:'Operario'},{name:'No existe'}]},admin.token);
    assert.ok(invalid.error);
    assert.equal((await db.query('select * from splash_private.checkins where person_id=$1',[p.id])).rows.length,0);
  });
  await t.test('el QR conserva justificaciones y elimina la falta de quien llegó', async () => {
    const report=(await db.query("select splash_private.report($1::jsonb,'15/09/2026',$2) report",[
      JSON.stringify([{name:'Presente',type:'Operario'}]),'15/09/2026\n*Faltas*\n1. Presente(falta)\n2. Ausente(justificado)'
    ])).rows[0].report;
    assert.match(report,/1\. Ausente\(justificado\)/);
    assert.doesNotMatch(report,/Presente\(falta\)/);
  });
  await t.test('cambiar DNI revoca la sesión y obliga a crear un PIN nuevo', async () => {
    await api('save_person',{id:personId,name:'Operario de prueba',dni:'00000004'},admin.token);
    assert.equal((await api('me',{},worker.token)).code,'SESSION');
    assert.equal((await api('person_pin',{id:personId},admin.token)).pin,null);
    assert.ok((await api('worker_login',{dni:'00000004'})).needs_pin);
  });
  await t.test('repetir la migración no cambia QR, cuentas ni clave admin', async () => {
    await db.exec(migration);
    assert.equal((await api('qr',{},admin.token)).token,qr);
    assert.ok((await api('admin_login',{username:'admin',password:initial})).token);
    assert.equal((await db.query('select * from splash_initial_access')).rows.length,0);
  });
});
