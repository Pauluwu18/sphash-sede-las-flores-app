/* Recibe el Excel detectado por content-hook.js, lo convierte con el lector de la agenda y lo
   manda a administración (a través del background). Muestra un aviso breve en la página. */
(function () {
  'use strict';
  const seen = new Map(); // huella -> momento, para no subir dos veces el mismo archivo

  function toast(text, ok) {
    let box = document.getElementById('splash-agenda-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'splash-agenda-toast';
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:340px;padding:12px 16px;border-radius:12px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px #0006;color:#fff';
      document.documentElement.appendChild(box);
    }
    box.style.background = ok ? '#15803d' : '#b91c1c';
    box.textContent = text;
    clearTimeout(box.__timer);
    box.__timer = setTimeout(() => box.remove(), 9000);
  }

  function fingerprint(bytes) {
    let hash = bytes.length;
    for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 64))) hash = (hash * 31 + bytes[i]) >>> 0;
    return String(hash);
  }

  async function handle(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 200 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return; // no es un .xlsx (zip)
    const key = fingerprint(bytes);
    const now = Date.now();
    if (seen.has(key) && now - seen.get(key) < 15000) return;
    seen.set(key, now);

    let parsed;
    try { parsed = await SplashAgendaParser.parseBuffer(buffer, ExcelJS); }
    catch (error) { console.debug('[SPLASH Agenda] archivo ignorado:', error.message); return; } // otro Excel, no la agenda
    if (!parsed.services.length) { toast('Agenda sin servicios: no se envió nada.', false); return; }

    toast(`Enviando agenda del ${parsed.date} (${parsed.services.length} servicios)…`, true);
    chrome.runtime.sendMessage({ type: 'upload', payload: { date: parsed.date, source: 'extension', services: parsed.services } }, (reply) => {
      if (chrome.runtime.lastError || !reply) { toast('No se pudo enviar la agenda. Revisa tu conexión.', false); return; }
      if (reply.ok) {
        const missing = reply.unlinked && reply.unlinked.length ? ` Sin vincular: ${reply.unlinked.join(', ')}.` : '';
        toast(`Agenda del ${reply.date} enviada a administración: ${reply.count} servicios.${missing}`, true);
      } else if (reply.code === 'SESSION' || reply.code === 'NO_SESSION') {
        toast('Inicia sesión como administrador en el icono de la extensión SPLASH Agenda.', false);
      } else {
        toast(`No se envió la agenda: ${reply.error || 'error desconocido'}`, false);
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'splash-agenda-hook' || !(data.buffer instanceof ArrayBuffer)) return;
    handle(data.buffer).catch((error) => console.debug('[SPLASH Agenda]', error));
  });
})();
