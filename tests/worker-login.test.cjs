const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
};

async function loginPage(t, respond) {
  const dom = new JSDOM(fs.readFileSync('operarios.html', 'utf8'), {
    url: 'https://example.com/operarios.html',
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  const calls = [];
  w.Response = Response;
  w.fetch = async (url, options = {}) => {
    if (!String(url).includes('/rpc/splash_api')) return new Response('[]', { status: 200 });
    const body = JSON.parse(options.body);
    calls.push(body);
    const result = await respond(body);
    return new Response(JSON.stringify(result), { status: 200 });
  };
  w.setInterval = () => 0;
  w.cancelAnimationFrame = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  for (const file of ['splash-api.js', 'operarios.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), dom.getInternalVMContext());
  await flush();
  const $ = (id) => w.document.getElementById(id);
  const submit = async (dni, pin, confirm) => {
    $('worker-dni').value = dni;
    $('worker-pin').value = pin;
    if (confirm !== undefined) $('worker-pin-confirm').value = confirm;
    $('worker-login-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await flush();
  };
  return { w, $, calls, submit };
}

test('Login operario: el formulario no bloquea el envío en silencio', async (t) => {
  const { $ } = await loginPage(t, () => ({ error: 'x' }));
  assert.equal($('worker-login-form').noValidate, true, 'sin novalidate, el navegador frena el envío sin mostrar nada en la app Android');
});

test('Login operario: el DNI pegado con espacios, puntos o guiones se normaliza y se envía', async (t) => {
  const { calls, submit } = await loginPage(t, (body) => (body.action === 'worker_login' ? { error: 'DNI o PIN incorrectos.' } : {}));
  await submit(' 1234 5678 ', '1234');
  await submit('1234-5678', '1234');
  const logins = calls.filter((c) => c.action === 'worker_login');
  assert.equal(logins.length, 2);
  assert.ok(logins.every((c) => c.payload.dni === '12345678'));
});

test('Login operario: DNI o PIN con formato incorrecto muestran el motivo y no llegan al servidor', async (t) => {
  const { $, calls, submit } = await loginPage(t, () => ({ error: 'x' }));
  await submit('1234567', '1234');
  assert.match($('worker-login-message').textContent, /DNI debe tener 8 números/);
  await submit('12345678', 'abcd12');
  assert.match($('worker-login-message').textContent, /PIN son 4 números/);
  assert.match($('worker-login-message').textContent, /primera vez/);
  assert.equal(calls.filter((c) => c.action === 'worker_login').length, 0);
});

test('Login operario: en el primer ingreso avisa que hay que crear el PIN y pide repetirlo', async (t) => {
  const { $, calls, submit } = await loginPage(t, (body) => {
    if (body.action === 'worker_login') return { needs_pin: true };
    if (body.action === 'activate') return { token: 'tok', name: 'Adriano' };
    if (body.action === 'me') return { name: 'Adriano' };
    return {};
  });
  await submit('12345678', '4821');
  assert.equal($('pin-confirm-wrap').hidden, false);
  assert.match($('worker-login-message').textContent, /primer ingreso/);
  assert.match($('worker-login-message').textContent, /repite tu PIN/);
  assert.equal($('worker-pin').value, '4821', 'conserva el PIN escrito');
  assert.equal($('worker-submit').textContent, 'Crear PIN e ingresar');

  await submit('12345678', '4821', '9999');
  assert.match($('worker-login-message').textContent, /mismo PIN/);
  await submit('12345678', '4821', '4821');
  assert.ok(calls.some((c) => c.action === 'activate' && c.payload.pin === '4821'));
  assert.equal($('worker-home').hidden, false, 'entra a la app');
});

test('Login operario: sin PIN escrito en el primer ingreso pide crear uno', async (t) => {
  const { $, submit } = await loginPage(t, (body) => (body.action === 'worker_login' ? { needs_pin: true } : {}));
  await submit('12345678', '');
  assert.match($('worker-login-message').textContent, /crea un PIN de 4 números/);
});

test('Login operario: los mensajes del servidor se muestran tal cual y sin internet se explica', async (t) => {
  const { w, $, submit } = await loginPage(t, () => ({ error: 'Demasiados intentos. Espera 15 minutos.' }));
  await submit('12345678', '1234');
  assert.match($('worker-login-message').textContent, /Demasiados intentos/);

  w.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await submit('12345678', '1234');
  assert.match($('worker-login-message').textContent, /No se pudo conectar con el servidor/);
  assert.equal($('worker-submit').disabled, false, 'el botón queda disponible para reintentar');
});
