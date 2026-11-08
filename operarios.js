(() => {
  const $ = id => document.getElementById(id);
  let activating = false;
  let qrToken = Splash.readQR(location.href);
  let stream = null;
  let frame = null;
  let scanGeneration = 0;
  let saving = false;
  let bellContext;
  let currentWorker = null;

  function prepareBell() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      bellContext ||= new Audio();
      if (bellContext.state === 'suspended') bellContext.resume().catch(() => {});
    } catch { /* El registro funciona aunque el dispositivo bloquee el audio. */ }
  }
  document.addEventListener('pointerdown', prepareBell);
  document.addEventListener('keydown', prepareBell);
  function ringBell() {
    if (bellContext?.state !== 'running') return;
    try {
      const start = bellContext.currentTime;
      for (const [frequency, volume] of [[880, .16], [1760, .055], [2640, .025]]) {
        const tone = bellContext.createOscillator();
        const gain = bellContext.createGain();
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(.001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + 1.1);
        tone.connect(gain); gain.connect(bellContext.destination);
        tone.start(start); tone.stop(start + 1.15);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      }
    } catch { /* El sonido nunca debe interrumpir la confirmación visual. */ }
  }
  let cameraTimer;
  const view = new URLSearchParams(location.search).get('view');
  let historyRecords = [];
  let historyLoading = false;
  // Comparte la sesión entre las páginas del mismo sitio, sin ponerla en la URL.
  const previousSession = sessionStorage.getItem('splash-worker-session');
  if (previousSession && !localStorage.getItem('splash-worker-session')) localStorage.setItem('splash-worker-session', previousSession);
  sessionStorage.removeItem('splash-worker-session');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // El token del QR permanece solo en memoria; no se guarda en almacenamiento.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  function stopCamera() {
    clearTimeout(cameraTimer);
    scanGeneration++;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if ($('qr-video')) {
      $('qr-video').srcObject = null;
      $('qr-video').hidden = true;
    }
    if ($('stop-camera')) $('stop-camera').hidden = true;
    if ($('start-camera')) {
      $('start-camera').disabled = false;
      $('start-camera').hidden = !!qrToken;
      $('start-camera').textContent = 'Abrir cámara';
    }
    scannerState('idle', 'Tu cámara aparecerá aquí', 'Cámara apagada');
  }

  function scannerState(state, caption, badge) {
    if (!$('scanner-viewport')) return;
    $('scanner-viewport').dataset.state = state;
    if ($('scanner-placeholder')) $('scanner-placeholder').hidden = state === 'live';
    if ($('scanner-caption')) $('scanner-caption').textContent = caption;
    if ($('scanner-badge')) $('scanner-badge').textContent = badge;
  }

  function cameraError(error) {
    stopCamera();
    const messages = {
      NotAllowedError: 'Permite el acceso a la cámara en los ajustes del sitio o de la app. Si ya lo bloqueaste, pulsar el botón otra vez no cambia ese permiso.',
      NotFoundError: 'No se encontró una cámara. Prueba «Tomar foto del QR» o abre el enlace en el navegador de tu teléfono.',
      NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
      TimeoutError: 'La cámara no respondió. Revisa si hay una solicitud de permiso pendiente o usa «Tomar foto del QR».'
    };
    if ($('checkin-message')) $('checkin-message').textContent = messages[error.name] || error.message || 'No se pudo abrir la cámara. Revisa la guía inferior.';
    if ($('camera-help')) $('camera-help').open = true;
    scannerState('error', 'No pudimos abrir la cámara', 'Revisa los permisos');
    if ($('start-camera')) $('start-camera').textContent = 'Volver a intentar';
  }

  function showCheckin() {
    if ($('checkin-panel')) $('checkin-panel').hidden = false;
    if ($('checkin-operator-name') && currentWorker?.name) $('checkin-operator-name').textContent = currentWorker.name;
    if ($('history-panel')) $('history-panel').hidden = true;
    if ($('service-report-panel')) $('service-report-panel').hidden = true;
    if ($('confirm-checkin')) $('confirm-checkin').hidden = true;
    if ($('start-camera')) $('start-camera').hidden = !!qrToken;
    if ($('checkin-message')) {
      $('checkin-message').textContent = qrToken ? 'QR reconocido. Registrando tu asistencia…' : '';
      $('checkin-message').classList.remove('is-success');
    }
    if ($('checkin-history-link')) $('checkin-history-link').hidden = true;
    setStep(qrToken ? 'confirm' : 'camera');
    if (qrToken) { scannerState('ready', 'QR reconocido', 'Registrando'); registerCheckin(); }
  }

  function showServiceReport() {
    stopCamera();
    stopSrLiveCamera();
    if ($('checkin-panel')) $('checkin-panel').hidden = true;
    if ($('history-panel')) $('history-panel').hidden = true;
    if ($('service-report-panel')) $('service-report-panel').hidden = false;
    if ($('worker-menu')) $('worker-menu').hidden = true;
    if ($('worker-menu-hint')) $('worker-menu-hint').hidden = true;
    if ($('worker-back')) $('worker-back').hidden = false;
    document.title = 'Reportar servicio · SPLASH';
    
    // Asignar el operario actual si está logueado
    if (currentWorker?.name) {
      if ($('sr-operator-display')) $('sr-operator-display').textContent = currentWorker.name;
      if ($('sr-operator-input')) $('sr-operator-input').value = currentWorker.name;
    }
    updateSrPreview();
  }

  function setStep(step) {
    for (const name of ['camera', 'code', 'confirm']) {
      const item = $(`scan-step-${name}`);
      if (!item) continue;
      if (name === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
  }

  async function enter() {
    const me = await Splash.call('me', {}, 'worker');
    currentWorker = me;
    historyRecords = [];
    if ($('worker-history')) $('worker-history').replaceChildren();
    if ($('history-panel')) $('history-panel').hidden = true;
    if ($('checkin-panel')) $('checkin-panel').hidden = true;
    if ($('service-report-panel')) $('service-report-panel').hidden = true;
    if ($('worker-name')) $('worker-name').textContent = `Hola, ${me.name}`;
    if ($('worker-login')) $('worker-login').hidden = true;
    if ($('worker-home')) $('worker-home').hidden = false;
    if ($('checkin-operator-name')) $('checkin-operator-name').textContent = me.name;
    if (window.splashTutor?.syncVisibility) window.splashTutor.syncVisibility();
    if ($('worker-pin')) $('worker-pin').value = '';
    if ($('worker-pin-confirm')) $('worker-pin-confirm').value = '';
    activating = false;
    if ($('worker-dni')) $('worker-dni').readOnly = false;
    if ($('pin-confirm-wrap')) $('pin-confirm-wrap').hidden = true;
    if ($('worker-pin-confirm')) $('worker-pin-confirm').required = false;
    if ($('worker-submit')) $('worker-submit').textContent = 'Iniciar sesión';
    if ($('worker-pin')) $('worker-pin').autocomplete = 'current-password';
    
    // Configurar operario por defecto en formulario de servicio
    if ($('sr-operator-display')) $('sr-operator-display').textContent = me.name;
    if ($('sr-operator-input')) $('sr-operator-input').value = me.name;

    const separatePage = view === 'scan' || view === 'history' || view === 'service' || !!qrToken;
    if ($('worker-menu')) $('worker-menu').hidden = separatePage;
    if ($('worker-menu-hint')) $('worker-menu-hint').hidden = separatePage;
    if ($('worker-back')) $('worker-back').hidden = !separatePage;

    if (qrToken || view === 'scan') {
      showCheckin();
      document.title = 'Escanear QR · SPLASH';
    } else if (view === 'history') {
      if ($('history-panel')) $('history-panel').hidden = false;
      if ($('checkin-panel')) $('checkin-panel').hidden = true;
      document.title = 'Mis asistencias · SPLASH';
      await loadHistory();
    } else if (view === 'service') {
      showServiceReport();
    }

    flushPendingReports();
    // Verificar si hay actualización disponible de forma no bloqueante
    checkAppVersionQuietly();
  }

  if ($('worker-login-form')) {
    $('worker-login-form').addEventListener('submit', async event => {
      event.preventDefault();
      $('worker-submit').disabled = true;
      $('worker-login-message').textContent = '';
      try {
        const dni = $('worker-dni').value.trim();
        const pin = $('worker-pin').value;
        if (activating && (pin !== $('worker-pin-confirm').value || !/^\d{4}$/.test(pin))) throw new Error('Escribe el mismo PIN de 4 dígitos en ambos campos.');
        const result = await Splash.call(activating ? 'activate' : 'worker_login', { dni, pin, ...(qrToken && { qr: qrToken }) }, 'worker');
        if (result.needs_pin) {
          activating = true;
          $('pin-confirm-wrap').hidden = false;
          $('worker-pin').required = true;
          $('worker-pin-confirm').required = true;
          $('worker-pin').autocomplete = 'new-password';
          $('worker-dni').readOnly = true;
          $('worker-submit').textContent = 'Crear PIN e ingresar';
          $('worker-intro').textContent = 'Crea tu PIN personal de 4 dígitos. El administrador podrá consultarlo si lo olvidas.';
          $('worker-pin').focus();
          return;
        }
        localStorage.setItem('splash-worker-session', result.token);
        await enter();
      } catch (error) { $('worker-login-message').textContent = error.message; }
      finally { $('worker-submit').disabled = false; }
    });
  }

  function renderHistory() {
    if (!$('worker-month') || !$('worker-history')) return;
    const month = $('worker-month').value;
    const rows = historyRecords.filter(row => !month || row.date.startsWith(month));
    if ($('history-total')) $('history-total').textContent = String(rows.length);
    if ($('history-latest')) $('history-latest').textContent = historyRecords.length ? historyRecords[0].date.split('-').reverse().join('/') : 'Sin registros';
    $('worker-history').innerHTML = rows.map(row => {
      const [year, month, day] = row.date.split('-');
      const weekday = new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${row.date}T12:00:00Z`));
      const late = row.late === true || (row.source === 'QR' && row.time >= '07:45');
      return `<article class="worker-attendance-row"><div><small class="attendance-weekday">${Splash.escape(weekday)}</small><strong>${day}/${month}/${year}</strong><small>${row.source === 'QR' ? 'Registrada con QR' : 'Registrada por administración'}</small></div><div class="attendance-time"><small>Hora de llegada</small><strong>${Splash.escape(row.time)}</strong><span class="attendance-status ${late ? 'is-late' : 'is-early'}">${late ? 'Tardanza' : 'Temprano'}</span></div></article>`;
    }).join('');
    if ($('worker-history-message')) {
      $('worker-history-message').textContent = rows.length ? 'Tus asistencias están actualizadas.' : month ? 'No tienes asistencias registradas en este mes. Puedes elegir otro mes o ver todas.' : 'Aún no tienes asistencias. Escanea el QR de la base para registrar tu primera llegada.';
    }
  }

  async function loadHistory() {
    if (historyLoading) return;
    historyLoading = true;
    if ($('history-refresh')) $('history-refresh').disabled = true;
    try {
      historyRecords = (await Splash.call('my_attendance', {}, 'worker')).sort((a, b) => b.date.localeCompare(a.date));
      renderHistory();
    } catch (error) { if ($('worker-history-message')) $('worker-history-message').textContent = `No se pudo actualizar: ${error.message}`; }
    finally { historyLoading = false; if ($('history-refresh')) $('history-refresh').disabled = false; }
  }

  if ($('worker-month')) $('worker-month').addEventListener('change', renderHistory);
  if ($('history-all')) $('history-all').addEventListener('click', () => { $('worker-month').value = ''; renderHistory(); });
  if ($('history-refresh')) $('history-refresh').addEventListener('click', loadHistory);
  if ($('open-checkin')) $('open-checkin').addEventListener('click', () => location.assign('operarios.html?view=scan'));
  if ($('open-history')) $('open-history').addEventListener('click', () => location.assign('operarios.html?view=history'));
  if ($('open-service-report')) $('open-service-report').addEventListener('click', () => showServiceReport());

  if ($('start-camera')) {
    $('start-camera').addEventListener('click', async () => {
      stopCamera();
      const generation = scanGeneration;
      $('start-camera').disabled = true;
      $('start-camera').textContent = 'Abriendo cámara…';
      $('checkin-message').textContent = 'Permite el acceso cuando tu teléfono lo solicite.';
      $('camera-help').open = false;
      $('stop-camera').hidden = false;
      scannerState('pending', 'Esperando permiso de cámara', 'Abriendo cámara');
      cameraTimer = setTimeout(() => {
        if (generation === scanGeneration) cameraError({ name: 'TimeoutError' });
      }, 15000);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS. También puedes usar la cámara de tu teléfono para abrir el QR.');
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (generation !== scanGeneration || $('checkin-panel').hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        const video = $('qr-video');
        video.srcObject = stream;
        video.hidden = false;
        $('stop-camera').hidden = false;
        await video.play();
        if (generation !== scanGeneration) return;
        clearTimeout(cameraTimer);
        scannerState('live', '', 'Buscando el QR');
        $('start-camera').hidden = true;
        $('checkin-message').textContent = 'Apunta la cámara al QR de la base.';
        setStep('code');
        function scan() {
          if (!stream || generation !== scanGeneration) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              canvas.width = Math.min(video.videoWidth, 640);
              canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
              if (code) {
                const candidate = Splash.readQR(code.data);
                if (candidate) { qrToken = candidate; stopCamera(); showCheckin(); return; }
                $('checkin-message').textContent = 'Este QR no corresponde a esta base.';
              }
            }
            frame = requestAnimationFrame(scan);
          } catch (error) { cameraError(error); }
        }
        scan();
      } catch (error) {
        if (generation === scanGeneration) cameraError(error);
      }
    });
  }

  if ($('stop-camera')) {
    $('stop-camera').addEventListener('click', () => { stopCamera(); setStep('camera'); $('checkin-message').textContent = 'Cámara cerrada. Pulsa «Abrir cámara» para volver a escanear.'; });
  }

  if ($('qr-photo')) {
    $('qr-photo').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      stopCamera();
      const generation = scanGeneration;
      let url;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('La foto es demasiado grande. Toma otra de menor tamaño.');
        $('checkin-message').textContent = 'Leyendo la foto del QR…';
        url = URL.createObjectURL(file);
        const photo = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('No se pudo abrir la foto. Usa una imagen JPG o PNG.'));
          img.src = url;
        });
        if (generation !== scanGeneration || $('worker-home').hidden) return;
        const ratio = Math.min(1, 1600 / Math.max(photo.naturalWidth, photo.naturalHeight));
        canvas.width = Math.max(1, Math.round(photo.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(photo.naturalHeight * ratio));
        context.drawImage(photo, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(pixels.data, canvas.width, canvas.height);
        const candidate = code && Splash.readQR(code.data);
        if (!candidate) throw new Error('No se reconoció el QR de esta base. Toma otra foto más cerca, enfocada y sin reflejos.');
        qrToken = candidate;
        showCheckin();
      } catch (error) { if (generation === scanGeneration) $('checkin-message').textContent = error.message; }
      finally { if (url) URL.revokeObjectURL(url); event.target.value = ''; }
    });
  }

  if ($('copy-scanner-link')) {
    $('copy-scanner-link').addEventListener('click', async () => {
      const url = new URL('operarios.html?view=scan', location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        $('scanner-link-message').textContent = 'Enlace copiado. Pégalo en Chrome o Safari para abrir el escáner.';
      } catch {
        $('scanner-link').value = url;
        $('scanner-link').hidden = false;
        $('scanner-link').focus();
        $('scanner-link').select();
        $('scanner-link-message').textContent = 'Mantén pulsado el enlace para copiarlo y abrirlo en tu navegador.';
      }
    });
  }

  async function registerCheckin() {
    if (saving || !qrToken) return;
    saving = true;
    stopCamera();
    if ($('qr-photo')) $('qr-photo').disabled = true;
    if ($('checkin-message')) $('checkin-message').textContent = 'Registrando tu asistencia…';
    if ($('confirm-checkin')) {
      $('confirm-checkin').disabled = true;
      $('confirm-checkin').hidden = true;
    }
    try {
      const result = await Splash.call('checkin', { qr: qrToken }, 'worker');
      if (!result?.ok && !result?.already) throw new Error('El servidor no confirmó el registro.');
      qrToken = '';
      if ($('worker-home').hidden) return;
      $('checkin-message').textContent = result.message;
      $('checkin-message').classList.add('is-success');
      $('checkin-history-link').hidden = false;
      scannerState('success', result.already ? 'Ya registraste tu llegada' : 'Asistencia registrada', 'Registro confirmado');
      $('confirm-checkin').hidden = true;
      $('start-camera').hidden = true;
      $('attendance-result-title').textContent = result.already ? 'Ya registrada' : 'Registrado';
      $('attendance-result-message').textContent = result.already ? `Tu asistencia de hoy ya estaba registrada como ${currentWorker?.name || 'tu usuario'}. No se creó un duplicado.` : `¡Listo, ${currentWorker?.name || ''}! Tu llegada se guardó correctamente en la lista de hoy.`;
      if (!$('attendance-result').open) $('attendance-result').showModal();
      if (!result.already) ringBell();
    } catch (error) {
      $('checkin-message').textContent = `${error.message} No se ha confirmado la asistencia. Puedes reintentar sin duplicarla.`;
      $('confirm-checkin').hidden = false;
      scannerState('error', 'No se confirmó el registro', 'Reintenta');
    }
    finally { saving = false; if ($('confirm-checkin')) $('confirm-checkin').disabled = false; if ($('qr-photo')) $('qr-photo').disabled = false; }
  }

  if ($('confirm-checkin')) $('confirm-checkin').addEventListener('click', registerCheckin);
  if ($('attendance-result-close')) $('attendance-result-close').addEventListener('click', () => $('attendance-result').close());

  // =========================================================================
  // SISTEMA DE REPORTE DE SERVICIOS PARA OPERARIOS (Caja + WhatsApp)
  // =========================================================================
  let srCameraStream = null;
  let currentSrPhotoData = '';

  function formatMontoExact(num) {
    const n = Number(num) || 0;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  // Misma fecha (DD/MM/AAAA) y zona horaria que usa el panel de administración para consultar caja.
  function getTodayString() {
    return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' }).format(new Date());
  }

  function getTimeString() {
    return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date());
  }

  const PENDING_REPORTS_KEY = 'splash-pending-service-reports';
  let flushingReports = false;

  function readPendingReports() {
    try { const list = JSON.parse(localStorage.getItem(PENDING_REPORTS_KEY) || '[]'); return Array.isArray(list) ? list : []; }
    catch { return []; }
  }

  function writePendingReports(list) {
    try { localStorage.setItem(PENDING_REPORTS_KEY, JSON.stringify(list)); } catch { /* sin almacenamiento: el reporte ya se mostró al operario */ }
  }

  async function legacyInsertReport(report) {
    const response = await fetch(`${Splash.url}/rest/v1/cash_movements`, {
      method: 'POST',
      headers: { apikey: Splash.key, Authorization: `Bearer ${Splash.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify(report)
    });
    if (!response.ok) { const error = new Error('No se pudo enviar el reporte.'); error.status = response.status; throw error; }
  }

  // Devuelve 'sent' | 'queued' | 'rejected'. Solo los fallos de red o del servidor se reintentan.
  async function deliverServiceReport(report) {
    try {
      try {
        await Splash.reportService({ id: report.id, amount: report.amount, service: report.service_number, payment_method: report.payment_method, second_operator: report.second_operator, observation: report.observation, photo: report.photo });
      } catch (error) {
        if (error.code !== 'PGRST202') throw error;
        const { second_operator, ...row } = report;
        await legacyInsertReport(row);
      }
      return 'sent';
    } catch (error) {
      const retryable = !error.status || error.status >= 500 || error.status === 408 || error.status === 429;
      if (error.code === 'SESSION' || !retryable) return 'rejected';
      const pending = readPendingReports();
      if (!pending.some(item => item.id === report.id)) writePendingReports([...pending, report]);
      return 'queued';
    }
  }

  async function flushPendingReports() {
    if (flushingReports || !localStorage.getItem('splash-worker-session')) return;
    flushingReports = true;
    try {
      for (const report of readPendingReports()) {
        const outcome = await deliverServiceReport(report);
        if (outcome === 'queued') break;
        writePendingReports(readPendingReports().filter(item => item.id !== report.id));
      }
    } finally { flushingReports = false; }
    if ($('sr-pending-note')) {
      const left = readPendingReports().length;
      $('sr-pending-note').hidden = !left;
      $('sr-pending-note').textContent = left ? `${left} reporte${left === 1 ? '' : 's'} pendiente${left === 1 ? '' : 's'} de envío a administración.` : '';
    }
  }
  window.addEventListener('online', flushPendingReports);
  const pendingReportsInterval = setInterval(flushPendingReports, 30000);
  window.addEventListener('pagehide', () => clearInterval(pendingReportsInterval));

  // Extra cobrado aparte del servicio; el operario recibe el 50 % como comisión.
  function getSrExtra() {
    const value = Number($('sr-extra-input')?.value);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }

  function buildSrWhatsappText() {
    const service = ($('sr-service-input')?.value || '').trim() || 'Primer servicio';
    const primaryOp = ($('sr-operator-input')?.value || $('sr-operator-display')?.textContent || currentWorker?.name || '').trim();
    const secondOp = ($('sr-second-operator-input')?.value || '').trim();

    const opLabel = secondOp ? 'OPERARIOS' : 'OPERARIO';
    const opDisplay = secondOp ? `${primaryOp} y ${secondOp}` : primaryOp;

    const amountVal = $('sr-amount-input')?.value;
    const amountFormatted = amountVal ? formatMontoExact(amountVal) : '0';
    const payMethod = document.querySelector('input[name="sr-payment"]:checked')?.value || '';
    const obsRaw = ($('sr-observation-input')?.value || '').trim();
    const obsClean = obsRaw ? obsRaw.replace(/^\(+|\)+$/g, '').trim() : '';
    const extra = getSrExtra();

    let text = `${service}
${opLabel}: ${opDisplay}
MONTO DEL SERVICIO: ${amountFormatted}`;
    if (extra > 0) {
      text += `
EXTRA: ${formatMontoExact(extra)} (comisión operario: ${formatMontoExact(extra / 2)})
TOTAL COBRADO: ${formatMontoExact((Number(amountVal) || 0) + extra)}`;
    }
    text += `
METODO: ${payMethod || 'ELIGE EL MÉTODO'}`;
    if (obsClean) {
      text += `
(${obsClean})`;
    }
    return text;
  }

  function updateSrPreview() {
    if (!$('sr-preview-text')) return;
    $('sr-preview-text').textContent = buildSrWhatsappText();
  }

  // Listeners de actualización en tiempo real de la vista previa
  ['sr-service-input', 'sr-amount-input', 'sr-extra-input', 'sr-observation-input', 'sr-operator-input', 'sr-second-operator-input'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', updateSrPreview);
      el.addEventListener('change', updateSrPreview);
    }
  });

  // Selector de número de servicio (1er al 7mo servicio)
  if ($('sr-service-pills')) {
    $('sr-service-pills').addEventListener('click', e => {
      const pill = e.target.closest('[data-service]');
      if (!pill) return;
      $('sr-service-input').value = pill.dataset.service;
      document.querySelectorAll('#sr-service-pills .sr-pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      updateSrPreview();
    });
  }

  // Selector de montos rápidos
  if ($('sr-amount-pills')) {
    $('sr-amount-pills').addEventListener('click', e => {
      const pill = e.target.closest('[data-amount]');
      if (!pill) return;
      $('sr-amount-input').value = pill.dataset.amount;
      document.querySelectorAll('#sr-amount-pills .sr-pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      updateSrPreview();
    });
  }

  // Selector de métodos de pago
  document.querySelectorAll('input[name="sr-payment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.sr-payment-option').forEach(opt => opt.classList.remove('is-active'));
      const activeLabel = radio.closest('.sr-payment-option');
      if (activeLabel) activeLabel.classList.add('is-active');
      updateSrPreview();
    });
  });

  // Agregar o quitar segundo operario (si fueron en 2 personas)
  if ($('sr-add-second-op-btn')) {
    $('sr-add-second-op-btn').addEventListener('click', () => {
      const wrap = $('sr-second-op-wrap');
      if (!wrap) return;
      wrap.hidden = false;
      $('sr-second-operator-input')?.focus();
      updateSrPreview();
    });
  }

  if ($('sr-remove-second-op-btn')) {
    $('sr-remove-second-op-btn').addEventListener('click', () => {
      const wrap = $('sr-second-op-wrap');
      if (wrap) wrap.hidden = true;
      if ($('sr-second-operator-input')) $('sr-second-operator-input').value = '';
      updateSrPreview();
    });
  }

  // Cámara en vivo para reporte de operario
  async function startSrLiveCamera() {
    stopSrLiveCamera();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Cámara no disponible');
      let acquired = null;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false
        });
      } catch {
        acquired = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      srCameraStream = acquired;
      if ($('sr-camera-video')) {
        $('sr-camera-video').srcObject = srCameraStream;
        await $('sr-camera-video').play();
      }
      if ($('sr-camera-live-wrap')) $('sr-camera-live-wrap').hidden = false;
      if ($('sr-photo-actions')) $('sr-photo-actions').hidden = true;
    } catch (err) {
      alert('No se pudo abrir la cámara. Verifica los permisos de cámara en tu navegador o app.');
    }
  }

  function stopSrLiveCamera() {
    if (srCameraStream) {
      srCameraStream.getTracks().forEach(t => t.stop());
      srCameraStream = null;
    }
    if ($('sr-camera-video')) $('sr-camera-video').srcObject = null;
    if ($('sr-camera-live-wrap')) $('sr-camera-live-wrap').hidden = true;
    if ($('sr-photo-actions')) $('sr-photo-actions').hidden = false;
  }

  function captureSrLiveFrame() {
    const video = $('sr-camera-video');
    if (!video || !srCameraStream) return;
    const c = document.createElement('canvas');
    const maxW = 960;
    let w = video.videoWidth || 800;
    let h = video.videoHeight || 600;
    if (w > maxW) {
      h = Math.round((h * maxW) / w);
      w = maxW;
    }
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, w, h);
      currentSrPhotoData = c.toDataURL('image/jpeg', 0.82);
    }
    stopSrLiveCamera();
    if ($('sr-photo-preview-img')) $('sr-photo-preview-img').src = currentSrPhotoData;
    if ($('sr-photo-preview-wrap')) $('sr-photo-preview-wrap').hidden = false;
  }

  if ($('sr-open-camera-btn')) $('sr-open-camera-btn').addEventListener('click', startSrLiveCamera);
  if ($('sr-capture-photo-btn')) $('sr-capture-photo-btn').addEventListener('click', captureSrLiveFrame);
  if ($('sr-close-camera-btn')) $('sr-close-camera-btn').addEventListener('click', stopSrLiveCamera);

  if ($('sr-photo-file')) {
    $('sr-photo-file').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const raw = ev.target.result;
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const maxW = 960;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (w > maxW) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          }
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            currentSrPhotoData = c.toDataURL('image/jpeg', 0.82);
          } else {
            currentSrPhotoData = raw;
          }
          if ($('sr-photo-preview-img')) $('sr-photo-preview-img').src = currentSrPhotoData;
          if ($('sr-photo-preview-wrap')) $('sr-photo-preview-wrap').hidden = false;
        };
        img.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }

  if ($('sr-remove-photo-btn')) {
    $('sr-remove-photo-btn').addEventListener('click', () => {
      currentSrPhotoData = '';
      if ($('sr-photo-file')) $('sr-photo-file').value = '';
      if ($('sr-photo-preview-wrap')) $('sr-photo-preview-wrap').hidden = true;
    });
  }

  // Notificación local de registro de caja
  function notifyCashRecord() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('SPLASH Control Operativo', { body: 'nuevo registro de caja', icon: 'icon.png' });
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            new Notification('SPLASH Control Operativo', { body: 'nuevo registro de caja', icon: 'icon.png' });
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Convertir DataURL a objeto File de forma síncrona sin latencia de red
  function dataUrlToFile(dataUrl, filename) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) return null;
      const parts = dataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime });
    } catch (_) {
      return null;
    }
  }

  // Estampar detalles del servicio sobre el comprobante (para respaldo visual indudable)
  function stampSrPhoto(dataUrl, line1, line2, subtext) {
    return new Promise(resolve => {
      if (!dataUrl || typeof Image === 'undefined') return resolve(dataUrl);
      try {
        const timer = setTimeout(() => resolve(dataUrl), 250);
        const img = new Image();
        img.onload = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            const maxW = 960;
            let w = img.naturalWidth || img.width || 800;
            let h = img.naturalHeight || img.height || 600;
            if (w > maxW) {
              h = Math.round((h * maxW) / w);
              w = maxW;
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(dataUrl);

            ctx.drawImage(img, 0, 0, w, h);

            const bannerHeight = Math.max(76, Math.round(h * 0.22));
            const grad = ctx.createLinearGradient(0, h - bannerHeight - 20, 0, h);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
            grad.addColorStop(0.3, 'rgba(0, 0, 0, 0.72)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, h - bannerHeight - 20, w, bannerHeight + 20);

            const baseFontSize = Math.max(16, Math.round(w * 0.04));
            ctx.font = `bold ${baseFontSize}px sans-serif`;
            ctx.fillStyle = '#4ade80';
            const padLeft = Math.round(w * 0.04);
            const bottomPad = Math.round(h * 0.04);

            const yLine1 = h - bottomPad - Math.round(baseFontSize * 1.6);
            const yLine2 = h - bottomPad - Math.round(baseFontSize * 0.5);
            const ySub = h - bottomPad + Math.round(baseFontSize * 0.5);

            ctx.fillText(line1, padLeft, yLine1);

            if (line2) {
              ctx.font = `600 ${Math.round(baseFontSize * 0.85)}px sans-serif`;
              ctx.fillStyle = '#ffffff';
              ctx.fillText(line2, padLeft, yLine2);
            }

            if (subtext) {
              ctx.font = `500 ${Math.round(baseFontSize * 0.65)}px sans-serif`;
              ctx.fillStyle = '#cbd5e1';
              ctx.fillText(subtext, padLeft, ySub);
            }

            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(dataUrl);
        };
        img.src = dataUrl;
      } catch {
        resolve(dataUrl);
      }
    });
  }

  // Guardar y enviar servicio
  async function submitServiceReport(sendToWhatsapp = true) {
    const amountVal = $('sr-amount-input')?.value;
    const amount = Number(amountVal);
    if (isNaN(amount) || amount <= 0) {
      alert('Ingresa un monto válido para el servicio.');
      $('sr-amount-input')?.focus();
      return;
    }

    const service = ($('sr-service-input')?.value || '').trim();
    if (!service) {
      alert('Indica el número o detalle del servicio.');
      $('sr-service-input')?.focus();
      return;
    }

    const primaryOp = ($('sr-operator-input')?.value || $('sr-operator-display')?.textContent || currentWorker?.name || '').trim();
    if (!primaryOp || primaryOp === '—') {
      alert('Indica el nombre del operario.');
      return;
    }
    const secondOp = ($('sr-second-operator-input')?.value || '').trim();
    const operator = secondOp ? `${primaryOp} y ${secondOp}` : primaryOp;

    const payMethod = document.querySelector('input[name="sr-payment"]:checked')?.value || '';
    if (!payMethod) {
      alert('Elige cómo se pagó el servicio: Yape, Plin, Tarjeta, Link o Efectivo. Efectivo solo si recibiste el dinero en la mano.');
      $('sr-payment-methods')?.scrollIntoView?.({ block: 'center' });
      return;
    }
    const extra = getSrExtra();
    const totalAmount = Math.round((amount + extra) * 100) / 100;
    const obsRaw = ($('sr-observation-input')?.value || '').trim();
    const obsBase = obsRaw ? obsRaw.replace(/^\(+|\)+$/g, '').trim() : '';
    const extraNote = extra > 0 ? `Incluye extra S/${formatMontoExact(extra)} (comisión S/${formatMontoExact(extra / 2)})` : '';
    const obsClean = [obsBase, extraNote].filter(Boolean).join(' · ').slice(0, 200);
    const date = getTodayString();
    const time = getTimeString();

    // Si la cámara en vivo estaba encendida pero no presionó "Capturar foto", capturarla automáticamente
    if (!currentSrPhotoData && srCameraStream) {
      captureSrLiveFrame();
    }

    // Advertencia amigable si olvidó adjuntar foto
    if (!currentSrPhotoData) {
      const confirmNoPhoto = confirm('⚠️ No has tomado ni subido una foto del billete o comprobante.\n\n¿Deseas enviar el reporte sin foto?');
      if (!confirmNoPhoto) return;
    }

    // Preparar foto con estampado de seguridad si existe
    let photoToSend = currentSrPhotoData || '';
    if (photoToSend) {
      try {
        photoToSend = await stampSrPhoto(
          photoToSend,
          `ENTRADA: S/ ${formatMontoExact(totalAmount)}`,
          `${service} - ${payMethod}`,
          `Operario: ${operator} | ${date} ${time}${obsClean ? ' (' + obsClean + ')' : ''}`
        );
      } catch (_) {}
    }

    const report = {
      id: 'sr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date,
      type: 'ENTRADA',
      amount: totalAmount,
      operator,
      service_number: service,
      payment_method: payMethod,
      observation: obsClean,
      concept: `${service} - ${payMethod}${obsClean ? ' (' + obsClean + ')' : ''}`,
      photo: photoToSend,
      time,
      second_operator: secondOp
    };
    const movement = { ...report, timestamp: Date.now() };

    // 1. Enviar a administración sin esperar, para no perder el gesto del usuario al compartir a WhatsApp.
    const delivery = deliverServiceReport(report);

    // 2. Guardar en localStorage de caja (compatible con reportes de administración)
    try {
      const store = JSON.parse(localStorage.getItem('splash-cash-records') || '{}');
      store[date] = store[date] || [];
      store[date].push(movement);
      localStorage.setItem('splash-cash-records', JSON.stringify(store));
    } catch (_) {}

    notifyCashRecord();

    const whatsappMessage = buildSrWhatsappText();

    // 3. Compartir inmediatamente mientras el gesto de clic del usuario está 100% activo
    if (sendToWhatsapp) {
      await shareSrToWhatsApp(movement, whatsappMessage);
    }

    const outcome = await delivery;
    if ($('sr-message')) {
      const messages = {
        sent: 'Servicio enviado a administración y registrado en caja.',
        queued: 'Sin conexión: el servicio quedó guardado y se enviará a administración automáticamente.',
        rejected: 'Administración no recibió el servicio. Revisa tu sesión e inténtalo de nuevo.'
      };
      $('sr-message').textContent = messages[outcome];
      $('sr-message').classList.toggle('is-success', outcome !== 'rejected');
    }
    flushPendingReports();

    // Resetear formulario para el siguiente servicio
    if ($('sr-amount-input')) $('sr-amount-input').value = '';
    if ($('sr-extra-input')) $('sr-extra-input').value = '';
    document.querySelectorAll('input[name="sr-payment"]').forEach(r => { r.checked = false; });
    document.querySelectorAll('.sr-payment-option').forEach(o => o.classList.remove('is-active'));
    if ($('sr-observation-input')) $('sr-observation-input').value = '';
    if ($('sr-second-operator-input')) $('sr-second-operator-input').value = '';
    if ($('sr-second-op-wrap')) $('sr-second-op-wrap').hidden = true;
    currentSrPhotoData = '';
    if ($('sr-photo-file')) $('sr-photo-file').value = '';
    if ($('sr-photo-preview-wrap')) $('sr-photo-preview-wrap').hidden = true;
    updateSrPreview();
  }

  async function shareSrToWhatsApp(movement, text) {
    const photoData = movement.photo || '';

    // 1. En APK Android con interfaz SplashAndroid nativa
    if (window.SplashAndroid?.shareToWhatsApp) {
      window.SplashAndroid.shareToWhatsApp(photoData, text);
      return;
    }
    // 2. Si corre en APK con interfaz SplashAdminNative
    if (window.SplashAdminNative?.shareToWhatsApp) {
      window.SplashAdminNative.shareToWhatsApp(photoData, text);
      return;
    }

    // 3. Web móvil con soporte Web Share API nativo (gesto activo, conversión síncrona de archivo)
    if (photoData) {
      try {
        const file = dataUrlToFile(photoData, `comprobante_${Date.now()}.jpg`);
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            text,
            title: 'Reporte de servicio - SPLASH SEDE LAS FLORES'
          });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }

      // Si navigator.share con archivos no está soportado o falló:
      // Descargamos la imagen automáticamente para que quede primera en la galería de WhatsApp
      try {
        const dl = document.createElement('a');
        dl.href = photoData;
        dl.download = `comprobante_servicio_${Date.now()}.jpg`;
        document.body.appendChild(dl);
        dl.click();
        document.body.removeChild(dl);
      } catch (_) {}
    }

    // 4. Enlace directo wa.me compatible con cualquier versión de navegador/WebView
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    try {
      window.location.href = waUrl;
    } catch (_) {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }
  }

  if ($('sr-submit-whatsapp')) $('sr-submit-whatsapp').addEventListener('click', () => submitServiceReport(true));
  if ($('sr-save-only')) $('sr-save-only').addEventListener('click', () => submitServiceReport(false));

  // =========================================================================
  // SISTEMA DE ACTUALIZACION DE LA APP DESDE LA MISMA APLICACION (Supabase)
  // =========================================================================
  const DEFAULT_APK_URL = 'https://raw.githubusercontent.com/Pauluwu18/sphash-sede-las-flores-app/main/SPLASH-Operarios.apk';
  let cachedLatestApkUrl = DEFAULT_APK_URL;

  function getCurrentVersionCode() {
    if (window.SplashAndroid) {
      if (typeof window.SplashAndroid.getAppVersion === 'function') {
        try {
          const v = Number(String(window.SplashAndroid.getAppVersion()).split(':').pop());
          if (!isNaN(v) && v > 0) return v;
        } catch (_) {}
      }
      // Tiene SplashAndroid pero no getAppVersion: es la APK v1.0 antigua
      return 1;
    }
    // Navegador web
    return 0;
  }

  function getCurrentVersionDisplay() {
    if (window.SplashAndroid) {
      if (typeof window.SplashAndroid.getAppVersion === 'function') {
        const raw = String(window.SplashAndroid.getAppVersion());
        const [name, code] = raw.includes(':') ? raw.split(':') : ['1.1', raw];
        return `v${name} (código ${code})`;
      }
      return 'v1.0 (antigua - actualización requerida)';
    }
    return 'Versión Web';
  }

  function triggerDownloadApk(url, isInstallAction = true) {
    const targetUrl = url || cachedLatestApkUrl || DEFAULT_APK_URL;

    // 1. Si está en la APK nueva con instalador nativo integrado:
    if (window.SplashAndroid?.downloadAndInstallApk) {
      try {
        window.SplashAndroid.downloadAndInstallApk(targetUrl);
        return;
      } catch (err) {
        console.warn('Error en SplashAndroid.downloadAndInstallApk:', err);
      }
    }

    // 2. Si está en la APK antigua (v1.0) o navegador web:
    if (isInstallAction) {
      try {
        window.open(targetUrl, '_blank');
      } catch (_) {}

      try {
        const a = document.createElement('a');
        a.href = targetUrl;
        a.download = 'SPLASH-Operarios.apk';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (_) {}

      // En WebView antiguo, window.location.href a un dominio externo (raw.githubusercontent.com)
      // dispara shouldOverrideUrlLoading y abre la descarga directamente en el sistema
      setTimeout(() => {
        try {
          window.location.href = targetUrl;
        } catch (_) {}
      }, 100);
    }
  }

  let updateAvailable = false;
  let lastApkUrl = '';
  let apkFallbackTried = false;

  function canAutoInstall() {
    try { return !!window.SplashAndroid?.canAutoInstall?.() && typeof window.SplashAndroid.downloadAndInstallApk === 'function'; }
    catch { return false; }
  }

  // La APK nativa informa el avance real de la descarga y abre sola el instalador al terminar.
  window.splashApkProgress = (state, done, total) => {
    const bar = $('updater-progress-bar');
    const percent = $('updater-progress-percent');
    const label = $('updater-progress-label');
    const detail = $('updater-progress-detail');
    const dlBtn = $('updater-download-btn');
    const installBtn = $('updater-install-btn');
    const installHint = $('updater-install-hint');
    const megabytes = bytes => (bytes / 1048576).toFixed(1);
    const pct = total > 0 ? Math.min(100, Math.floor(done * 100 / total)) : 0;
    if ($('updater-progress-wrap')) $('updater-progress-wrap').hidden = false;
    if (state === 'downloading') {
      if (label) label.textContent = 'Descargando actualización…';
      if (bar) bar.style.width = `${pct}%`;
      if (percent) percent.textContent = total > 0 ? `${pct}%` : '…';
      if (detail) detail.textContent = total > 0 ? `${megabytes(done)} MB de ${megabytes(total)} MB` : `${megabytes(done)} MB`;
    } else if (state === 'done') {
      if (label) label.textContent = '✅ Descarga completa. Abriendo instalador…';
      if (bar) { bar.style.width = '100%'; bar.style.background = '#27ae60'; }
      if (percent) percent.textContent = '100%';
      if (installBtn) {
        installBtn.hidden = false;
        installBtn.textContent = 'Instalar ahora';
        installBtn.onclick = () => window.SplashAndroid?.installDownloadedApk?.();
      }
      if (installHint) installHint.hidden = false;
    } else if (lastApkUrl && lastApkUrl !== DEFAULT_APK_URL && !apkFallbackTried) {
      // El enlace publicado puede estar roto (404); se prueba una vez con el enlace del repositorio.
      apkFallbackTried = true;
      runDownloadProgress(DEFAULT_APK_URL, undefined, true);
    } else {
      if (label) label.textContent = '❌ No se pudo descargar. Revisa tu conexión e inténtalo otra vez.';
      if (bar) bar.style.background = '#c0392b';
      if (dlBtn) dlBtn.hidden = false;
    }
  };

  function runDownloadProgress(targetUrl, onComplete, isFallback = false) {
    const wrap = $('updater-progress-wrap');
    const bar = $('updater-progress-bar');
    const percent = $('updater-progress-percent');
    const label = $('updater-progress-label');
    const detail = $('updater-progress-detail');
    const dlBtn = $('updater-download-btn');
    const installBtn = $('updater-install-btn');
    const installHint = $('updater-install-hint');

    if (dlBtn) dlBtn.hidden = true;
    if (wrap) wrap.hidden = false;
    if (installBtn) installBtn.hidden = true;
    if (installHint) installHint.hidden = true;

    if (canAutoInstall()) {
      if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
      if (percent) percent.textContent = '0%';
      if (label) label.textContent = 'Descargando actualización…';
      if (detail) detail.textContent = isFallback ? 'El enlace falló, probando el enlace alternativo…' : 'Iniciando…';
      lastApkUrl = targetUrl || cachedLatestApkUrl || DEFAULT_APK_URL;
      if (!isFallback) apkFallbackTried = false;
      try { window.SplashAndroid.downloadAndInstallApk(lastApkUrl); }
      catch { window.splashApkProgress('error', 0, 0); }
      return;
    }

    // Disparar descarga en segundo plano
    triggerDownloadApk(targetUrl, false);

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 14;
      if (progress > 100) progress = 100;

      const mb = (2.4 * (progress / 100)).toFixed(1);
      if (bar) bar.style.width = `${progress}%`;
      if (percent) percent.textContent = `${progress}%`;
      if (detail) detail.textContent = `${mb} MB de 2.4 MB`;

      if (progress >= 100) {
        clearInterval(interval);
        if (label) label.textContent = '✅ ¡Descarga completada!';
        if (bar) bar.style.background = '#27ae60';
        if (installBtn) {
          installBtn.hidden = false;
          installBtn.onclick = () => {
            triggerDownloadApk(targetUrl, true);
          };
        }
        if (installHint) installHint.hidden = false;
        if (typeof onComplete === 'function') onComplete();
      }
    }, 200);
  }

  async function checkAppVersionQuietly() {
    const currentCode = getCurrentVersionCode();
    try {
      const res = await fetch(`${Splash.url}/rest/v1/app_versions?app_name=eq.operarios&is_active=eq.true&order=version_code.desc&limit=1`, {
        headers: { apikey: Splash.key, Authorization: `Bearer ${Splash.key}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.length) return;
      const latest = data[0];
      if (latest.apk_url) cachedLatestApkUrl = latest.apk_url;

      if (latest.version_code > currentCode) {
        updateAvailable = true;
        if ($('updater-menu-subtitle')) {
          $('updater-menu-subtitle').textContent = `Versión v${latest.version_name} en vivo`;
        }
        if ($('header-update-btn')) {
          $('header-update-btn').textContent = `🔄 Actualizar app`;
        }
        if ($('worker-update-banner')) {
          $('worker-update-banner').hidden = false;
        }
      }
    } catch (_) {}
  }

  async function openAppUpdater(options = {}) {
    const dialog = $('app-updater-dialog');
    if (!dialog) return;
    dialog.showModal();

    const currentCode = getCurrentVersionCode();
    if ($('updater-cur-ver')) $('updater-cur-ver').textContent = getCurrentVersionDisplay();
    if ($('updater-status-text')) $('updater-status-text').textContent = '';
    if ($('updater-available-wrap')) $('updater-available-wrap').hidden = true;
    if ($('updater-up-to-date-wrap')) $('updater-up-to-date-wrap').hidden = true;
    if ($('updater-progress-wrap')) $('updater-progress-wrap').hidden = true;
    if ($('updater-install-btn')) $('updater-install-btn').hidden = true;
    if ($('updater-install-hint')) $('updater-install-hint').hidden = true;
    if ($('updater-download-btn')) $('updater-download-btn').hidden = false;

    if ($('updater-direct-link')) {
      $('updater-direct-link').href = cachedLatestApkUrl || DEFAULT_APK_URL;
      $('updater-direct-link').onclick = (e) => {
        e.preventDefault();
        runDownloadProgress(cachedLatestApkUrl || DEFAULT_APK_URL);
      };
    }

    try {
      const res = await fetch(`${Splash.url}/rest/v1/app_versions?app_name=eq.operarios&is_active=eq.true&order=version_code.desc&limit=1`, {
        headers: { apikey: Splash.key, Authorization: `Bearer ${Splash.key}` }
      });
      if (!res.ok) throw new Error('Tabla no disponible');
      const data = await res.json();
      if (!data || !data.length) {
        if ($('updater-up-to-date-wrap')) $('updater-up-to-date-wrap').hidden = false;
        return;
      }
      const latest = data[0];
      if (latest.apk_url) cachedLatestApkUrl = latest.apk_url;

      if (latest.version_code > currentCode) {
        if ($('updater-new-ver-title')) $('updater-new-ver-title').textContent = `Versión ${latest.version_name}`;
        if ($('updater-changelog-text')) $('updater-changelog-text').textContent = latest.changelog || 'Mejoras de rendimiento y nuevas funciones.';
        if ($('updater-available-wrap')) $('updater-available-wrap').hidden = false;

        const downloadBtn = $('updater-download-btn');
        if (downloadBtn) {
          downloadBtn.onclick = () => runDownloadProgress(latest.apk_url);
        }
        if (options.autoStart === true && canAutoInstall()) runDownloadProgress(latest.apk_url);
      } else {
        if ($('updater-up-to-date-wrap')) $('updater-up-to-date-wrap').hidden = false;
      }
    } catch (_) {
      // Si la tabla no existe aún en Supabase, muestra la versión v1.1 disponible sin mostrar error
      if ($('updater-available-wrap')) $('updater-available-wrap').hidden = false;
      if ($('updater-new-ver-title')) $('updater-new-ver-title').textContent = 'Versión 1.1 disponible';
      if ($('updater-changelog-text')) $('updater-changelog-text').textContent = 'Reporte de servicios con fotos para WhatsApp y caja, selector de pago y actualizador.';
      const downloadBtn = $('updater-download-btn');
      if (downloadBtn) downloadBtn.onclick = () => runDownloadProgress(DEFAULT_APK_URL);
    }
  }

  if ($('open-updater')) $('open-updater').addEventListener('click', () => openAppUpdater({ autoStart: updateAvailable }));
  if ($('header-update-btn')) $('header-update-btn').addEventListener('click', () => openAppUpdater({ autoStart: updateAvailable }));
  if ($('worker-update-banner-btn')) $('worker-update-banner-btn').addEventListener('click', () => openAppUpdater({ autoStart: true }));
  if ($('login-download-apk-btn')) $('login-download-apk-btn').addEventListener('click', () => runDownloadProgress(DEFAULT_APK_URL));
  if ($('updater-redownload-btn')) $('updater-redownload-btn').addEventListener('click', () => runDownloadProgress(cachedLatestApkUrl || DEFAULT_APK_URL));
  if ($('updater-dialog-close')) $('updater-dialog-close').addEventListener('click', () => $('app-updater-dialog')?.close());

  // =========================================================================

  async function logout() {
    stopCamera();
    stopSrLiveCamera();
    try { await Splash.call('logout', {}, 'worker'); } catch { /* La sesión local se elimina igualmente. */ }
    sessionStorage.removeItem('splash-worker-session');
    localStorage.removeItem('splash-worker-session');
    currentWorker = null;
    if (window.splashTutor?.syncVisibility) window.splashTutor.syncVisibility();
    location.replace('operarios.html');
  }
  if ($('worker-logout')) $('worker-logout').addEventListener('click', logout);
  if ($('checkin-switch-user-btn')) $('checkin-switch-user-btn').addEventListener('click', logout);
  window.addEventListener('splash-session-expired', event => {
    if (event.detail !== 'worker') return;
    stopCamera();
    stopSrLiveCamera();
    if ($('worker-home')) $('worker-home').hidden = true;
    if ($('worker-login')) $('worker-login').hidden = false;
    if ($('worker-login-message')) $('worker-login-message').textContent = 'Tu sesión venció. Vuelve a iniciar sesión.';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopCamera(); stopSrLiveCamera(); } });
  window.addEventListener('splash-native-pause', () => { stopCamera(); stopSrLiveCamera(); });
  window.addEventListener('pagehide', () => { stopCamera(); stopSrLiveCamera(); });
  window.addEventListener('hashchange', () => {
    const candidate = Splash.readQR(location.href);
    history.replaceState(null, '', location.pathname + location.search);
    if (candidate) { qrToken = candidate; if ($('worker-home') && !$('worker-home').hidden) showCheckin(); }
  });
  const refreshHistory = () => { if (typeof document !== 'undefined' && document && !document.hidden && typeof $ === 'function' && $('history-panel') && !$('history-panel').hidden && $('worker-home') && !$('worker-home').hidden) loadHistory(); };
  const stopWatching = Splash.watchAttendance(refreshHistory);
  const historyInterval = setInterval(refreshHistory, 3000);
  window.addEventListener('pagehide', () => {
    stopWatching();
    clearInterval(historyInterval);
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'splash-worker-session') return;
    stopCamera();
    stopSrLiveCamera();
    if (event.newValue) location.reload();
    else {
      if ($('worker-home')) $('worker-home').hidden = true;
      if ($('worker-login')) $('worker-login').hidden = false;
      if ($('worker-login-message')) $('worker-login-message').textContent = 'La sesión se cerró. Ingresa nuevamente para continuar.';
      if ($('worker-history')) $('worker-history').replaceChildren();
    }
  });
  if (localStorage.getItem('splash-worker-session')) enter().catch(error => { if ($('worker-login-message')) $('worker-login-message').textContent = error.message; });
})();
