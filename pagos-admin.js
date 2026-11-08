/* Panel admin "Pagos por servicio": resumen semanal con gráfica y pago por servicio editable. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('pay-week-button') || !window.Splash || !window.SplashCharts) return;
  const C = window.SplashCharts;
  let weekStart = null;
  let currentMonday = null;
  let people = [];
  let loading = 0;

  async function load() {
    const ticket = ++loading;
    $('pay-week-message').textContent = 'Cargando…';
    try {
      const data = await Splash.adminWeek(weekStart);
      if (ticket !== loading) return;
      if (weekStart === null) currentMonday = data.week_start;
      people = data.people;
      render(data);
      $('pay-week-message').textContent = '';
    } catch (error) {
      if (ticket !== loading) return;
      $('pay-week-message').textContent = error.message;
    }
  }

  function render(data) {
    $('pay-week-label').textContent = C.weekLabel(data.week_start, data.week_end) + (data.week_start === currentMonday ? ' (esta semana)' : '');
    $('pay-week-next').disabled = data.week_start >= currentMonday;
    const ranked = [...data.people].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    $('pay-week-chart').innerHTML = ranked.length
      ? C.hbars(ranked.map((p) => ({ label: p.name, value: p.total, tip: `${p.name}: ${p.services} servicio${p.services === 1 ? '' : 's'} × ${C.money(p.rate)} = ${C.money(p.total)}` })), { title: 'Ganancia de la semana por operario', format: (n) => C.money(n) })
      : '<p class="worker-help">No hay personal activo.</p>';
    $('pay-week-table').querySelector('tbody').innerHTML = ranked.map((p) =>
      `<tr style="border-top:1px solid #dbe7ea"><td style="padding:6px 4px">${C.esc(p.name)}</td>`
      + `<td style="padding:6px 4px;text-align:right">${p.services}</td>`
      + `<td style="padding:6px 4px;text-align:right"><input type="number" min="0" max="9999.99" step="0.5" value="${p.rate}" data-rate="${p.id}" aria-label="Pago por servicio de ${C.esc(p.name)}" style="width:84px;height:36px;text-align:right;padding:0 8px;border:1px solid #bfdde0;border-radius:8px"></td>`
      + `<td style="padding:6px 4px;text-align:right;font-weight:700" data-total="${p.id}">${C.money(p.total)}</td></tr>`
    ).join('');
    const sumServices = data.people.reduce((n, p) => n + p.services, 0);
    const sumTotal = data.people.reduce((n, p) => n + p.total, 0);
    $('pay-week-table').querySelector('tfoot').innerHTML =
      `<tr style="border-top:2px solid #102f49;font-weight:700"><td style="padding:8px 4px">Total</td><td style="padding:8px 4px;text-align:right">${sumServices}</td><td></td><td style="padding:8px 4px;text-align:right">${C.money(sumTotal)}</td></tr>`;
  }

  async function saveRate(input) {
    const id = input.dataset.rate;
    const person = people.find((p) => p.id === id);
    const rate = Number(input.value);
    if (!person || !Number.isFinite(rate) || rate < 0 || rate > 9999.99) {
      $('pay-week-message').textContent = 'Escribe un pago entre 0 y 9999.99.';
      if (person) input.value = person.rate;
      return;
    }
    if (rate === Number(person.rate)) return;
    input.disabled = true;
    try {
      await Splash.setServiceRate(id, rate);
      await load();
      $('pay-week-message').textContent = `Pago de ${person.name} actualizado a ${C.money(rate)} por servicio.`;
    } catch (error) {
      $('pay-week-message').textContent = error.message;
      input.value = person.rate;
    } finally { input.disabled = false; }
  }

  $('pay-week-button').addEventListener('click', () => {
    weekStart = null;
    $('pay-week-dialog').showModal();
    load();
  });
  $('pay-week-close').addEventListener('click', () => $('pay-week-dialog').close());
  $('pay-week-prev').addEventListener('click', () => { weekStart = C.addDays(weekStart || currentMonday, -7); load(); });
  $('pay-week-next').addEventListener('click', () => {
    const next = C.addDays(weekStart || currentMonday, 7);
    weekStart = next >= currentMonday ? null : next;
    load();
  });
  $('pay-week-table').addEventListener('change', (event) => { if (event.target.matches('[data-rate]')) saveRate(event.target); });
  $('pay-week-table').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-rate]')) { event.preventDefault(); event.target.blur(); }
  });
})();
