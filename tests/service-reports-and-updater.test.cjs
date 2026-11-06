const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const flush = async () => {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
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
    const result = typeof handler === 'function' ? await handler(url, options) : [];
    if (result && typeof result === 'object' && ('status' in result || result instanceof Response)) {
      return result;
    }
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
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,clean-service-receipt-photo';

  class MockFileReader {
    readAsDataURL() {
      setImmediate(() => {
        this.result = 'data:image/jpeg;base64,clean-service-receipt-photo';
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

test('Operarios: reporte de servicios con chips 1ro a 7mo, montos rápidos, métodos de pago y formato WhatsApp', async (t) => {
  const supabaseCalls = [];
  let sharedPhoto = null;
  let sharedText = null;
  const notifications = [];

  class MockNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      notifications.push({ title, options });
    }
  }
  MockNotification.permission = 'granted';

  const dom = page('operarios.html', async (url, options) => {
    if (url.includes('/rest/v1/rpc/splash_report_service')) {
      supabaseCalls.push({ url, options, body: JSON.parse(options.body).payload, token: JSON.parse(options.body).session_token });
      return { ok: true, id: 'saved-id', duplicate: false };
    }
    if (url.includes('/rest/v1/app_versions')) {
      return [{ id: 'v2', app_name: 'operarios', version_name: '1.1', version_code: 2, apk_url: 'https://example.com/app.apk', changelog: 'Actualizaciones' }];
    }
    return { ok: true, name: 'Yerson' };
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.Notification = MockNotification;
  w.localStorage.setItem('splash-worker-session', 'token-operario');

  w.SplashAndroid = {
    shareToWhatsApp(photoData, text) {
      sharedPhoto = photoData;
      sharedText = text;
    },
    getAppVersion() {
      return 1;
    }
  };

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  const $ = (id) => w.document.getElementById(id);

  // 1. Verificar existencia de panel de reporte de servicios
  assert.ok($('open-service-report'), 'Botón para abrir reporte de servicio debe existir');
  $('open-service-report').click();
  await flush();
  assert.equal($('service-report-panel').hidden, false, 'El panel de reporte de servicios debe mostrarse');

  // 2. Probar chips de servicios de 1ro a 7mo
  const fourthServiceChip = w.document.querySelector('[data-service="Cuarto servicio"]');
  assert.ok(fourthServiceChip, 'Chip de Cuarto servicio debe existir');
  fourthServiceChip.click();
  assert.equal($('sr-service-input').value, 'Cuarto servicio');

  // 3. Probar nombre de operario
  $('sr-operator-input').value = 'Yerson';
  $('sr-operator-input').dispatchEvent(new w.Event('input'));

  // 4. Probar chips de monto rápido
  const amountChip150 = w.document.querySelector('[data-amount="150"]');
  assert.ok(amountChip150, 'Chip de monto 150 debe existir');
  amountChip150.click();
  assert.equal($('sr-amount-input').value, '150');

  // 5. Probar método de pago Yape y verificar iconos de Yape y Plin
  const yapeMethod = w.document.querySelector('input[name="sr-payment"][value="Yape"]');
  assert.ok(yapeMethod, 'Opción de pago Yape debe existir');
  assert.ok(w.document.querySelector('img[src="icon-yape.png"]'), 'Icono oficial de Yape debe existir');
  assert.ok(w.document.querySelector('img[src="icon-plin.png"]'), 'Icono oficial de Plin debe existir');
  yapeMethod.checked = true;
  yapeMethod.dispatchEvent(new w.Event('change'));

  // 6. Probar observación con formato entre paréntesis
  $('sr-observation-input').value = 'se dio vuelto en yape';
  $('sr-observation-input').dispatchEvent(new w.Event('input'));

  // 7. Verificar vista previa con 1 operario
  let previewText = $('sr-preview-text').textContent.trim();
  let expectedPreview = `Cuarto servicio\nOPERARIO: Yerson\nMONTO DEL SERVICIO: 150\nMETODO: Yape\n(se dio vuelto en yape)`;
  assert.equal(previewText, expectedPreview, 'La vista previa debe coincidir con el formato para un operario');

  // 7.1 Probar agregar segundo operario (cuando fueron 2 personas)
  assert.ok($('sr-add-second-op-btn'), 'El botón para agregar segundo operario debe existir');
  $('sr-add-second-op-btn').click();
  assert.equal($('sr-second-op-wrap').hidden, false, 'El campo de segundo operario debe hacerse visible');
  $('sr-second-operator-input').value = 'Paul';
  $('sr-second-operator-input').dispatchEvent(new w.Event('input'));

  previewText = $('sr-preview-text').textContent.trim();
  expectedPreview = `Cuarto servicio\nOPERARIOS: Yerson y Paul\nMONTO DEL SERVICIO: 150\nMETODO: Yape\n(se dio vuelto en yape)`;
  assert.equal(previewText, expectedPreview, 'La vista previa debe cambiar a OPERARIOS con ambos nombres');

  // Verificar botón de envío (debe decir "Enviar")
  assert.match($('sr-submit-whatsapp').textContent.trim(), /^Enviar$/i, 'El botón debe decir exactamente "Enviar"');

  // 8. Cargar foto del comprobante / dinero
  const fakeFile = new w.File(['photo-data'], 'comprobante.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('sr-photo-file'), 'files', { value: [fakeFile] });
  $('sr-photo-file').dispatchEvent(new w.Event('change'));
  await flush();

  // 9. Enviar reporte (guarda en caja y abre WhatsApp nativo)
  $('sr-submit-whatsapp').click();
  await flush();

  // Verificar llamada a Supabase cash_movements con ambos operarios
  assert.equal(supabaseCalls.length, 1, 'Debe haber enviado el reporte a administración');
  assert.equal(supabaseCalls[0].token, 'token-operario', 'El reporte viaja con la sesión del operario');
  const savedMovement = supabaseCalls[0].body;
  assert.equal(savedMovement.second_operator, 'Paul');
  assert.equal(savedMovement.amount, 150);
  assert.equal(savedMovement.service, 'Cuarto servicio');
  assert.equal(savedMovement.payment_method, 'Yape');
  assert.equal(savedMovement.observation, 'se dio vuelto en yape');
  assert.match(savedMovement.id, /^sr_\d{10,}_[a-z0-9]{1,8}$/);
  assert.match($('sr-message').textContent, /enviado a administración/i, 'El operario ve la confirmación real');

  // Verificar almacenamiento local para administración
  const localStore = JSON.parse(w.localStorage.getItem('splash-cash-records') || '{}');
  const todayRecords = Object.values(localStore).flat();
  assert.ok(todayRecords.some((r) => r.operator === 'Yerson y Paul' && r.amount === 150 && r.service_number === 'Cuarto servicio'));

  // Verificar notificación con texto exacto requerido
  assert.equal(notifications.length, 1, 'Debe generar una notificación');
  assert.equal(notifications[0].options.body, 'nuevo registro de caja', 'El texto de la notificación debe ser exacto');

  // Verificar envío a WhatsApp vía SplashAndroid con foto limpia y mensaje
  assert.ok(sharedPhoto, 'Debe compartir la foto tomada');
  assert.equal(sharedPhoto, 'data:image/jpeg;base64,clean-service-receipt-photo');
  assert.equal(sharedText, expectedPreview, 'El texto compartido debe coincidir con el mensaje formateado');
});

test('Administración y Operarios: sincronización de servicios en reportes de caja y gestor de APKs en Supabase', async (t) => {
  const versionsData = [
    {
      id: 'version-1',
      app_name: 'operarios',
      version_name: '1.1',
      version_code: 2,
      apk_url: 'https://example.com/download/app-v1.1.apk',
      changelog: 'Reporte de servicios con fotos para WhatsApp y caja, selector de pago y actualizador.',
      created_at: new Date().toISOString()
    }
  ];

  const cashMovementsData = [
    {
      id: 'sr_mock_123',
      date: '02/11/2026',
      type: 'ENTRADA',
      amount: 150,
      operator: 'Yerson',
      service_number: 'Cuarto servicio',
      payment_method: 'Yape',
      observation: 'se dio vuelto en yape',
      concept: 'Cuarto servicio - Yape (se dio vuelto en yape)',
      photo: 'data:image/jpeg;base64,sample-photo',
      time: '14:30',
      created_at: new Date().toISOString()
    }
  ];

  const adminDom = page('admin.html', async (url, options) => {
    if (url.includes('/rest/v1/cash_movements')) {
      if (options.method === 'POST') {
        const item = JSON.parse(options.body);
        cashMovementsData.push(item);
        return [item];
      }
      return cashMovementsData;
    }
    if (url.includes('/rest/v1/app_versions')) {
      if (options.method === 'POST') {
        const item = JSON.parse(options.body);
        versionsData.push({ id: 'v_' + Date.now(), ...item });
        return [item];
      }
      return versionsData;
    }
    return [];
  });
  t.after(() => adminDom.window.close());
  const w = adminDom.window;
  const $ = (id) => w.document.getElementById(id);

  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), adminDom.getInternalVMContext());
  await flush();

  // 1. Abrir diálogo de reportes de caja
  $('cash-reports-button').click();
  await flush();

  // Verificar que el movimiento reportado por el operario Yerson aparece sincronizado
  const reportPreview = $('cash-report-preview').textContent;
  assert.match(reportPreview, /Cuarto servicio/);
  assert.match(reportPreview, /OPERARIO: Yerson/);
  assert.match(reportPreview, /MONTO DEL SERVICIO: 150/);
  assert.match(reportPreview, /METODO: Yape/);
  assert.match(reportPreview, /\(se dio vuelto en yape\)/);

  // 2. Probar gestor de versiones de APK en administración
  assert.ok($('apk-manager-button'), 'El botón de gestión de APK debe existir en administración');
  $('apk-manager-button').click();
  await flush();
  assert.equal($('apk-manager-dialog').open, true, 'El diálogo de gestión de versiones debe abrirse');

  // Verificar lista de versiones cargadas
  const apkList = $('apk-versions-list').innerHTML;
  assert.match(apkList, /v1\.1/);
  assert.match(apkList, /código 2/);
  assert.match(apkList, /Operarios/);

  // Registrar nueva versión desde el formulario
  $('apk-app-name').value = 'operarios';
  $('apk-version-name').value = '1.2';
  $('apk-version-code').value = '3';
  $('apk-url-input').value = 'https://example.com/download/app-v1.2.apk';
  $('apk-changelog').value = 'Mejoras adicionales de rendimiento.';

  $('apk-version-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush();

  assert.equal(versionsData.length, 2, 'Debe haberse publicado la nueva versión en Supabase');
  assert.equal(versionsData[1].version_name, '1.2');
  assert.equal(versionsData[1].version_code, 3);
});

test('Operarios: actualizador de APK en la app consulta versiones en Supabase y permite instalar', async (t) => {
  let installUrlCalled = null;

  const dom = page('operarios.html', async (url) => {
    if (url.includes('/rest/v1/app_versions')) {
      return [{
        id: 'v2',
        app_name: 'operarios',
        version_name: '1.1',
        version_code: 2,
        apk_url: 'https://example.com/download/SPLASH-Operarios-v1.1.apk',
        changelog: 'Reporte de servicios, montos rápidos y actualizador automático.',
        created_at: new Date().toISOString()
      }];
    }
    return [];
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  w.SplashAndroid = {
    getAppVersion() {
      return 1; // Versión actual instalada: 1
    },
    downloadAndInstallApk(url) {
      installUrlCalled = url;
    }
  };

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  // 1. Abrir diálogo de actualización desde el menú
  assert.ok($('open-updater'), 'El botón de actualizar app debe existir');
  $('open-updater').click();
  await flush();

  // 2. Verificar que se abrió el modal y detectó nueva versión
  assert.equal($('app-updater-dialog').open, true, 'El diálogo de actualización debe abrirse');
  assert.equal($('updater-available-wrap').hidden, false, 'Debe mostrar el contenedor de nueva versión');
  assert.match($('updater-new-ver-title').textContent, /1\.1/);
  assert.match($('updater-changelog-text').textContent, /Reporte de servicios/);

  // 3. Hacer clic en descargar e instalar
  assert.ok($('updater-download-btn'), 'El botón de instalar actualización debe existir');
  $('updater-download-btn').click();
  await flush();

  assert.equal(installUrlCalled, 'https://example.com/download/SPLASH-Operarios-v1.1.apk', 'Debe llamar al instalador nativo de SplashAndroid con la URL del APK');
});

test('Operarios: en versión antigua de la APK (sin getAppVersion) detecta actualización y permite descargar directamente', async (t) => {
  let locationAssigned = null;

  const dom = page('operarios.html', async (url) => {
    if (url.includes('/rest/v1/app_versions')) {
      return [{
        id: 'v2',
        app_name: 'operarios',
        version_name: '1.1',
        version_code: 2,
        apk_url: 'https://pauluwu18.github.io/sphash-sede-las-flores-app/SPLASH-Operarios.apk',
        changelog: 'Reporte de servicios a caja y actualizador integrado.',
        created_at: new Date().toISOString()
      }];
    }
    return [];
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  // Simular APK antigua (v1.0): tiene SplashAndroid pero NO tiene getAppVersion ni downloadAndInstallApk
  w.SplashAndroid = {
    printPage() {},
    saveQrImage() {}
  };

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  // 1. Verificar botón de descarga desde la pantalla de login (accesible para cualquier operario)
  assert.ok($('login-download-apk-btn'), 'El botón de descarga en login debe existir');
  $('login-download-apk-btn').click();
  await flush();

  // 2. Abrir diálogo de actualización y verificar detección de versión antigua
  assert.ok($('open-updater'));
  $('open-updater').click();
  await flush();

  assert.equal($('app-updater-dialog').open, true, 'El modal de actualización debe abrirse');
  assert.match($('updater-cur-ver').textContent, /v1\.0/, 'Debe identificar que es la versión antigua v1.0');
  assert.equal($('updater-available-wrap').hidden, false, 'Debe mostrar la actualización disponible');
  assert.match($('updater-new-ver-title').textContent, /1\.1/);

  // 3. Probar clic en descargar actualización
  assert.ok($('updater-download-btn'));
  $('updater-download-btn').click();
  await flush();

  // 4. Probar botón de volver a descargar cuando ya se encuentra al día
  assert.ok($('updater-redownload-btn'), 'El botón de descargar de todas formas debe existir');
  $('updater-redownload-btn').click();
  await flush();
});

test('Operarios: barra de progreso de descarga y botón de instalación tras completar descarga', async (t) => {
  const dom = page('operarios.html', async (url) => {
    // Simular error 404 de Supabase (tabla no creada todavía)
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  });
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
  const w = dom.window;
  w.setInterval = global.setInterval;
  w.clearInterval = global.clearInterval;
  const $ = (id) => w.document.getElementById(id);

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  // Abrir actualizador
  $('open-updater').click();
  await flush();

  // Verificar que NO muestra "No se pudo conectar con Supabase"
  const statusText = $('updater-status-text') ? $('updater-status-text').textContent : '';
  assert.doesNotMatch(statusText, /No se pudo conectar con Supabase/i, 'No debe mostrar mensaje de error de Supabase');

  // La actualización v1.1 debe mostrarse disponible
  assert.equal($('updater-available-wrap').hidden, false, 'Debe mostrar actualización v1.1 disponible directamente');

  // Iniciar descarga
  const downloadBtn = $('updater-download-btn');
  assert.ok(downloadBtn, 'Botón de descarga debe existir');
  downloadBtn.click();

  // La barra de progreso debe hacerse visible y el botón de descarga ocultarse
  assert.equal($('updater-progress-wrap').hidden, false, 'La barra de progreso debe ser visible');
  assert.equal(downloadBtn.hidden, true, 'El botón de descarga inicial debe ocultarse');

  // Esperar a que la simulación de descarga avance
  await new Promise((resolve) => setTimeout(resolve, 1800));

  // Al finalizar la descarga, debe aparecer el botón de instalar aplicación
  assert.equal($('updater-install-btn').hidden, false, 'El botón de instalar debe aparecer tras completar la descarga');
  assert.match($('updater-install-btn').textContent, /Instalar aplicación ahora/i);
});

test('Tutor interactivo SPLASH: burbuja flotante, pasos con spotlight y menú rápido', async (t) => {
  const dom = page('operarios.html', async () => []);
  t.after(() => {
    if (dom.window.splashTutor) dom.window.splashTutor.destroy();
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
  });
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);

  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('splash-tutor.js', 'utf8'), dom.getInternalVMContext());
  await flush();

  // 1. Verificar existencia de la burbuja fija ❓
  const fab = $('splash-tutor-fab');
  assert.ok(fab, 'La burbuja de ayuda ❓ debe existir en el DOM');
  const fabImg = fab.querySelector('img');
  assert.ok(fabImg, 'La burbuja debe tener la imagen de avatar');

  // 2. Iniciar el tutor interactivo desde el objeto global
  assert.ok(w.splashTutor, 'El tutor SplashTutor debe estar instanciado');
  w.splashTutor.startTutorial(0);
  await new Promise((resolve) => setTimeout(resolve, 350));

  // El overlay y el spotlight deben estar activos
  assert.ok($('splash-tutor-overlay').classList.contains('is-active'), 'Overlay debe estar activo');
  assert.ok($('splash-tutor-spotlight').classList.contains('is-active'), 'Spotlight debe estar activo');
  assert.match($('splash-tutor-title').textContent, /Reportar servicio/i);

  // 3. Avanzar al paso 2 (Operario): debe desplegar automáticamente el panel de servicios
  w.splashTutor.nextStep();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.match($('splash-tutor-title').textContent, /Operario/i);
  assert.equal($('service-report-panel').hidden, false, 'El panel de reporte debe mostrarse en el paso 2');

  // 4. Avanzar por todos los pasos hasta el último (paso 8)
  for (let i = 2; i < 8; i++) {
    w.splashTutor.nextStep();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match($('splash-tutor-title').textContent, /Enviar/i);

  // 5. Finalizar el tutorial: celebración y guardado en localStorage
  w.splashTutor.nextStep(); // Paso final
  await flush();
  assert.match($('splash-tutor-title').textContent, /¡Perfecto! 🎉/i);

  // Tocar botón finalizar
  $('splash-tutor-next-btn').click();
  await flush();
  assert.equal(w.localStorage.getItem('splash_tutor_completed'), 'true', 'Debe marcar el tutorial como completado');
  assert.equal($('splash-tutor-stage').style.display, 'none', 'El tutor debe quedar oculto');

  // 6. Al pulsar la burbuja ❓ habiendo completado el tutorial, debe abrir el menú de ayuda rápida
  fab.click();
  await flush();
  assert.notEqual($('splash-tutor-quick-menu').style.display, 'none', 'Debe abrir el menú de ayuda rápida');
  const menuItems = w.document.querySelectorAll('.splash-tutor-menu-item');
  assert.ok(menuItems.length >= 4, 'Debe contener las opciones de ayuda rápida');
});



async function submitServiceFromWorkerPage(handler, t) {
  const dom = page('operarios.html', handler);
  t.after(() => dom.window.close());
  const w = dom.window;
  w.confirm = () => true;
  w.localStorage.setItem('splash-worker-session', 'token-operario');
  vm.runInContext(fs.readFileSync('splash-api.js', 'utf8'), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('operarios.js', 'utf8'), dom.getInternalVMContext());
  await flush();
  const $ = (id) => w.document.getElementById(id);
  $('open-service-report').click();
  await flush();
  w.document.querySelector('[data-service="Primer servicio"]').click();
  $('sr-amount-input').value = '80';
  $('sr-save-only').click();
  await flush();
  return { w, $ };
}

test('Operarios: sin la migración del RPC el reporte usa el insert directo con fecha de Lima y solo columnas válidas', async (t) => {
  const inserts = [];
  const { $ } = await submitServiceFromWorkerPage(async (url, options) => {
    if (url.includes('/rpc/splash_report_service')) return new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 });
    if (url.includes('/rest/v1/cash_movements')) { inserts.push(JSON.parse(options.body)); return []; }
    return { ok: true, name: 'Yerson' };
  }, t);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].date, /^\d{2}\/\d{2}\/\d{4}$/, 'misma fecha DD/MM/AAAA que consulta administración');
  assert.equal('timestamp' in inserts[0], false, 'timestamp no es columna de cash_movements y hacía fallar el insert');
  assert.equal('second_operator' in inserts[0], false);
  assert.match($('sr-message').textContent, /enviado a administración/i);
});

test('Operarios: sin conexión el reporte queda en cola y se reenvía una sola vez al volver la red', async (t) => {
  let online = false;
  const received = [];
  const { w, $ } = await submitServiceFromWorkerPage(async (url, options) => {
    if (url.includes('/rpc/splash_report_service')) {
      if (!online) throw new TypeError('Failed to fetch');
      received.push(JSON.parse(options.body).payload.id);
      return { ok: true };
    }
    return { ok: true, name: 'Yerson' };
  }, t);
  assert.match($('sr-message').textContent, /Sin conexión/);
  const queued = JSON.parse(w.localStorage.getItem('splash-pending-service-reports'));
  assert.equal(queued.length, 1);

  online = true;
  w.dispatchEvent(new w.Event('online'));
  await flush();
  assert.deepEqual(received, [queued[0].id], 'se reenvía con el mismo id para no duplicar');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('splash-pending-service-reports')), []);
});

test('Administración: avisa de un servicio nuevo de operario sin tener caja abierta y no avisa de los ya existentes', async (t) => {
  const rows = [{ id: 'sr_1_aaaa', operator: 'Antiguo', service_number: 'Primer servicio', amount: 50, payment_method: 'Efectivo' }];
  const dom = page('admin.html', async (url) => (url.includes('/rest/v1/cash_movements') ? rows : []));
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
  w.sessionStorage.setItem('splash-admin-session', 'admin-token');
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), dom.getInternalVMContext());
  await flush();
  w.document.getElementById('login-screen').hidden = true;

  await w.pollWorkerServiceReports();
  assert.equal(w.document.getElementById('toast').classList.contains('visible'), false, 'el primer sondeo solo registra lo existente');
  rows.push({ id: 'sr_2_bbbb', operator: 'Yerson Prueba', service_number: 'Segundo servicio', amount: 120, payment_method: 'Yape' });
  await w.pollWorkerServiceReports();
  const toast = w.document.getElementById('toast-text').textContent;
  assert.match(toast, /Nuevo servicio de Yerson Prueba/);
  assert.match(toast, /S\/ 120\.00/);
  assert.doesNotMatch(toast, /Antiguo/);
});
