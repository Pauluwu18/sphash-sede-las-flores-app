(() => {
  const $ = id => document.getElementById(id);
  let activating = false;
  let qrToken = Splash.readQR(location.href);
  let stream = null;
  let frame = null;
  let scanGeneration = 0;
  let saving = false;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // El token del QR permanece solo en memoria; no se guarda en almacenamiento.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  function stopCamera() {
    scanGeneration++;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    $('qr-video').srcObject = null;
    $('qr-video').hidden = true;
    $('stop-camera').hidden = true;
    $('start-camera').disabled = false;
  }

  function showCheckin() {
    $('checkin-panel').hidden = false;
    $('history-panel').hidden = true;
    $('confirm-checkin').hidden = !qrToken;
    $('start-camera').hidden = !!qrToken;
    $('checkin-message').textContent = qrToken ? 'QR reconocido. Confirma para registrar tu llegada.' : '';
  }

  async function enter() {
    const me = await Splash.call('me', {}, 'worker');
    $('worker-name').textContent = `Hola, ${me.name}`;
    $('worker-login').hidden = true;
    $('worker-home').hidden = false;
    $('worker-pin').value = '';
    $('worker-pin-confirm').value = '';
    if (qrToken) showCheckin();
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
      sessionStorage.setItem('splash-worker-session', result.token);
      await enter();
    } catch (error) { $('worker-login-message').textContent = error.message; }
    finally { $('worker-submit').disabled = false; }
  });

  $('open-checkin').addEventListener('click', showCheckin);
  async function loadHistory() {
    try {
      const records = await Splash.call('my_attendance', {}, 'worker');
      $('worker-history').innerHTML = records.map(row => {
        const [year, month, day] = row.date.split('-');
        return `<div class="worker-attendance-row"><div><strong>${day}/${month}/${year}</strong><small>${Splash.escape(row.source)}</small></div><strong>${Splash.escape(row.time)}</strong></div>`;
      }).join('');
      $('worker-history-message').textContent = records.length ? `${records.length} asistencia(s) registrada(s).` : 'Aún no tienes asistencias registradas.';
    } catch (error) { $('worker-history-message').textContent = error.message; }
  }
  $('open-history').addEventListener('click', () => {
    stopCamera();
    $('checkin-panel').hidden = true;
    $('history-panel').hidden = false;
    $('worker-history-message').textContent = 'Consultando tus asistencias…';
    loadHistory();
  });

  $('start-camera').addEventListener('click', async () => {
    stopCamera();
    const generation = scanGeneration;
    $('start-camera').disabled = true;
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
      $('checkin-message').textContent = 'Apunta la cámara al QR de la base.';
      function scan() {
        if (!stream || generation !== scanGeneration) return;
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
      }
      scan();
    } catch (error) {
      stopCamera();
      $('checkin-message').textContent = error.name === 'NotAllowedError' ? 'Permite el acceso a la cámara o abre el QR desde la cámara del teléfono.' : error.message;
    }
  });
  $('stop-camera').addEventListener('click', stopCamera);
  $('confirm-checkin').addEventListener('click', async () => {
    if (saving || !qrToken) return;
    saving = true;
    $('confirm-checkin').disabled = true;
    try {
      const result = await Splash.call('checkin', { qr: qrToken }, 'worker');
      $('checkin-message').textContent = result.message;
      qrToken = '';
      $('confirm-checkin').hidden = true;
      $('start-camera').hidden = false;
    } catch (error) { $('checkin-message').textContent = `${error.message} No se ha confirmado la asistencia.`; }
    finally { saving = false; $('confirm-checkin').disabled = false; }
  });

  async function logout() {
    stopCamera();
    try { await Splash.call('logout', {}, 'worker'); } catch { /* La sesión local se elimina igualmente. */ }
    sessionStorage.removeItem('splash-worker-session');
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
  if (sessionStorage.getItem('splash-worker-session')) enter().catch(error => { $('worker-login-message').textContent = error.message; });
})();
