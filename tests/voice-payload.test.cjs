const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');

test('FCM conserva notificación antigua y envía voz solo a APK compatible', async () => {
  let handler;
  const sent = [];
  const secrets = {
    SPLASH_PUSH_WEBHOOK_SECRET:'test-hook', SUPABASE_URL:'https://test.example',
    SUPABASE_SERVICE_ROLE_KEY:'test-service', FIREBASE_PROJECT_ID:'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.com',private_key:'AA=='}),
  };
  const context = {
    TextEncoder, Uint8Array, Response, URLSearchParams, btoa, atob, console,
    crypto:{subtle:{importKey:async()=>({}), sign:async()=>new Uint8Array([1])}},
    Deno:{env:{get:key=>secrets[key]},serve:fn=>handler=fn},
    fetch:async (url, options) => {
      if(url.endsWith('/splash_push_event')) return Response.json({
        tokens:['legacy','voice'],voice_tokens:['voice'],name:'Adriano',
        time:'00:00',event_id:'event-one',
      });
      if(url.includes('oauth2')) return Response.json({access_token:'test-access'});
      sent.push(JSON.parse(options.body).message);
      return Response.json({name:'accepted'});
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/splash-admin-push/index.ts','utf8')),context);
  const response = await handler(new Request('https://test.example', {
    method:'POST',headers:{'x-splash-webhook-secret':'test-hook'},
    body:JSON.stringify({person_id:'00000000-0000-0000-0000-000000000001',work_date:'2026-09-28'}),
  }));
  assert.equal(response.status,200);
  assert.equal((await response.json()).sent,2);
  assert.ok(sent[0].notification);
  assert.equal(sent[0].android.notification.default_sound,true);
  assert.equal(sent[0].data,undefined);
  assert.equal(sent[1].notification,undefined, 'No notification payload: Android debe ejecutar el receptor con app cerrada');
  assert.equal(sent[1].data.name,'Adriano');
  assert.equal(sent[1].data.time,'00:00');
  assert.equal(sent[1].android.priority,'high');
  assert.equal(sent[1].android.ttl,'60s');
});
