const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => { for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve)); };

function page(file, handler) {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { url: `https://example.com/${file}`, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.Response = Response;
  w.fetch = async (url, options = {}) => new Response(JSON.stringify(await handler(url, options.body ? JSON.parse(options.body) : null)), { status: 200 });
  w.setInterval = () => 0;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  return dom;
}
const run = (dom, file) => vm.runInContext(fs.readFileSync(file, 'utf8'), dom.getInternalVMContext());

test('Mi semana: muestra servicios, pago por servicio, total y las dos gráficas', async (t) => {
  const calls = [];
  const dom = page('operarios.html', (url, body) => {
    calls.push({ url, body });
    if (url.includes('splash_worker_week')) {
      return {
        ok: true, name: 'Yerson', week_start: '2026-11-02', week_end: '2026-11-08', rate: 40, services: 3, total: 120,
        days: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map((date, i) => ({ date, services: i === 3 ? 2 : i === 5 ? 1 : 0 })),
        history: [0, 1, 2, 3, 4, 5].map((i) => ({ week_start: `2026-10-${String(5 + i * 7 > 31 ? 5 : 5 + i * 7).padStart(2, '0')}`, services: i, total: i * 40 }))
      };
    }
    return { ok: true };
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.localStorage.setItem('splash-worker-session', 'token-operario');
  for (const f of ['splash-api.js', 'splash-charts.js', 'semana-operario.js']) run(dom, f);
  const $ = (id) => w.document.getElementById(id);
  $('open-week').click();
  await flush();
  assert.equal($('week-panel').hidden, false);
  assert.equal($('worker-menu').hidden, true);
  assert.equal($('week-services').textContent, '3');
  assert.match($('week-rate').textContent, /S\/ 40/);
  assert.match($('week-total').textContent, /S\/ 120/);
  assert.equal($('week-chart-days').querySelectorAll('svg path').length, 2, 'dos días con servicios dibujan barra');
  assert.ok($('week-chart-history').querySelector('svg[role="img"]'));
  assert.equal($('week-table').querySelectorAll('tbody tr').length, 7, 'la tabla acompaña a la gráfica');
  assert.equal($('week-next').disabled, true, 'no se avanza más allá de esta semana');
  assert.equal(calls[0].body.session_token, 'token-operario');
  $('week-prev').click();
  await flush();
  assert.equal(calls[1].body.week_start, '2026-10-26', 'la flecha retrocede una semana');
});

test('Pagos por servicio (admin): lista, gráfica, total y guarda el pago editado', async (t) => {
  let rate = 30;
  const calls = [];
  const dom = page('admin.html', (url, body) => {
    calls.push({ url, body });
    if (url.includes('splash_admin_week')) {
      return { ok: true, week_start: '2026-11-02', week_end: '2026-11-08', people: [
        { id: 'a1', name: 'Aramis', rate, services: 2, total: 2 * rate, days: [0, 0, 0, 1, 0, 1, 0] },
        { id: 'y1', name: 'Yerson', rate: 40, services: 3, total: 120, days: [0, 0, 0, 2, 0, 1, 0] }
      ] };
    }
    if (url.includes('splash_set_service_rate')) { rate = body.rate; return { ok: true, id: body.person_id, rate: body.rate }; }
    return { ok: true };
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.sessionStorage.setItem('splash-admin-session', 'token-admin');
  for (const f of ['splash-api.js', 'splash-charts.js', 'pagos-admin.js']) run(dom, f);
  const $ = (id) => w.document.getElementById(id);
  $('pay-week-button').click();
  await flush();
  assert.equal($('pay-week-dialog').open, true);
  assert.equal($('pay-week-table').querySelectorAll('tbody tr').length, 2);
  assert.match($('pay-week-table').querySelector('tfoot').textContent, /5.*S\/ 180/s, 'suma servicios y total (60 + 120)');
  assert.equal($('pay-week-chart').querySelectorAll('svg rect').length >= 2, true);

  const input = $('pay-week-table').querySelector('[data-rate="a1"]');
  input.value = '35';
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush();
  const save = calls.find((c) => c.url.includes('splash_set_service_rate'));
  assert.deepEqual({ ...save.body }, { session_token: 'token-admin', person_id: 'a1', rate: 35 });
  assert.match($('pay-week-message').textContent, /35/);
  assert.match($('pay-week-table').querySelector('[data-total="a1"]').textContent, /S\/ 70/);
});
