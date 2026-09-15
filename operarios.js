(() => {
  const $ = id => document.getElementById(id);
  let activating = false;
  let qrToken = Splash.readQR(location.href);
  let stream = null;
  let frame = null;
  let scanGeneration = 0;
  let saving = false;
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
    $('qr-video').srcObject = null;
    $('qr-video').hidden = true;
    $('stop-camera').hidden = true;
    $('start-camera').disabled = false;
    $('start-camera').hidden = !!qrToken;
    $('start-camera').textContent = 'Abrir cámara';
    scannerState('idle', 'Tu cámara aparecerá aquí', 'Cámara apagada');
  }

  function scannerState(state, caption, badge) {
    $('scanner-viewport').dataset.state = state;
    $('scanner-placeholder').hidden = state === 'live';
    $('scanner-caption').textContent = caption;
    $('scanner-badge').textContent = badge;
  }

  function cameraError(error) {
    stopCamera();
    const messages = {
      NotAllowedError: 'Permite el acceso a la cámara en los ajustes del sitio o de la app. Si ya lo bloqueaste, pulsar el botón otra vez no cambia ese permiso.',
      NotFoundError: 'No se encontró una cámara. Prueba «Tomar foto del QR» o abre el enlace en el navegador de tu teléfono.',
      NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
      TimeoutError: 'La cámara no respondió. Revisa si hay una solicitud de permiso pendiente o usa «Tomar foto del QR».'
    };
    $('checkin-message').textContent = messages[error.name] || error.message || 'No se pudo abrir la cámara. Revisa la guía inferior.';
    $('camera-help').open = true;
    scannerState('error', 'No pudimos abrir la cámara', 'Revisa los permisos');
    $('start-camera').textContent = 'Volver a intentar';
  }

  function showCheckin() {
    $('checkin-panel').hidden = false;
    $('history-panel').hidden = true;
    $('confirm-checkin').hidden = !qrToken;
    $('start-camera').hidden = !!qrToken;
    $('checkin-message').textContent = qrToken ? 'QR reconocido. Confirma para registrar tu llegada.' : '';
    $('checkin-message').classList.remove('is-success');
    $('checkin-history-link').hidden = true;
    setStep(qrToken ? 'confirm' : 'camera');
    if (qrToken) scannerState('ready', 'QR reconocido', 'Listo para confirmar');
  }

  function setStep(step) {
    for (const name of ['camera', 'code', 'confirm']) {
      const item = $(`scan-step-${name}`);
      if (name === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
  }

  async function enter() {
    const me = await Splash.call('me', {}, 'worker');
    historyRecords = [];
    $('worker-history').replaceChildren();
    $('history-panel').hidden = true;
    $('checkin-panel').hidden = true;
    $('worker-name').textContent = `Hola, ${me.name}`;
    $('worker-login').hidden = true;
    $('worker-home').hidden = false;
    $('worker-pin').value = '';
    $('worker-pin-confirm').value = '';
    activating = false;
    $('worker-dni').readOnly = false;
    $('pin-confirm-wrap').hidden = true;
    $('worker-pin-confirm').required = false;
    $('worker-submit').textContent = 'Iniciar sesión';
    $('worker-pin').autocomplete = 'current-password';
    const separatePage = view === 'scan' || view === 'history' || !!qrToken;
    $('worker-menu').hidden = separatePage;
    $('worker-menu-hint').hidden = separatePage;
    $('worker-back').hidden = !separatePage;
    if (qrToken || view === 'scan') {
      showCheckin();
      document.title = 'Escanear QR · SPLASH';
    } else if (view === 'history') {
      $('history-panel').hidden = false;
      $('checkin-panel').hidden = true;
      document.title = 'Mis asistencias · SPLASH';
      await loadHistory();
    }
  }

  $('worker-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('worker-submit').disabled = true;
    $('worker-login-message').textContent = '';
    try {
      const dni = $('worker-dni').value.trim();
      const pin = $('worker-pin').value;
      if (activating && (pin !== $('worker-pin-confirm').value || !/^\d{4}$/.test(pin))) throw new Error('Escribe el mismo PIN de 4 dígitos en ambos campos.');
      const result = await Splash.call(activating ? 'activate' : 'worker_login', { dni, pin, qr: qrToken }, 'worker');
      if (result.needs_pin) {
        if (!qrToken) throw new Error('Tu cuenta está lista. Escanea el QR físico de la base con la cámara de tu teléfono para crear tu PIN.');
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

  function renderHistory() {
    const month = $('worker-month').value;
    const rows = historyRecords.filter(row => !month || row.date.startsWith(month));
    $('history-total').textContent = String(rows.length);
    $('history-latest').textContent = historyRecords.length ? historyRecords[0].date.split('-').reverse().join('/') : 'Sin registros';
    $('worker-history').innerHTML = rows.map(row => {
      const [year, month, day] = row.date.split('-');
      const weekday = new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${row.date}T12:00:00Z`));
      return `<article class="worker-attendance-row"><div><small class="attendance-weekday">${Splash.escape(weekday)}</small><strong>${day}/${month}/${year}</strong><small>${row.source === 'QR' ? 'Registrada con QR' : 'Registrada por administración'}</small></div><div class="attendance-time"><small>Hora de llegada</small><strong>${Splash.escape(row.time)}</strong><span>Registrada</span></div></article>`;
    }).join('');
    $('worker-history-message').textContent = rows.length ? 'Tus asistencias están actualizadas.' : month ? 'No tienes asistencias registradas en este mes. Puedes elegir otro mes o ver todas.' : 'Aún no tienes asistencias. Escanea el QR de la base para registrar tu primera llegada.';
  }
  async function loadHistory() {
    if (historyLoading) return;
    historyLoading = true;
    $('history-refresh').disabled = true;
    try {
      historyRecords = (await Splash.call('my_attendance', {}, 'worker')).sort((a, b) => b.date.localeCompare(a.date));
      renderHistory();
    } catch (error) { $('worker-history-message').textContent = `No se pudo actualizar: ${error.message}`; }
    finally { historyLoading = false; $('history-refresh').disabled = false; }
  }
  $('worker-month').addEventListener('change', renderHistory);
  $('history-all').addEventListener('click', () => { $('worker-month').value = ''; renderHistory(); });
  $('history-refresh').addEventListener('click', loadHistory);

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
  $('stop-camera').addEventListener('click', () => { stopCamera(); setStep('camera'); $('checkin-message').textContent = 'Cámara cerrada. Pulsa «Abrir cámara» para volver a escanear.'; });
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
  $('confirm-checkin').addEventListener('click', async () => {
    if (saving || !qrToken) return;
    saving = true;
    $('confirm-checkin').disabled = true;
    try {
      const result = await Splash.call('checkin', { qr: qrToken }, 'worker');
      $('checkin-message').textContent = result.message;
      $('checkin-message').classList.add('is-success');
      $('checkin-history-link').hidden = false;
      scannerState('success', result.already ? 'Ya registraste tu llegada' : 'Asistencia registrada', 'Registro confirmado');
      qrToken = '';
      $('confirm-checkin').hidden = true;
      $('start-camera').hidden = true;
    } catch (error) { $('checkin-message').textContent = `${error.message} No se ha confirmado la asistencia.`; }
    finally { saving = false; $('confirm-checkin').disabled = false; }
  });

  async function logout() {
    stopCamera();
    try { await Splash.call('logout', {}, 'worker'); } catch { /* La sesión local se elimina igualmente. */ }
    sessionStorage.removeItem('splash-worker-session');
    localStorage.removeItem('splash-worker-session');
    location.replace('operarios.html');
  }
  $('worker-logout').addEventListener('click', logout);
  window.addEventListener('splash-session-expired', event => {
    if (event.detail !== 'worker') return;
    stopCamera();
    $('worker-home').hidden = true;
    $('worker-login').hidden = false;
    $('worker-login-message').textContent = 'Tu sesión venció. Vuelve a iniciar sesión.';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);
  window.addEventListener('hashchange', () => {
    const candidate = Splash.readQR(location.href);
    history.replaceState(null, '', location.pathname + location.search);
    if (candidate) { qrToken = candidate; if (!$('worker-home').hidden) showCheckin(); }
  });
  const refreshHistory = () => { if (!document.hidden && !$('history-panel').hidden && !$('worker-home').hidden) loadHistory(); };
  const stopWatching = Splash.watchAttendance(refreshHistory);
  window.addEventListener('pagehide', stopWatching);
  setInterval(refreshHistory, 3000);
  window.addEventListener('storage', event => {
    if (event.key !== 'splash-worker-session') return;
    stopCamera();
    if (event.newValue) location.reload();
    else {
      $('worker-home').hidden = true;
      $('worker-login').hidden = false;
      $('worker-login-message').textContent = 'La sesión se cerró. Ingresa nuevamente para continuar.';
      $('worker-history').replaceChildren();
    }
  });
  if (localStorage.getItem('splash-worker-session')) enter().catch(error => { $('worker-login-message').textContent = error.message; });
})();
