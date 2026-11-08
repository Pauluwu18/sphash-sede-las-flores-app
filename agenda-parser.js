/* Convierte el Excel "Agenda del Día" de splashapp.net.pe en { date, services }.
   Diseño del archivo: fila 1 = título con la fecha; fila 3 = encabezados; desde la fila 4,
   columna A = movilidad, B = operario (celdas combinadas hacia abajo) y tres bloques de
   7 columnas (MAÑANA, TARDE, EXTRAS): Cliente, Teléfono, Distrito, Monto, Extra, Método, Total. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SplashAgendaParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const BLOCKS = [{ slot: 'MAÑANA', first: 3 }, { slot: 'TARDE', first: 10 }, { slot: 'EXTRAS', first: 17 }];
  const HEADER_ROW = 3;

  function plain(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
      if ('result' in value) return plain(value.result);
      if ('text' in value) return plain(value.text);
      return '';
    }
    return String(value).trim();
  }

  function number(value) {
    const n = Number(String(plain(value)).replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function parseDate(title) {
    const match = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i.exec(String(title || ''));
    if (!match) return '';
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return '';
    return `${match[3]}-${String(month).padStart(2, '0')}-${String(+match[1]).padStart(2, '0')}`;
  }

  /** worksheet: hoja de ExcelJS. Devuelve { date, services:[{slot, operator, movilidad, client, phone, district, amount, extra, payment_method}] }. */
  function parseWorksheet(ws) {
    const date = parseDate(plain(ws.getCell(1, 1).value));
    if (!date) throw new Error('No se encontró la fecha en el título del Excel de la agenda.');
    const header = plain(ws.getCell(HEADER_ROW, 2).value).toUpperCase();
    if (!header.startsWith('OPERARIO')) throw new Error('El Excel no tiene el formato de la agenda (falta la columna OPERARIO).');
    const services = [];
    let operator = '';
    let movilidad = '';
    for (let row = HEADER_ROW + 1; row <= ws.rowCount; row++) {
      const op = plain(ws.getCell(row, 2).value);
      const mov = plain(ws.getCell(row, 1).value);
      if (op) operator = op;
      if (mov) movilidad = mov;
      for (const block of BLOCKS) {
        const client = plain(ws.getCell(row, block.first).value);
        if (!client) continue;
        services.push({
          slot: block.slot,
          operator: op || operator,
          movilidad,
          client,
          phone: plain(ws.getCell(row, block.first + 1).value),
          district: plain(ws.getCell(row, block.first + 2).value),
          amount: number(ws.getCell(row, block.first + 3).value),
          extra: number(ws.getCell(row, block.first + 4).value),
          payment_method: plain(ws.getCell(row, block.first + 5).value)
        });
      }
    }
    return { date, services };
  }

  async function parseBuffer(buffer, ExcelJS) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];
    if (!ws) throw new Error('El Excel está vacío.');
    return parseWorksheet(ws);
  }

  return { parseWorksheet, parseBuffer, parseDate };
});
