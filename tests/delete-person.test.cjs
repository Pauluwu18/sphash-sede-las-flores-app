const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

test('Eliminar persona requiere administrador, revoca acceso y conserva asistencias',async t=>{
  const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated;');
  await db.exec(`create schema realtime; create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select';`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
  // Simula la versión desplegada antes de agregar la opción de eliminar.
  const previous=fs.readFileSync('migrations/20260915_qr_attendance.sql','utf8')
    .replace(/    when 'delete_person' then[\s\S]*?(?=    when 'deactivate_person' then)/,'')
    .replace('from splash_private.people where deleted_at is null; return result;','from splash_private.people; return result;')
    .replace(' and deleted_at is null for update;',' for update;');
  await db.exec(previous);
  const migration=fs.readFileSync('migrations/20261004_delete_person.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  const api=async(action,payload={},token='')=>(await db.query('select public.splash_api($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),token])).rows[0].result;
  const password=(await db.query('select password from splash_initial_access')).rows[0].password;
  const admin=await api('admin_login',{username:'admin',password});
  const person=await api('save_person',{name:'Persona prueba eliminar',dni:'00112233'},admin.token);
  const qr=(await api('qr',{},admin.token)).token;
  const worker=await api('activate',{dni:'00112233',pin:'1234',qr});
  assert.ok(worker.token);
  assert.equal((await api('checkin',{qr},worker.token)).ok,true);
  const before=(await db.query('select * from public.daily_records')).rows;
  assert.equal((await api('delete_person',{id:person.id})).code,'SESSION');
  assert.ok((await api('delete_person',{id:person.id},worker.token)).error);
  assert.equal((await api('delete_person',{id:person.id},admin.token)).ok,true);
  assert.ok(!(await api('people',{},admin.token)).some(p=>p.id===person.id));
  assert.equal((await db.query('select count(*)::int as n from splash_private.checkins where person_id=$1',[person.id])).rows[0].n,1);
  assert.deepEqual((await db.query('select * from public.daily_records')).rows,before);
  assert.equal((await api('checkin',{qr},worker.token)).code,'SESSION');
  assert.ok((await api('worker_login',{dni:'00112233',pin:'1234',qr})).error);
  assert.ok((await api('save_person',{id:person.id,name:'Reactivar',dni:'00112233',active:true},admin.token)).error);
  assert.equal((await api('delete_person',{id:person.id},admin.token)).ok,true);
});
