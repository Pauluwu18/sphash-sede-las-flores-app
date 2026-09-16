const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM, VirtualConsole} = require('jsdom');
const flush = async () => { for(let i=0;i<15;i++) await new Promise(resolve => setImmediate(resolve)); };

function page(file, handler) {
  const dom = new JSDOM(fs.readFileSync(file,'utf8'), {url:`https://example.com/${file}`,runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;
  w.Response=Response;
  w.fetch=async (url, options={}) => {
    const result = url.includes('/rpc/splash_api') ? await handler(JSON.parse(options.body)) : [];
    return new Response(JSON.stringify(result),{status:200});
  };
  w.setInterval=()=>0;
  w.cancelAnimationFrame=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){ this.open=true; };
  w.HTMLDialogElement.prototype.close=function(){ this.open=false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLCanvasElement.prototype.getContext=()=>({});
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.eval(fs.readFileSync('splash-api.js','utf8'));
  return dom;
}

test('Admin usa la API autenticada, rechaza nombres libres y abre perfiles', async t=>{
  const calls=[];
  const people=[{id:'00000000-0000-0000-0000-000000000001',name:'Persona registrada',dni:'00000001',type:'Operario',active:true,has_pin:true}];
  const dom=page('admin.html',request=>{
    calls.push(request);
    switch(request.action){
      case 'status':return {ready:true};
      case 'admin_login':return {token:'admin-session'};
      case 'people':return people;
      case 'records':return request.payload.date ? null : [];
      case 'person_pin':return {pin:'0123'};
      default:return {ok:true};
    }
  });
  t.after(()=>dom.window.close());
  const w=dom.window, $=id=>w.document.getElementById(id);
  vm.runInContext(fs.readFileSync('app.js','utf8'),dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('admin-qr.js','utf8'),dom.getInternalVMContext());
  $('login-user').value='admin'; $('login-password').value='test-only';
  $('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await flush();
  assert.equal($('login-screen').hidden,true);
  assert.ok(calls.some(c=>c.action==='records' && c.token==='admin-session'));
  $('person-name').value='Persona desconocida';
  $('arrival-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.match($('form-message').textContent,/Primero registra/);
  assert.equal($('arrival-list').children.length,0);
  $('person-name').value='Persona registrada';
  $('arrival-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal($('arrival-list').children.length,1);
  $('people-list').querySelector('[data-profile]').click();
  assert.equal($('profile-dialog').open,true);
  assert.equal($('profile-dni').value,'00000001');
  $('profile-pin-show').click();await flush();
  assert.equal($('profile-pin').textContent,'PIN: 0123');
  $('profile-close').click();assert.equal($('profile-pin').textContent,'');
});

test('Operario crea PIN y registra el QR al terminar el acceso', async t=>{
  const calls=[];
  const dom=page('operarios.html',request=>{
    calls.push(request);
    switch(request.action){
      case 'worker_login':return {needs_pin:true};
      case 'activate':return {token:'worker-session'};
      case 'me':return {name:'Operario de prueba',dni:'00000001'};
      case 'checkin':return {ok:true,message:'Asistencia registrada correctamente.'};
      case 'my_attendance':return [{date:'2026-09-15',time:'08:15',source:'QR',late:true}];
    }
  });
  t.after(()=>dom.window.close());
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.location.hash=`base=${'a'.repeat(64)}`;
  w.eval(fs.readFileSync('operarios.js','utf8'));
  $('worker-dni').value='00000001';
  $('worker-login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal($('pin-confirm-wrap').hidden,false);
  $('worker-pin').value='0123';$('worker-pin-confirm').value='9999';
  $('worker-login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal(calls.filter(c=>c.action==='activate').length,0);
  $('worker-pin-confirm').value='0123';
  $('worker-login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal($('worker-home').hidden,false);
  assert.equal($('attendance-result').open,true);
  assert.equal($('attendance-result-title').textContent,'Registrado');
  assert.equal(calls.filter(c=>c.action==='checkin').length,1);
  assert.equal(calls.find(c=>c.action==='checkin').token,'worker-session');
  assert.match($('checkin-message').textContent,/correctamente/);
  assert.equal($('open-history').tagName,'BUTTON');
  assert.equal($('open-checkin').tagName,'BUTTON');
  $('history-refresh').click();await flush();
  assert.match($('worker-history').textContent,/15\/09\/2026/);
  assert.match($('worker-history').textContent,/Tardanza/);
  assert.equal(w.location.hash,'');
});

test('El lector solo acepta QR de la página y del sitio correctos',()=>{
  const dom=page('operarios.html',()=>({}));
  const {Splash}=dom.window;
  assert.equal(Splash.readQR(`https://example.com/operarios.html#base=${'a'.repeat(64)}`),'a'.repeat(64));
  assert.equal(Splash.readQR(`https://other.example/operarios.html#base=${'a'.repeat(64)}`),'');
  assert.equal(Splash.readQR('javascript:alert(1)'),'');
  assert.equal(Splash.readQR('https://example.com/operarios.html#base=1234'),'');
  dom.window.close();
});

test('La página de historial reutiliza sesión y filtra por mes', async t=>{
  const calls=[];
  const dom=page('operarios.html',request=>{
    calls.push(request);
    if(request.action==='me') return {name:'Operario'};
    if(request.action==='my_attendance') return [
      {date:'2026-09-15',time:'08:15',source:'QR'},
      {date:'2026-08-10',time:'09:00',source:'Manual'}
    ];
  });
  t.after(()=>dom.window.close());
  dom.reconfigure({url:'https://example.com/operarios.html?view=history'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.eval(fs.readFileSync('operarios.js','utf8'));await flush();
  assert.equal($('worker-login').hidden,true);
  assert.equal($('worker-menu').hidden,true);
  assert.equal($('history-panel').hidden,false);
  assert.equal($('history-total').textContent,'2');
  assert.equal(calls[0].token,'shared-session');
  $('worker-month').value='2026-08';$('worker-month').dispatchEvent(new w.Event('change'));
  assert.equal($('history-total').textContent,'1');
  assert.match($('worker-history').textContent,/10\/08\/2026/);
  assert.doesNotMatch($('worker-history').textContent,/15\/09\/2026/);
  $('history-all').click();assert.equal($('history-total').textContent,'2');
  w.dispatchEvent(new w.StorageEvent('storage',{key:'splash-worker-session',newValue:null}));
  assert.equal($('worker-home').hidden,true);
  assert.equal($('worker-history').children.length,0);
});

test('El historial marca tardanza QR desde las 07:45 aunque sea un registro anterior', async t=>{
  const dom=page('operarios.html',request=>{
    if(request.action==='me') return {name:'Operario'};
    if(request.action==='my_attendance') return [{date:'2026-09-15',time:'07:45',source:'QR',late:false}];
  });
  t.after(()=>dom.window.close());
  dom.reconfigure({url:'https://example.com/operarios.html?view=history'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.eval(fs.readFileSync('operarios.js','utf8')); await flush();
  const status=$('worker-history').querySelector('.attendance-status');
  assert.equal(status.textContent,'Tardanza');
  assert.ok(status.classList.contains('is-late'));
});

test('La página de escaneo abre cámara y permite reintentar si se deniega', async t=>{
  const dom=page('operarios.html',()=>({name:'Operario'}));
  t.after(()=>dom.window.close());
  dom.reconfigure({url:'https://example.com/operarios.html?view=scan'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  let attempts=0;
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{
    attempts++;const error=new Error('Denied');error.name='NotAllowedError';throw error;
  }}});
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.eval(fs.readFileSync('operarios.js','utf8'));await flush();
  assert.equal(attempts,0);
  $('start-camera').click();await flush();
  assert.equal(attempts,1);
  assert.equal($('camera-help').open,true);
  assert.equal($('scanner-viewport').dataset.state,'error');
  assert.equal($('checkin-panel').hidden,false);
  assert.equal($('worker-menu').hidden,true);
  assert.match($('checkin-message').textContent,/Permite el acceso/);
  assert.equal($('start-camera').disabled,false);
  $('start-camera').click();await flush();assert.equal(attempts,2);
});

test('La entrada principal lleva al operario y conserva enlaces QR',()=>{
  const html=fs.readFileSync('index.html','utf8');
  let destination;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{location:{search:'?view=scan',hash:'#base=abc',replace:value=>{destination=value;}}});
  assert.equal(destination,'operarios.html?view=scan#base=abc');
  const dom=page('operarios.html',()=>({}));
  const link=dom.window.document.querySelector('.portal-link');
  assert.equal(link.getAttribute('href'),'admin.html');
  assert.equal(link.textContent,'Entrar como administrador');
  dom.window.close();
});

test('Una cámara sin respuesta permite reintentar y libera permisos tardíos', async t=>{
  const dom=page('operarios.html',()=>({name:'Operario'}));
  t.after(()=>dom.window.close());
  dom.reconfigure({url:'https://example.com/operarios.html?view=scan'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  let resolveCamera, expire, stopped=0;
  const realTimer=w.setTimeout.bind(w);
  w.setTimeout=(callback,ms)=>ms===15000 ? (expire=callback,123) : realTimer(callback,ms);
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{resolveCamera=resolve;})}});
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.eval(fs.readFileSync('operarios.js','utf8'));await flush();
  $('start-camera').click();
  assert.equal($('scanner-viewport').dataset.state,'pending');
  assert.equal($('start-camera').disabled,true);
  expire();
  assert.equal($('start-camera').disabled,false);
  assert.match($('checkin-message').textContent,/no respondió/);
  resolveCamera({getTracks:()=>[{stop(){stopped++;}}]});await flush();
  assert.equal(stopped,1);
  assert.equal($('qr-video').hidden,true);
});

test('Una foto QR válida registra automáticamente', async t=>{
  const calls=[];
  const dom=page('operarios.html',request=>{calls.push(request);return request.action==='checkin' ? {ok:true,message:'Registrado'} : {name:'Operario'};});
  t.after(()=>dom.window.close());
  dom.reconfigure({url:'https://example.com/operarios.html?view=scan'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16)})});
  w.URL.createObjectURL=()=> 'blob:test-photo';w.URL.revokeObjectURL=()=>{};
  w.Image=class {naturalWidth=2;naturalHeight=2;set src(value){queueMicrotask(()=>this.onload());}};
  w.jsQR=()=>({data:`https://example.com/operarios.html#base=${'a'.repeat(64)}`});
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.eval(fs.readFileSync('operarios.js','utf8'));await flush();
  Object.defineProperty($('qr-photo'),'files',{value:[new w.File(['test'],'qr.png',{type:'image/png'})]});
  $('qr-photo').dispatchEvent(new w.Event('change'));await flush();
  assert.equal($('confirm-checkin').hidden,true);
  assert.equal($('attendance-result').open,true);
  assert.equal(calls.filter(call=>call.action==='checkin').length,1);
});

test('El aviso y la campana esperan al servidor; el error permite reintentar', async t=>{
  let finish, attempts=0, sounds=0;
  const dom=page('operarios.html',request=>{
    if(request.action==='me') return {name:'Operario'};
    if(request.action==='checkin') { attempts++; return new Promise(resolve=>{finish=resolve;}); }
  });
  t.after(()=>dom.window.close());
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.AudioContext=class {
    state='running';currentTime=0;destination={};
    createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){sounds++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  };
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.location.hash=`base=${'a'.repeat(64)}`;
  w.eval(fs.readFileSync('operarios.js','utf8'));
  w.document.dispatchEvent(new w.Event('pointerdown'));await flush();
  assert.equal(attempts,1);assert.equal(sounds,0);assert.equal($('attendance-result').open,false);
  finish({error:'Sin conexión'});await flush();
  assert.equal($('attendance-result').open,false);assert.equal(sounds,0);
  assert.equal($('confirm-checkin').hidden,false);
  $('confirm-checkin').click();await flush();finish({ok:true,message:'Guardado'});await flush();
  assert.equal(attempts,2);assert.equal($('attendance-result').open,true);assert.equal(sounds,3);
});

test('Una asistencia repetida muestra un aviso distinto sin registrarla otra vez', async t=>{
  const dom=page('operarios.html',request=>request.action==='me'?{name:'Operario'}:{already:true,message:'Ya registrada'});
  t.after(()=>dom.window.close());
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.localStorage.setItem('splash-worker-session','shared-session');
  w.location.hash=`base=${'a'.repeat(64)}`;
  w.eval(fs.readFileSync('operarios.js','utf8'));await flush();
  assert.equal($('attendance-result-title').textContent,'Ya registrada');
  assert.equal($('attendance-result').open,true);
});

test('El QR generado puede decodificarse con el lector incluido',()=>{
  const dom=page('operarios.html',()=>({}));
  const w=dom.window;
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},fillRect(){},strokeRect(){}});
  w.eval(fs.readFileSync('vendor/qrcode.min.js','utf8'));
  const url=`https://example.com/operarios.html#base=${'a'.repeat(64)}`;
  const qr=new w.QRCode(w.document.createElement('div'),{text:url,width:280,height:280,correctLevel:w.QRCode.CorrectLevel.M});
  const count=qr._oQRCode.getModuleCount(), scale=8, border=4;
  const size=(count+border*2)*scale;
  const pixels=new Uint8ClampedArray(size*size*4).fill(255);
  for(let row=0;row<count;row++) for(let col=0;col<count;col++) if(qr._oQRCode.isDark(row,col)) {
    for(let y=0;y<scale;y++) for(let x=0;x<scale;x++) {
      const offset=(((row+border)*scale+y)*size+(col+border)*scale+x)*4;
      pixels[offset]=pixels[offset+1]=pixels[offset+2]=0;
    }
  }
  const decode=require('../vendor/jsQR.js');
  assert.equal(decode(pixels,size,size).data,url);
  dom.window.close();
});
