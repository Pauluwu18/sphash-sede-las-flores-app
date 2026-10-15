const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
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
    if (url.startsWith('data:image')) {
      return new Response(Buffer.from('fake-image-bytes'), { status: 200 });
    }
    const result = url.includes('/rpc/splash_api') ? await handler(JSON.parse(options.body)) : [];
    return new Response(JSON.stringify(result), { status: 200 });
  };
  w.setInterval = () => 0;
  w.cancelAnimationFrame = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
    fillText() {}
  });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,stamped-fake-image';

  class MockFileReader {
    readAsDataURL() {
      setImmediate(() => {
        this.result = 'data:image/jpeg;base64,mockrawphoto';
        if (this.onload) this.onload({ target: this });
      });
    }
  }
  w.FileReader = MockFileReader;

  class MockImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
    set src(val) {
      this._src = val;
      setImmediate(() => { if (this.onload) this.onload(); });
    }
    get src() { return this._src; }
  }
  w.Image = MockImage;

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
  const delBtn = w.document.querySelector('[data-cash-del="3"]');
  assert.ok(delBtn);
  delBtn.click();
  await flush();

  assert.equal($('cash-total-expense').textContent, 'S/ 80.00');
  assert.equal($('cash-balance').textContent, 'S/ 40.00');

  // 7. Cerrar modal
  $('cash-reports-close').click();
  assert.equal($('cash-reports-dialog').open, false);
});

test('Foto de billete: captura, sellado de datos, vista previa y envío a WhatsApp', async (t) => {
  let sharedData = null;
  const dom = page('admin.html', () => ({ ok: true }));
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  // Mock navigator.share
  w.navigator.canShare = (data) => Boolean(data && data.files);
  w.navigator.share = async (data) => { sharedData = data; };

  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  $('cash-reports-button').click();
  await flush();

  // Simular foto de billete
  $('cash-amount').value = '120';
  $('cash-operator').value = 'ADRIANO';
  $('cash-concept').value = 'primer servicio';

  // Asignar archivo al input de foto
  const fakeFile = new w.File(['fake-photo-bits'], 'billete.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('cash-photo-input'), 'files', { value: [fakeFile] });
  $('cash-photo-input').dispatchEvent(new w.Event('change'));
  await flush();

  // Guardar y enviar por WhatsApp
  assert.ok($('cash-submit-whatsapp-btn'));
  $('cash-submit-whatsapp-btn').click();
  await flush();

  // Verificar que se guardó el movimiento con foto
  const thumb = w.document.querySelector('[data-cash-view-photo="0"]');
  assert.ok(thumb, 'Debe renderizar la miniatura de la foto');

  // Abrir modal de foto
  thumb.click();
  await flush();
  assert.equal($('cash-photo-modal').open, true, 'Debe abrir el modal de foto');
  assert.match($('cash-photo-modal-caption').textContent, /ENTRADA S\/120 ADRIANO/);

  // Cerrar modal de foto
  $('cash-photo-modal-close').click();
  assert.equal($('cash-photo-modal').open, false);

  // Compartir movimiento específico desde la lista
  const shareBtn = w.document.querySelector('[data-cash-share-idx="0"]');
  assert.ok(shareBtn);
  shareBtn.click();
  await flush();

  assert.ok(sharedData, 'Debe invocar navigator.share');
  assert.match(sharedData.text, /ENTRADA S\/120 ADRIANO/);
  assert.equal(sharedData.files.length, 1);
});

test('Notificación de caja: al registrar un movimiento emite notificación con texto exacto "nuevo registro de caja"', async (t) => {
  const dom = page('admin.html', () => ({ ok: true }));
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  const notifications = [];
  class MockNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      notifications.push({ title, options });
    }
  }
  MockNotification.permission = 'granted';
  w.Notification = MockNotification;

  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  $('cash-reports-button').click();
  await flush();

  $('cash-amount').value = '100';
  $('cash-concept').value = 'prueba notificacion';
  $('cash-movement-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  assert.equal(notifications.length, 1, 'Debe emitirse una notificación al registrar');
  assert.equal(notifications[0].title, 'SPLASH Control Operativo');
  assert.equal(notifications[0].options.body, 'nuevo registro de caja', 'El cuerpo debe ser exactamente nuevo registro de caja');
});

test('WhatsApp en APK nativa: comparte imagen limpia y mensaje del reporte a WhatsApp via SplashAdminNative', async (t) => {
  let sharedImage = null;
  let sharedText = null;
  const dom = page('admin.html', () => ({ ok: true }));
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  w.SplashAdminNative = {
    shareToWhatsApp(photoData, text) {
      sharedImage = photoData;
      sharedText = text;
    }
  };

  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  $('cash-reports-button').click();
  await flush();

  $('cash-amount').value = '120';
  $('cash-operator').value = 'ADRIANO';
  $('cash-concept').value = 'primer servicio';

  const fakeFile = new w.File(['fake-raw-photo-bytes'], 'billete.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('cash-photo-input'), 'files', { value: [fakeFile] });
  $('cash-photo-input').dispatchEvent(new w.Event('change'));
  await flush();

  $('cash-submit-whatsapp-btn').click();
  await flush();

  assert.ok(sharedImage, 'Debe enviar la imagen limpia a SplashAdminNative.shareToWhatsApp');
  assert.equal(sharedImage, 'data:image/jpeg;base64,stamped-fake-image', 'La imagen debe enviarse a WhatsApp sin manipulación ni texto estampado posterior');
  assert.match(sharedText, /ENTRADA S\/120 ADRIANO\s*\n\*primer servicio\*/, 'El texto debe contener el reporte formateado para WhatsApp');
});
