/* Aviso al operario: servicios de la agenda de hoy que todavía no reportó. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('pending-banner') || !window.Splash) return;
  const POLL_MS = 3 * 60 * 1000;
  let lastNotified = '';
  let timer = null;

  const loggedIn = () => !!localStorage.getItem('splash-worker-session') && $('worker-home') && !$('worker-home').hidden;

  function notify(title, body) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, icon: 'icon.png', tag: 'splash-pendientes' });
    } catch { /* la notificación nunca debe romper la app */ }
  }

  function render(data) {
    const pending = data.pending || 0;
    $('pending-banner').hidden = pending <= 0;
    if (pending <= 0) { lastNotified = ''; return; }
    const plural = pending === 1 ? '' : 's';
    $('pending-banner-title').textContent = `⚠ ${pending} servicio${plural} pendiente${plural} por reportar`;
    const districts = (data.services || []).map((s) => s.district).filter(Boolean).slice(0, 4).join(', ');
    $('pending-banner-text').textContent = `Hoy tienes ${data.agenda} servicio${data.agenda === 1 ? '' : 's'} en la agenda y reportaste ${data.reported}.${districts ? ` Agenda: ${districts}.` : ''} Repórtalo${plural ? 's' : ''} con foto y método de pago.`;
    const key = `${data.date}:${pending}`;
    if (key !== lastNotified) {
      lastNotified = key;
      notify('Servicio pendiente por reportar', `Tienes ${pending} servicio${plural} sin reportar hoy.`);
    }
  }

  async function check() {
    if (!loggedIn() || document.hidden) return;
    try { render(await Splash.workerPending()); }
    catch { /* sin migración, sin agenda o sin conexión: no se muestra aviso */ }
  }

  // El permiso de notificaciones solo se puede pedir tras un toque del usuario.
  document.addEventListener('pointerdown', () => {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* sin soporte */ }
  }, { once: true });

  $('pending-banner-action').addEventListener('click', () => { if ($('open-service-report')) $('open-service-report').click(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
  window.addEventListener('splash-reported', check);
  setTimeout(check, 2500);
  timer = setInterval(check, POLL_MS);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
