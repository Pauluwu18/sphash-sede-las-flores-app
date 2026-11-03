const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function page(htmlFile, onApiCall) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://splash.local/' + htmlFile,
    runScripts: 'outside-only',
    resources: 'usable'
  });
  dom.window.fetch = async (url, options) => {
    if (url.includes('/rest/v1/rpc/splash_api')) {
      const body = JSON.parse(options?.body || '{}');
      const res = await onApiCall(body);
      return {
        ok: !res?.error,
        json: async () => res
      };
    }
    return { ok: false, json: async () => ({}) };
  };
  return dom;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

test('Bloqueo forzado de administración en Android Web', async (t) => {
  const adminDom = page('admin.html', async () => ({ ready: true }));
  t.after(() => adminDom.window.close());
  const aw = adminDom.window;
  const a$ = (id) => aw.document.getElementById(id);

  // Simular Android UserAgent
  Object.defineProperty(aw.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    configurable: true
  });

  // Ejecutar script inline de bloqueo de admin.html
  const scripts = aw.document.querySelectorAll('script');
  for (const s of scripts) {
    if (s.textContent && s.textContent.includes('isAndroid')) {
      aw.eval(s.textContent);
    }
  }

  assert.equal(a$('login-form').style.display, 'none', 'El formulario de login debe estar oculto en Android Web');
  assert.equal(a$('admin-android-blocked-screen').style.display, 'block', 'La pantalla de bloqueo debe estar visible');

  // Ejecutar app.js y probar submit bloqueado
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), adminDom.getInternalVMContext());
  a$('login-form').dispatchEvent(new aw.Event('submit', { cancelable: true }));
  assert.match(a$('login-message').textContent, /bloqueado en navegadores web de Android/i);
});

test('Visibilidad de tutor: oculto en login y visible en panel de operarios', async (t) => {
  const opDom = page('operarios.html', async (req) => {
    if (req.action === 'me') return { id: 'usr-1', name: 'Adriano', active: true };
    return [];
  });
  t.after(() => {
    if (opDom.window.splashTutor) opDom.window.splashTutor.destroy();
    opDom.window.close();
  });
  const ow = opDom.window;
  const o$ = (id) => ow.document.getElementById(id);

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), opDom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), opDom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('splash-tutor.js', 'utf8'), opDom.getInternalVMContext());
  await flush();

  // En pantalla de login (worker-home hidden), la burbuja debe estar oculta
  assert.equal(o$('splash-tutor-fab').style.display, 'none', 'La burbuja de ayuda debe estar oculta en el login');

  // Al iniciar sesión (simular worker-home visible)
  o$('worker-login').hidden = true;
  o$('worker-home').hidden = false;
  ow.splashTutor.syncVisibility();
  assert.equal(o$('splash-tutor-fab').style.display, 'flex', 'La burbuja de ayuda debe ser visible con sesión iniciada');

  // Verificar elementos de prevención de bug de operario
  assert.ok(o$('checkin-current-user-wrap'), 'Debe existir el contenedor del operario actual en checkin');
  assert.ok(o$('checkin-switch-user-btn'), 'Debe existir el botón ¿No eres tú? Cambiar');
  assert.equal(o$('worker-dni').getAttribute('autocomplete'), 'off');
});
