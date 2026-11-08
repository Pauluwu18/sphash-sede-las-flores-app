(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (reply) => resolve(reply || { ok: false, error: 'Sin respuesta de la extensión.' })));
  const say = (text, ok) => { $('message').textContent = text || ''; $('message').className = ok === undefined ? '' : ok ? 'ok' : 'bad'; };

  async function refresh() {
    const status = await send({ type: 'status' });
    $('login-form').hidden = !!status.loggedIn;
    $('session').hidden = !status.loggedIn;
    if (!status.loggedIn) return;
    const until = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString('es-PE') : '';
    const last = status.last
      ? `Última agenda enviada: ${status.last.date} · ${status.last.count} servicios · ${new Date(status.last.at).toLocaleString('es-PE')}`
      : 'Aún no se envió ninguna agenda.';
    $('status').textContent = `Conectado como ${status.username}${until ? ` (hasta ${until})` : ''}. ${last}`;
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    say('Iniciando sesión…');
    const reply = await send({ type: 'login', username: $('user').value, password: $('pass').value });
    $('pass').value = '';
    if (reply.ok) { say('Sesión iniciada.', true); refresh(); } else say(reply.error, false);
  });

  $('logout').addEventListener('click', async () => { await send({ type: 'logout' }); say('Sesión cerrada.', true); refresh(); });

  $('file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    say('Leyendo el Excel…');
    try {
      const parsed = await SplashAgendaParser.parseBuffer(await file.arrayBuffer(), ExcelJS);
      const reply = await send({ type: 'upload', payload: { date: parsed.date, source: 'popup', services: parsed.services } });
      if (reply.ok) { say(`Agenda del ${reply.date} enviada: ${reply.count} servicios.`, true); refresh(); }
      else say(reply.error || 'No se pudo enviar.', false);
    } catch (error) { say(error.message, false); }
    finally { $('file').value = ''; }
  });

  refresh();
})();
