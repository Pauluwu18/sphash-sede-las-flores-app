const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

test('solo sesiones admin reciben avisos por cada registro QR nuevo', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema realtime;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'select null::void';
    create schema vault;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    insert into vault.decrypted_secrets values('splash_push_webhook_secret','test-secret');
    create schema net;
    create table net.requests(url text, body jsonb, headers jsonb);
    create function net.http_post(url text, body jsonb default '{}'::jsonb,
      params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
      timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
      begin insert into net.requests values(url,body,headers); return 1; end $$;`);
  await db.exec(fs.readFileSync('supabase-schema.sql', 'utf8'));
  await db.exec(fs.readFileSync('migrations/20260915_qr_attendance.sql', 'utf8'));
  await db.exec(fs.readFileSync('migrations/20260916_admin_push.sql', 'utf8'));
  const initial = (await db.query('select password from splash_initial_access')).rows[0].password;
  const api = async (action, payload = {}, token = '') =>
    (await db.query('select public.splash_api($1,$2::jsonb,$3) result',
      [action, JSON.stringify(payload), token])).rows[0].result;
  const register = async (action, session, device) =>
    (await db.query('select public.splash_push_registration($1,$2,$3) result',
      [action, session, device])).rows[0].result;
  const admin = await api('admin_login', { username: 'admin', password: initial });
  const qr = (await api('qr', {}, admin.token)).token;
  const personId = (await api('save_person', { name: 'Operario aviso', dni: '00000999' }, admin.token)).id;
  const worker = await api('activate', { dni: '00000999', pin: '0123', qr });
  const device = 'sample-fcm-device-token-for-admin-only-12345';

  assert.equal((await register('register', worker.token, device)).code, 'SESSION');
  assert.equal((await register('register', '', device)).code, 'SESSION');
  assert.equal((await register('register', admin.token, device)).ok, true);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from splash_private.admin_push_devices'), /permission denied/);
  await assert.rejects(db.query("select public.splash_push_event('00000000-0000-0000-0000-000000000000'::uuid,current_date)"), /permission denied/);
  await db.exec('reset role');

  assert.equal((await api('checkin', { qr }, worker.token)).ok, true);
  assert.equal((await api('checkin', { qr }, worker.token)).already, true);
  const requests = (await db.query('select body from net.requests')).rows;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.person_id, personId);

  await db.exec('set role service_role');
  const event = (await db.query('select public.splash_push_event($1,$2::date) result',
    [personId, requests[0].body.work_date])).rows[0].result;
  await db.exec('reset role');
  assert.deepEqual(event.tokens, [device]);
  assert.match(event.time, /^\d{2}:\d{2}$/);

  await api('logout', {}, admin.token);
  assert.equal((await db.query('select count(*)::int n from splash_private.admin_push_devices')).rows[0].n, 0);
});
