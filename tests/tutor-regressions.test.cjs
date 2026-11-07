const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tutorPage(t, { loggedIn = true } = {}) {
  const dom = new JSDOM(fs.readFileSync('operarios.html', 'utf8'), {
    url: 'https://example.com/operarios.html',
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.Response = Response;
  w.fetch = async () => new Response('[]', { status: 200 });
  w.setInterval = () => 0;
  w.cancelAnimationFrame = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  t.after(() => {
    if (w.splashTutor) w.splashTutor.destroy();
    w.dispatchEvent(new w.Event('pagehide'));
    w.close();
  });
  for (const file of ['splash-api.js', 'operarios.js', 'splash-tutor.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), dom.getInternalVMContext());
  }
  if (loggedIn) w.document.getElementById('worker-home').hidden = false;
  await flush();
  return { w, tutor: w.splashTutor, $: (id) => w.document.getElementById(id) };
}

test('Tutor: tras terminarlo una vez, volver a abrirlo no se cierra solo en el primer "Siguiente"', async (t) => {
  const { tutor, $ } = await tutorPage(t);
  tutor.startTutorial('full');
  for (let i = 0; i < 8; i++) tutor.nextStep();
  assert.match($('splash-tutor-title').textContent, /Perfecto/);
  $('splash-tutor-next-btn').click();
  assert.equal(tutor.isActive, false);

  tutor.startTutorial('full');
  $('splash-tutor-next-btn').click();
  assert.equal(tutor.isActive, true, 'sigue abierto');
  assert.match($('splash-tutor-title').textContent, /Operario/);
  assert.match($('splash-tutor-step-pill').textContent, /Paso 2 de 8/);
});

test('Tutor: los temas del menú muestran solo sus pasos y no marcan el tutorial completo', async (t) => {
  const { w, tutor, $ } = await tutorPage(t);
  tutor.openMenu();
  w.document.querySelector('[data-tutor-flow="payment"]').click();
  assert.match($('splash-tutor-step-pill').textContent, /Paso 1 de 2/);
  assert.match($('splash-tutor-title').textContent, /Monto/);
  $('splash-tutor-next-btn').click();
  assert.match($('splash-tutor-title').textContent, /Método de pago/);
  $('splash-tutor-next-btn').click();
  assert.match($('splash-tutor-title').textContent, /Listo/);
  $('splash-tutor-next-btn').click();
  assert.equal(tutor.isActive, false);
  assert.equal(w.localStorage.getItem('splash_tutor_completed'), null);

  tutor.startTutorial('attendance');
  assert.match($('splash-tutor-title').textContent, /Registrar mi asistencia/);
  assert.equal($('service-report-panel').hidden, true, 'los temas del menú principal vuelven al inicio');
  assert.equal($('worker-menu').hidden, false);
});

test('Tutor: "Anterior" salta hacia atrás los pasos ocultos y no se cuelga', async (t) => {
  const { tutor, $ } = await tutorPage(t);
  tutor.startTutorial('full');
  tutor.goToStep(4, 1);
  $('sr-photo-actions').hidden = true;
  tutor.nextStep();
  assert.match($('splash-tutor-title').textContent, /Observación/, 'salta la foto oculta hacia adelante');
  tutor.prevStep();
  assert.match($('splash-tutor-title').textContent, /Método de pago/, 'y hacia atrás sin volver a avanzar');
});

test('Tutor: si la sesión vence con el tutor abierto, se cierra y no tapa el login', async (t) => {
  const { w, tutor, $ } = await tutorPage(t);
  tutor.startTutorial('full');
  assert.equal(tutor.isActive, true);
  assert.equal(w.document.body.classList.contains('splash-tutor-running'), true);
  assert.equal($('splash-tutor-fab').style.display, 'none', 'la burbuja no tapa el diálogo');
  $('worker-home').hidden = true;
  await flush();
  assert.equal(tutor.isActive, false);
  assert.equal($('splash-tutor-stage').style.display, 'none');
  assert.equal($('splash-tutor-overlay').classList.contains('is-active'), false);
});

test('Tutor: la bienvenida aparece la primera vez que se inicia sesión, no solo al cargar la página', async (t) => {
  const { w, $ } = await tutorPage(t, { loggedIn: false });
  await sleep(1100);
  assert.equal($('splash-tutor-welcome').style.display, 'none', 'en el login no aparece');
  $('worker-home').hidden = false;
  await sleep(1100);
  assert.notEqual($('splash-tutor-welcome').style.display, 'none');
  $('splash-tutor-welcome-skip').click();
  assert.equal($('splash-tutor-welcome').style.display, 'none');
  assert.equal(w.localStorage.getItem('splash_tutor_welcome_seen'), 'true');
});

test('Tutor en pantalla chica: ancla el diálogo del lado contrario al elemento y la pantalla final queda centrada', async (t) => {
  const { w, tutor, $ } = await tutorPage(t);
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 700, configurable: true });
  let target = { top: 600, bottom: 660, left: 20, right: 370, width: 350, height: 60 };
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'splash-tutor-stage') return { top: 0, left: 10, right: 380, bottom: 300, width: 370, height: 300 };
    if (this.id === 'sr-amount-pills') return target;
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  tutor.startTutorial(['step-amount']);
  const stage = $('splash-tutor-stage');
  assert.ok(stage.classList.contains('is-compact'));
  assert.ok(stage.classList.contains('is-docked-top'), 'elemento abajo: el diálogo va arriba');
  assert.ok(!stage.classList.contains('is-docked-bottom'));

  target = { top: 90, bottom: 150, left: 20, right: 370, width: 350, height: 60 };
  tutor.startTutorial(['step-amount']);
  assert.ok(stage.classList.contains('is-docked-bottom'), 'elemento arriba: el diálogo va abajo');

  $('splash-tutor-next-btn').click();
  assert.ok(stage.classList.contains('is-finale'));
  assert.ok(!stage.classList.contains('is-docked-bottom') && !stage.classList.contains('is-docked-top'));
  assert.equal(stage.style.transform, '', 'el centrado lo hace el CSS, sin transform en línea que lo saque de pantalla');
});

test('Tutor: Escape cierra el tutor', async (t) => {
  const { w, tutor } = await tutorPage(t);
  tutor.startTutorial('full');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(tutor.isActive, false);
});

test('Tutor: el fondo oscuro lo hace el resaltado (el recuadro señalado no se atenúa) y en la pantalla final vuelve el fondo', async (t) => {
  const { w, tutor } = await tutorPage(t);
  const css = fs.readFileSync('splash-tutor.css', 'utf8');
  assert.match(css, /\.splash-tutor-running:not\(\.splash-tutor-finale\) \.splash-tutor-overlay\s*\{\s*background:\s*transparent/);
  const body = w.document.body.classList;
  tutor.startTutorial(['step-amount']);
  assert.equal(body.contains('splash-tutor-running') && !body.contains('splash-tutor-finale'), true);
  tutor.nextStep();
  assert.equal(body.contains('splash-tutor-finale'), true, 'sin resaltado, el fondo vuelve a oscurecer');
  tutor.closeTutor();
  assert.equal(body.contains('splash-tutor-running') || body.contains('splash-tutor-finale'), false);
});
