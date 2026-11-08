const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');

test('Edge autentica el webhook y envía datos de voz sin revelar tokens en errores',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const privateKey=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const env={SPLASH_PUSH_WEBHOOK_SECRET:'test-secret',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-role',FIREBASE_PROJECT_ID:'test-project',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.com',private_key:privateKey})};
  let handler;const calls=[],logs=[];
  const context={
    Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},
    TextEncoder,Uint8Array,URLSearchParams,Response,crypto:webcrypto,btoa,atob,
    console:{error:(...args)=>logs.push(args)},
    fetch:async (url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/rpc/splash_push_event')) return Response.json({tokens:['valid-token','invalid-token'],name:'Operario prueba',time:'07:45',event_id:'one'});
      if(url.includes('oauth2')) return Response.json({access_token:'mock-access'});
      const payload=JSON.parse(options.body);
      return payload.message.token==='valid-token' ? Response.json({name:'sent'}) : Response.json({error:{status:'NOT_FOUND',details:[{errorCode:'UNREGISTERED'}]}},{status:404});
    }
  };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/splash-admin-push/index.ts','utf8')),context);
  assert.equal((await handler(new Request('https://test',{method:'POST',body:'{}'}))).status,401);
  assert.equal(calls.length,0);
  const response=await handler(new Request('https://test',{method:'POST',headers:{'x-splash-webhook-secret':'test-secret'},body:JSON.stringify({person_id:'00000000-0000-0000-0000-000000000001',work_date:'2026-10-03'})}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{sent:1});
  const fcm=calls.filter(c=>c.url.includes('fcm.googleapis.com'));
  assert.equal(fcm.length,2);
  const message=JSON.parse(fcm[0].options.body).message;
  assert.equal(message.data.kind,'attendance_voice');
  assert.equal(message.data.name,'Operario prueba');
  assert.equal(message.data.time,'07:45');
  assert.equal(message.android.priority,'high');
  assert.equal(message.android.ttl,'300s');
  assert.equal(message.notification,undefined);
  assert.match(JSON.stringify(logs),/UNREGISTERED/);
  assert.doesNotMatch(JSON.stringify(logs),/invalid-token|test-service-role|mock-access/);
});
