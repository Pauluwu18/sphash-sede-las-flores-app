/* ExcelJS 4.4.0 is bundled locally; exports contain only authenticated server data. */
(function (root) {
  'use strict';
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const normalize = value => String(value || '').trim().toLocaleLowerCase('es-PE');
  function timeValue(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value || '');
    return match ? (+match[1] * 3600 + +match[2] * 60 + +(match[3] || 0)) / 86400 : null;
  }
  function rowsFor(record, people) {
    const arrivals = record.arrivals || [];
    // Keep the stored arrival order, including entries without a recorded time.
    const rows = arrivals.map((arrival, index) => ({
      name: String(arrival.name || ''), number: index + 1,
      status: arrival.late ? 'Tardanza' : 'Puntual', time: timeValue(arrival.arrivalTime)
    }));
    const ids = new Set(arrivals.map(a => a.personId).filter(Boolean));
    const names = new Set(arrivals.filter(a => !a.personId).map(a => normalize(a.name)));
    for (const person of people) {
      if (person.active === false || ids.has(person.id) || names.has(normalize(person.name))) continue;
      rows.push({name: String(person.name || ''), number: null, status: '—', time: null});
    }
    return rows;
  }
  function buildWorkbook(record, people, ExcelJS = root.ExcelJS) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(record.date || record.record_date || '');
    if (!match) throw new Error('La fecha del registro no es válida.');
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(+year, +month - 1, +day));
    if (date.getUTCDate() !== +day || date.getUTCMonth() !== +month - 1) throw new Error('La fecha del registro no es válida.');
    const titleDate = new Intl.DateTimeFormat('es-PE', {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SPLASH';
    const sheet = workbook.addWorksheet('Registro diario', {
      views: [{state:'frozen', ySplit:2, showGridLines:false}],
      pageSetup: {paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, printTitlesRow:'1:2'}
    });
    const rows = rowsFor(record, people);
    sheet.columns = [{width:58}, {width:18}, {width:18}, {width:20}];
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = `Registro Diario — ${titleDate}`;
    sheet.getCell('A1').font = {name:'Calibri', size:16, bold:true, color:{argb:'FFFFFFFF'}};
    sheet.getCell('A1').fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF005447'}};
    sheet.getCell('A1').alignment = {horizontal:'center', vertical:'middle'};
    sheet.getRow(1).height = 34;
    sheet.getRow(2).values = ['EMPLEADO', 'N° OPERARIO', 'ESTADO', 'HORA ENTRADA'];
    sheet.getRow(2).height = 27;
    sheet.getRow(2).eachCell(cell => {
      cell.font = {name:'Calibri', size:11, bold:true, color:{argb:'FFFFFFFF'}};
      cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF37474F'}};
      cell.alignment = {horizontal:'center',vertical:'middle'};
    });
    for (const item of rows) {
      const row = sheet.addRow([item.name, item.number, item.status, item.time]);
      row.height = item.name.length > 55 ? 32 : 21;
      for (let col = 1; col <= 4; col++) {
        const cell = row.getCell(col);
        cell.font = {name:'Calibri',size:11,color:{argb:'FF202020'}};
        cell.alignment = {vertical:'middle',horizontal:col === 2 ? 'right' : col === 4 ? 'center' : 'left',wrapText:col === 1};
        cell.border = {bottom:{style:'hair',color:{argb:'FFE5E9E8'}}};
      }
      row.getCell(4).numFmt = 'hh:mm';
      if (item.status !== '—') {
        const late = item.status === 'Tardanza';
        row.getCell(3).font = {name:'Calibri',size:11,bold:true,color:{argb:late ? 'FF947000':'FF216B32'}};
        row.getCell(3).fill = {type:'pattern',pattern:'solid',fgColor:{argb:late ? 'FFFFF6D9':'FFE7F3E9'}};
      }
    }
    sheet.autoFilter = `A2:D${Math.max(2, rows.length + 2)}`;
    sheet.pageSetup.printArea = `A1:D${Math.max(2, rows.length + 2)}`;
    return {workbook, filename:`Registro-Diario-${year}-${month}-${day}.xlsx`};
  }
  async function download(record, people) {
    const {workbook, filename} = buildWorkbook(record, people);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:mime});
    if (root.SplashAdminNative) {
      if (typeof root.SplashAdminNative.saveExcel !== 'function') {
        throw new Error('Actualiza la APK de administración para descargar Excel, o abre el sitio en tu navegador.');
      }
      const dataUrl = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo preparar el Excel.'));
        reader.readAsDataURL(blob);
      });
      root.SplashAdminNative.saveExcel(filename, dataUrl);
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
  root.AttendanceExcel = {rowsFor, buildWorkbook, download};
  if (typeof module !== 'undefined') module.exports = root.AttendanceExcel;
})(typeof window === 'undefined' ? globalThis : window);
