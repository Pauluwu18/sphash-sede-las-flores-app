const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');

const flush=async()=>{for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));};
function page(file,handler,url){
  const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url:url||`https://example.com/${file}`,runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;
  w.Response=Response;
  w.fetch=async(u,o={})=>new Response(JSON.stringify(await handler(u,o.body?JSON.parse(o.body):null)),{status:200});
  w.setInterval=()=>0;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  return dom;
}
const run=(dom,f)=>vm.runInContext(fs.readFileSync(f,'utf8'),dom.getInternalVMContext());

const pendingData={ok:true,date:'2026-11-08',uploaded_at:'2026-11-08T14:00:00Z',unassigned:1,total_pending:3,operators:[
  {operator:'JOSUÉ ARAMIS SOTO',person_id:'p1',person_name:'Aramis',linked:true,agenda:2,reported:1,pending:1,services:[{slot:'MAÑANA',client:'X',district:'ATE',amount:130,extra:0,payment_method:'Efectivo'}]},
  {operator:'LIONEL MATÍAS ROJAS',person_id:null,person_name:null,linked:false,agenda:2,reported:0,pending:2,services:[]},
  {operator:'FABRIZIO CRUZ',person_id:'p3',person_name:'Fabrizio',linked:true,agenda:1,reported:1,pending:0,services:[]}]};

test('Servicios pendientes (admin): tabla con alertas, insignia y vínculo de un operario sin vincular',async t=>{
  const calls=[];
  const dom=page('admin.html',(url,body)=>{calls.push({url,body});
    if(url.includes('splash_agenda_pending'))return pendingData;
    if(url.includes('splash_agenda_link'))return{ok:true};
    if(url.includes('splash_api'))return body.action==='people'?[{id:'p1',name:'Aramis',active:true},{id:'p2',name:'Lionel Rojas',active:true}]:{ok:true};
    return{ok:true};});
  t.after(()=>dom.window.close());
  const w=dom.window;w.sessionStorage.setItem('splash-admin-session','tok-admin');
  for(const f of ['splash-api.js','agenda-admin.js'])run(dom,f);
  const $=id=>w.document.getElementById(id);
  $('agenda-pending-button').click();await flush();
  assert.equal($('agenda-pending-dialog').open,true);
  const rows=$('agenda-table').querySelectorAll('tbody tr');
  assert.equal(rows.length,3);
  assert.match(rows[0].textContent,/Lionel/,'primero el que tiene más pendientes');
  assert.match(rows[0].textContent,/⚠ 2/);assert.match(rows[2].textContent,/✓ 0/);
  assert.equal($('agenda-pending-badge').hidden,false);assert.equal($('agenda-pending-badge').textContent,'3');
  assert.match($('agenda-summary').textContent,/3 pendientes.*1 servicio sin operario/);
  const select=$('agenda-table').querySelector('[data-link-select]');
  assert.ok(select,'solo el operario sin vincular ofrece vincular');
  select.value='p2';
  $('agenda-table').querySelector('[data-link-button]').click();await flush();
  const link=calls.find(c=>c.url.includes('splash_agenda_link'));
  assert.deepEqual({...link.body},{session_token:'tok-admin',agenda_label:'LIONEL MATÍAS ROJAS',target_person:'p2'});
});

test('Operario: aviso de servicios pendientes con botón para reportar',async t=>{
  const dom=page('operarios.html',url=>url.includes('splash_worker_pending')?{ok:true,date:'2026-11-08',agenda:3,reported:1,pending:2,services:[{district:'ATE'},{district:'LINCE'}]}:{ok:true});
  t.after(()=>dom.window.close());
  const w=dom.window;w.localStorage.setItem('splash-worker-session','tok');
  const notes=[];w.Notification=function(title,opts){notes.push({title,opts});};w.Notification.permission='granted';
  w.document.getElementById('worker-home').hidden=false;Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  for(const f of ['splash-api.js','pendientes-operario.js'])run(dom,f);
  w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();
  const $=id=>w.document.getElementById(id);
  assert.equal($('pending-banner').hidden,false);
  assert.match($('pending-banner-title').textContent,/2 servicios pendientes/);
  assert.match($('pending-banner-text').textContent,/ATE, LINCE/);
  assert.equal(notes.length,1);assert.match(notes[0].opts.body,/2 servicios/);
  let clicked=false;$('open-service-report').addEventListener('click',()=>{clicked=true;});
  $('pending-banner-action').click();assert.equal(clicked,true);
});

test('Operario: sin pendientes el aviso queda oculto',async t=>{
  const dom=page('operarios.html',url=>url.includes('splash_worker_pending')?{ok:true,date:'2026-11-08',agenda:2,reported:2,pending:0,services:[]}:{ok:true});
  t.after(()=>dom.window.close());
  const w=dom.window;w.localStorage.setItem('splash-worker-session','tok');w.document.getElementById('worker-home').hidden=false;Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  for(const f of ['splash-api.js','pendientes-operario.js'])run(dom,f);
  w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();
  assert.equal(w.document.getElementById('pending-banner').hidden,true);
});

