/* Panel "Mi semana" del operario: servicios, pago por servicio y ganancias con gráficas. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('open-week') || !window.Splash || !window.SplashCharts) return;
  const C = window.SplashCharts;
  let weekStart = null; // null = semana actual (la fija el servidor, hora de Lima)
  let currentMonday = null;
  let loading = 0;

  function showPanel() {
    ['checkin-panel', 'history-panel', 'service-report-panel'].forEach((id) => { if ($(id)) $(id).hidden = true; });
    if ($('worker-menu')) $('worker-menu').hidden = true;
    if ($('worker-menu-hint')) $('worker-menu-hint').hidden = true;
    if ($('worker-back')) $('worker-back').hidden = false;
    $('week-panel').hidden = false;
    document.title = 'Mi semana · SPLASH';
    weekStart = null;
    load();
  }

  async function load() {
    const ticket = ++loading;
    $('week-message').textContent = 'Cargando…';
    try {
      const data = await Splash.workerWeek(weekStart);
      if (ticket !== loading) return;
      render(data);
      $('week-message').textContent = '';
    } catch (error) {
      if (ticket !== loading) return;
      $('week-message').textContent = error.message;
    }
  }

  function render(data) {
    if (weekStart === null) currentMonday = data.week_start;
    $('week-label').textContent = C.weekLabel(data.week_start, data.week_end) + (data.week_start === currentMonday ? ' (esta semana)' : '');
    $('week-next').disabled = data.week_start >= currentMonday;
    $('week-services').textContent = data.services;
    $('week-rate').textContent = C.money(data.rate);
    $('week-total').textContent = C.money(data.total);

    const days = data.days.map((d, i) => ({
      label: `${C.DAYS[i]} ${C.shortDate(d.date).slice(0, 2)}`,
      value: d.services,
      tip: `${C.DAYS[i]} ${C.shortDate(d.date)}: ${d.services} servicio${d.services === 1 ? '' : 's'} · ${C.money(d.services * data.rate)}`
    }));
    $('week-chart-days').innerHTML = C.bars(days, { title: 'Servicios por día de la semana', format: (n) => String(n) });
    $('week-table').querySelector('tbody').innerHTML = data.days.map((d, i) =>
      `<tr style="border-top:1px solid #dbe7ea"><td style="padding:6px 4px">${C.DAYS[i]} ${C.shortDate(d.date)}</td><td style="padding:6px 4px;text-align:right">${d.services} servicio${d.services === 1 ? '' : 's'}</td><td style="padding:6px 4px;text-align:right;font-weight:700">${C.money(d.services * data.rate)}</td></tr>`
    ).join('');

    const history = data.history.map((w) => ({
      label: C.shortDate(w.week_start),
      value: w.total,
      tip: `Semana del ${C.shortDate(w.week_start)}: ${w.services} servicio${w.services === 1 ? '' : 's'} · ${C.money(w.total)}`
    }));
    $('week-chart-history').innerHTML = C.bars(history, { title: 'Ganancia por semana, últimas 6 semanas', format: (n) => `S/${Math.round(n)}` });
  }

  $('open-week').addEventListener('click', showPanel);
  $('week-prev').addEventListener('click', () => { weekStart = C.addDays((weekStart || currentMonday), -7); load(); });
  $('week-next').addEventListener('click', () => {
    const next = C.addDays((weekStart || currentMonday), 7);
    weekStart = next >= currentMonday ? null : next;
    load();
  });
})();
