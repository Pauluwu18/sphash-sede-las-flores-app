/* Gráficas SVG simples (una sola serie) para los resúmenes semanales. Sin librerías. */
window.SplashCharts = (() => {
  const INK = '#102f49', MUTED = '#627d8d', GRID = '#dbe7ea', BAR = '#008c95', BAR_EMPTY = '#cfe4e6';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Techo "redondo" para que la escala no se vea arbitraria.
  function niceMax(value) {
    if (value <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(value)));
    const step = [1, 2, 5, 10].find((s) => s * pow >= value) * pow;
    return step;
  }

  /**
   * Barras verticales. items: [{ label, value, tip }]. options: { title, format, height }.
   * Una serie = sin leyenda; el título la nombra. Cada barra lleva su valor encima y un tooltip nativo.
   */
  function bars(items, options = {}) {
    const format = options.format || String;
    const width = 320, height = options.height || 190;
    const pad = { top: 22, right: 8, bottom: 30, left: 8 };
    const max = niceMax(Math.max(0, ...items.map((i) => Number(i.value) || 0)));
    const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
    const slot = innerW / Math.max(items.length, 1);
    const barW = Math.min(34, slot * 0.62);
    const baseY = pad.top + innerH;
    const parts = items.map((item, index) => {
      const value = Number(item.value) || 0;
      const h = value > 0 ? Math.max(3, (value / max) * innerH) : 0;
      const x = pad.left + slot * index + (slot - barW) / 2;
      const y = baseY - h;
      const radius = Math.min(4, h / 2);
      const bar = h > 0
        ? `<path d="M${x},${baseY} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + barW - radius} Q${x + barW},${y} ${x + barW},${y + radius} V${baseY} Z" fill="${BAR}"><title>${esc(item.tip || `${item.label}: ${format(value)}`)}</title></path>`
        : `<rect x="${x}" y="${baseY - 2}" width="${barW}" height="2" rx="1" fill="${BAR_EMPTY}"><title>${esc(item.tip || `${item.label}: ${format(0)}`)}</title></rect>`;
      const labelValue = value > 0 ? `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">${esc(format(value))}</text>` : '';
      const labelX = `<text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(item.label)}</text>`;
      return bar + labelValue + labelX;
    });
    const label = esc(options.title || 'Gráfica');
    return `<svg class="splash-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" width="100%" style="max-width:520px;display:block">`
      + `<line x1="${pad.left}" x2="${width - pad.right}" y1="${baseY}" y2="${baseY}" stroke="${GRID}" stroke-width="1"/>`
      + parts.join('') + '</svg>';
  }

  /** Barras horizontales para comparar personas. items: [{ label, value, tip }]. */
  function hbars(items, options = {}) {
    const format = options.format || String;
    const width = 420, rowH = 30, pad = { top: 4, right: 70, bottom: 4, left: 96 };
    const height = pad.top + pad.bottom + rowH * Math.max(items.length, 1);
    const max = niceMax(Math.max(0, ...items.map((i) => Number(i.value) || 0)));
    const innerW = width - pad.left - pad.right;
    const rows = items.map((item, index) => {
      const value = Number(item.value) || 0;
      const w = value > 0 ? Math.max(3, (value / max) * innerW) : 0;
      const y = pad.top + rowH * index + 5;
      const name = String(item.label).length > 14 ? `${String(item.label).slice(0, 13)}…` : String(item.label);
      return `<text x="${pad.left - 8}" y="${y + 12}" text-anchor="end" font-size="12" fill="${INK}">${esc(name)}<title>${esc(item.label)}</title></text>`
        + (w > 0 ? `<rect x="${pad.left}" y="${y}" width="${w}" height="18" rx="4" fill="${BAR}"><title>${esc(item.tip || `${item.label}: ${format(value)}`)}</title></rect>`
          : `<rect x="${pad.left}" y="${y + 8}" width="2" height="2" fill="${BAR_EMPTY}"/>`)
        + `<text x="${pad.left + w + 6}" y="${y + 13}" font-size="12" font-weight="700" fill="${INK}">${esc(format(value))}</text>`;
    });
    const label = esc(options.title || 'Gráfica');
    return `<svg class="splash-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" width="100%" style="max-width:560px;display:block">`
      + `<line x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="${GRID}"/>` + rows.join('') + '</svg>';
  }

  const money = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  function shortDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }
  function addDays(iso, n) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + n));
    return date.toISOString().slice(0, 10);
  }
  function weekLabel(start, end) { return `${shortDate(start)} – ${shortDate(end)}`; }

  return { bars, hbars, money, DAYS, shortDate, addDays, weekLabel, esc };
})();