test('QR de asistencia en el navegador de Android sin la app: ofrece descargar e instalar',async t=>{
  const qr='a'.repeat(64);
  const android=(extra)=>{const dom=page('operarios.html',()=>({ok:true}),`https://example.com/operarios.html#base=${qr}`);
    Object.defineProperty(dom.window.navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 13) Chrome/120',configurable:true});
    if(extra)extra(dom.window);t.after(()=>dom.window.close());run(dom,'instalar-app.js');return dom.window.document;};
  const doc=android();
  assert.ok(doc.getElementById('install-app-gate'),'aparece la pantalla de instalación');
  assert.match(doc.getElementById('install-app-download').href,/SPLASH-Operarios\.apk$/);
  assert.match(doc.getElementById('install-app-open').href,/^intent:#Intent;package=pe\.splash\.lasflores/);
  doc.getElementById('install-app-skip').click();
  assert.equal(doc.getElementById('install-app-gate'),null,'se puede continuar en el navegador');
  assert.equal(android(w=>{w.SplashAndroid={};}).getElementById('install-app-gate'),null,'dentro de la app no aparece');
  const pc=page('operarios.html',()=>({ok:true}),`https://example.com/operarios.html#base=${qr}`);t.after(()=>pc.window.close());
  run(pc,'instalar-app.js');assert.equal(pc.window.document.getElementById('install-app-gate'),null,'en computadora no aparece');
  const noQr=page('operarios.html',()=>({ok:true}));t.after(()=>noQr.window.close());
  Object.defineProperty(noQr.window.navigator,'userAgent',{value:'Android Chrome',configurable:true});
  run(noQr,'instalar-app.js');assert.equal(noQr.window.document.getElementById('install-app-gate'),null,'sin QR no aparece');
});

test('Extensión: el gancho detecta el Excel que descarga la página',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://splashapp.net.pe/agenda',runScripts:'outside-only'});
  const w=dom.window;const got=[];
  w.addEventListener('message',e=>{if(e.data&&e.data.source==='splash-agenda-hook')got.push(e.data);});
  w.URL.createObjectURL=()=>'blob:x';
  w.Blob.prototype.arrayBuffer=function(){return Promise.resolve(new ArrayBuffer(8));};
  vm.runInContext(fs.readFileSync('extension-agenda/content-hook.js','utf8'),dom.getInternalVMContext());
  w.URL.createObjectURL(new w.Blob(['x'.repeat(10)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  w.URL.createObjectURL(new w.Blob(['hola'],{type:'text/plain'}));
  await flush();
  assert.equal(got.length,1,'solo el Excel se reenvía, no otros archivos');
  assert.equal(got[0].origin,'blob');
});

test('Extensión: inicia sesión sin guardar la contraseña, sube con el token y cierra la sesión si vence',async()=>{
  const store={};const calls=[];
  const chrome={storage:{local:{get:async k=>({[k]:store[k]}),set:async o=>Object.assign(store,o),remove:async k=>{delete store[k];}}},runtime:{onMessage:{addListener:fn=>{chrome.handler=fn;}}}};
  let reply;
  const ctx=vm.createContext({chrome,self:{},importScripts(){ctx.self.SPLASH_CONFIG={url:'https://x.supabase.co',key:'anon'};},fetch:async(url,o)=>{
    const body=JSON.parse(o.body);calls.push({url,body});
    if(url.includes('splash_api'))return new Response(JSON.stringify({token:'T123'}));
    if(url.includes('splash_agenda_upload'))return new Response(JSON.stringify(reply));
    return new Response('{}');},Date,JSON,Response,console});
  vm.runInContext(fs.readFileSync('extension-agenda/background.js','utf8'),ctx);
  const ask=m=>new Promise(res=>chrome.handler(m,{},res));
  assert.equal((await ask({type:'upload',payload:{}})).code,'NO_SESSION','sin sesión no sube');
  assert.equal((await ask({type:'login',username:'admin',password:'secreto'})).ok,true);
  assert.equal(JSON.stringify(store).includes('secreto'),false,'la contraseña no se guarda');
  assert.equal(store.session.token,'T123');
  reply={ok:true,date:'2026-11-08',count:6,unlinked:[]};
  const up=await ask({type:'upload',payload:{date:'2026-11-08',services:[]}});
  assert.equal(up.count,6);assert.equal(calls.at(-1).body.session_token,'T123');
  assert.equal(store.last.count,6);
  reply={error:'venció',code:'SESSION'};
  assert.equal((await ask({type:'upload',payload:{date:'2026-11-08',services:[]}})).code,'SESSION');
  assert.equal(store.session,undefined,'una sesión vencida se descarta');
});
