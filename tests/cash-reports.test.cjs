const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => {
  for (let i = 0; i < 15; i++) await new Promise((resolve) => setImmediate(resolve));
};

function page(file, handler) {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    url: `https://example.com/${file}`,
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.Response = Response;
  w.fetch = async (url, options = {}) => {
    const result = url.includes('/rpc/splash_api') ? await handler(JSON.parse(options.body)) : [];
    return new Response(JSON.stringify(result), { status: 200 });
  };
  w.setInterval = () => 0;
  w.cancelAnimationFrame = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  return dom;
}

test('Reportes de caja: apertura de modal, registro de entradas y salidas con formato exacto', async (t) => {
  const dom = page('admin.html', () => ({ ok: true }));
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  // 1. Abrir modal desde el botón del menú
  assert.ok($('cash-reports-button'), 'El botón de reportes de caja debe existir en el menú');
  $('cash-reports-button').click();
  await flush();
  assert.equal($('cash-reports-dialog').open, true, 'El diálogo de reportes de caja debe abrirse');

  // 2. Registrar ENTRADA (ejemplo del usuario: ENTRADA S/120 ADRIANO - *primer servicio*)
  const typeEntrada = w.document.querySelector('input[name="cash-type"][value="ENTRADA"]');
  typeEntrada.checked = true;
  $('cash-amount').value = '120';
  $('cash-operator').value = 'ADRIANO';
  $('cash-concept').value = 'primer servicio';
  $('cash-movement-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  // 3. Registrar SALIDA con N. Operario y servicio (ejemplo: SALIDA S/30 3. RAUL - servicio 1)
  const typeSalida = w.document.querySelector('input[name="cash-type"][value="SALIDA"]');
  typeSalida.checked = true;
  $('cash-amount').value = '30';
  $('cash-operator').value = '3. RAUL';
  $('cash-concept').value = 'servicio 1';
  $('cash-movement-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  // 4. Registrar SALIDA con sueldo / personalizado (ejemplo: SALIDA S/50 - Sueldo 3. RAUL)
  $('cash-amount').value = '50';
  $('cash-operator').value = '3. RAUL';
  $('cash-concept').value = 'Sueldo';
  $('cash-movement-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  // 5. Registrar SALIDA libre sin operario (ejemplo: compra de insumos)
  $('cash-amount').value = '20';
  $('cash-operator').value = '';
  $('cash-concept').value = 'compra de insumos';
  $('cash-movement-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  // Verificar totales
  // Entradas: 120
  // Salidas: 30 + 50 + 20 = 100
  // Saldo: 20
  assert.equal($('cash-total-income').textContent, 'S/ 120.00');
  assert.equal($('cash-total-expense').textContent, 'S/ 100.00');
  assert.equal($('cash-balance').textContent, 'S/ 20.00');

  // Verificar formato del reporte generado
  const reportText = $('cash-report-preview').textContent;
  assert.match(reportText, /ENTRADA S\/120 ADRIANO\s*\n\*primer servicio\*/);
  assert.match(reportText, /SALIDA S\/30 3\. RAUL\s*\nservicio 1/);
  assert.match(reportText, /SALIDA S\/50\s*\nSueldo 3\. RAUL/);
  assert.match(reportText, /SALIDA S\/20\s*\ncompra de insumos/);
  assert.match(reportText, /\*TOTAL ENTRADAS:\* S\/ 120\.00/);
  assert.match(reportText, /\*TOTAL SALIDAS:\*  S\/ 100\.00/);
  assert.match(reportText, /\*SALDO EN CAJA:\*  S\/ 20\.00/);

  // 6. Eliminar un movimiento y verificar recálculo
  const delBtn = w.document.querySelector('[data-cash-del="3"]'); // borrar compra de insumos (20)
  assert.ok(delBtn);
  delBtn.click();
  await flush();

  assert.equal($('cash-total-expense').textContent, 'S/ 80.00');
  assert.equal($('cash-balance').textContent, 'S/ 40.00');

  // 7. Cerrar modal
  $('cash-reports-close').click();
  assert.equal($('cash-reports-dialog').open, false);
});
