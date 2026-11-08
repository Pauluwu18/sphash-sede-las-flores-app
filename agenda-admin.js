/* Panel admin "Servicios pendientes": agenda del día vs. servicios reportados, por operario. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('agenda-pending-button') || !window.Splash) return;
  const esc = (v) => Splash.escape(v);
  const money = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 })}`;
  let day = null; // yyyy-mm-dd; null = hoy (Lima)
  let todayIso = null;
  let ticket = 0;
  let people = [];
  let timer = null;

  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  async function load(silent) {
    const mine = ++ticket;
    if (!silent) $('agenda-message').textContent = 'Cargando…';
    try {
      const data = await Splash.agendaPending(day);
      if (mine !== ticket) return null;
      if (day === null) todayIso = data.date;
      $('agenda-date').value = data.date;
      render(data);
      if (!silent) $('agenda-message').textContent = '';
      return data;
    } catch (error) {
      if (mine === ticket && !silent) $('agenda-message').textContent = error.message;
      return null;
    }
  }

  function setBadge(count) {
    const badge = $('agenda-pending-badge');
    badge.hidden = !count;
    badge.textContent = count ? String(count) : '';
  }

  function render(data) {
    if (data.date === (todayIso || data.date)) setBadge(data.total_pending);
    const when = data.uploaded_at ? new Date(data.uploaded_at).toLocaleString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    $('agenda-summary').textContent = !data.operators.length
      ? 'No hay agenda subida para este día. Exporta el Excel desde la agenda (con la extensión activa) o súbelo aquí.'
      : `${data.total_pending} pendiente${data.total_pending === 1 ? '' : 's'} por reportar · agenda subida ${when}${data.unassigned ? ` · ${data.unassigned} servicio${data.unassigned === 1 ? '' : 's'} sin operario asignado` : ''}`;
    const ordered = [...data.operators].sort((a, b) => b.pending - a.pending || a.operator.localeCompare(b.operator));
    $('agenda-table').querySelector('tbody').innerHTML = ordered.map((o, index) => {
      const badge = o.pending > 0
        ? `<span style="background:#fdecea;color:#a32619;font-weight:700;border-radius:999px;padding:2px 10px">⚠ ${o.pending}</span>`
        : '<span style="background:#dff5ed;color:#155a43;font-weight:700;border-radius:999px;padding:2px 10px">✓ 0</span>';
      const name = o.person_name ? `${esc(o.person_name)} <small style="color:#627d8d">(${esc(o.operator)})</small>` : esc(o.operator);
      const link = o.linked ? '' : `<div style="margin-top:4px"><small style="color:#a32619">Sin vincular a una persona registrada:</small> <select data-link-select="${index}" aria-label="Vincular ${esc(o.operator)}" style="height:30px;max-width:180px"><option value="">Elegir…</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select> <button type="button" class="secondary-action" data-link-button="${index}" style="padding:2px 10px">Vincular</button></div>`;
      const list = (o.services || []).map((s) => `${esc(s.slot)} · ${esc(s.district || '—')} · ${money(s.amount)}${s.extra ? ` + extra ${money(s.extra)}` : ''} · ${esc(s.payment_method || '—')}`).join('<br>');
      return `<tr style="border-top:1px solid #dbe7ea"><td style="padding:8px 4px">${name}${link}<details><summary style="cursor:pointer;color:#006b73;font-size:.82rem">Ver servicios de la agenda</summary><div style="font-size:.82rem;color:#456;padding:4px 0">${list}</div></details></td><td style="padding:8px 4px;text-align:right">${o.agenda}</td><td style="padding:8px 4px;text-align:right">${o.reported}</td><td style="padding:8px 4px;text-align:right">${badge}</td></tr>`;
    }).join('');
    $('agenda-table').dataset.operators = JSON.stringify(ordered.map((o) => o.operator));
  }

  async function ensurePeople() {
    if (people.length) return;
    try { people = (await Splash.call('people')).filter((p) => p.active); } catch { people = []; }
  }

  async function open() {
    await ensurePeople();
    day = null;
    $('agenda-pending-dialog').showModal();
    await load();
    clearInterval(timer);
    timer = setInterval(() => { if ($('agenda-pending-dialog').open) load(true); }, 60000);
  }

  async function uploadFile(file) {
    $('agenda-message').textContent = 'Leyendo el Excel…';
    try {
      if (!window.ExcelJS || !window.SplashAgendaParser) throw new Error('No se cargó el lector de Excel.');
      const parsed = await SplashAgendaParser.parseBuffer(await file.arrayBuffer(), window.ExcelJS);
      const result = await Splash.agendaUpload({ date: parsed.date, source: 'panel', services: parsed.services });
      day = parsed.date;
      await load(true);
      $('agenda-message').textContent = `Agenda del ${parsed.date} subida: ${result.count} servicios.${result.unlinked?.length ? ` Sin vincular: ${result.unlinked.join(', ')}.` : ''}`;
    } catch (error) { $('agenda-message').textContent = error.message; }
    finally { $('agenda-file').value = ''; }
  }

  $('agenda-pending-button').addEventListener('click', open);
  $('agenda-pending-close').addEventListener('click', () => { $('agenda-pending-dialog').close(); clearInterval(timer); });
  $('agenda-refresh').addEventListener('click', () => load());
  $('agenda-prev').addEventListener('click', () => { day = addDays($('agenda-date').value || todayIso, -1); load(); });
  $('agenda-next').addEventListener('click', () => { day = addDays($('agenda-date').value || todayIso, 1); load(); });
  $('agenda-date').addEventListener('change', () => { day = $('agenda-date').value || null; load(); });
  $('agenda-file').addEventListener('change', (event) => { if (event.target.files[0]) uploadFile(event.target.files[0]); });
  $('agenda-table').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-link-button]');
    if (!button) return;
    const index = Number(button.dataset.linkButton);
    const select = $('agenda-table').querySelector(`[data-link-select="${index}"]`);
    const operator = JSON.parse($('agenda-table').dataset.operators || '[]')[index];
    if (!select?.value || !operator) { $('agenda-message').textContent = 'Elige la persona registrada a la que corresponde.'; return; }
    try { await Splash.agendaLink(operator, select.value); await load(); $('agenda-message').textContent = `${operator} vinculado.`; }
    catch (error) { $('agenda-message').textContent = error.message; }
  });

  // Insignia en el menú: pendientes de hoy, sin abrir el panel.
  async function refreshBadge() {
    if (!Splash.adminSession() || ($('agenda-pending-dialog') && $('agenda-pending-dialog').open)) return;
    try { const data = await Splash.agendaPending(null); todayIso = data.date; setBadge(data.total_pending); } catch { /* sin migración o sin sesión: sin insignia */ }
  }
  setTimeout(refreshBadge, 4000);
  setInterval(refreshBadge, 5 * 60000);
})();
