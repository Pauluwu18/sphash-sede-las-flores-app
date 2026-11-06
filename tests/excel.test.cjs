const {test} = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../vendor/exceljs.min.js');
const {rowsFor, buildWorkbook} = require('../attendance-excel.js');

test('Excel conserva el orden diario, identidad, faltantes y horas reales', async () => {
  const record = {record_date:'01/10/2026',arrivals:[
    {personId:'a',name:'ÁNGEL & CAMPOS',arrivalTime:'07:30',late:false},
    {personId:'b',name:'NOMBRE HISTÓRICO',arrivalTime:'07:45',late:true},
    {name:'Manual sin hora',arrivalTime:'',late:false},
    {personId:'old',name:'=SUM(1,2)',arrivalTime:'invalid',late:false}
  ]};
  const people = [
    {id:'a',name:'ÁNGEL & CAMPOS',active:true},
    {id:'b',name:'Nombre cambiado',active:false},
    {id:'c',name:'MANUAL SIN HORA',active:true},
    {id:'d',name:'Sin registro',active:true},
    {id:'e',name:'Inactivo ausente',active:false}
  ];
  const rows = rowsFor(record,people);
  assert.deepEqual(rows.map(r => r.number),[1,2,3,4,null]);
  assert.equal(rows[4].status,'—');
  assert.equal(rows[2].time,null);
  assert.equal(rows[3].time,null);
  const {workbook,filename} = buildWorkbook(record,people,ExcelJS);
  assert.equal(filename,'Registro-Diario-2026-10-01.xlsx');
  const saved = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(saved);
  const sheet = reopened.worksheets[0];
  assert.equal(reopened.worksheets.length,1);
  assert.equal(sheet.getCell('A1').value,'Registro Diario — 1 de octubre de 2026');
  assert.ok(sheet.getCell('D1').isMerged);
  assert.equal(sheet.getCell('A6').type,ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('A6').value,'=SUM(1,2)');
  assert.equal(sheet.getCell('B3').value,1);
  assert.equal(sheet.getCell('C3').fill.fgColor.argb,'FFE7F3E9');
  assert.equal(sheet.getCell('C4').fill.fgColor.argb,'FFFFF6D9');
  // ExcelJS rehydrates formatted time values as a date on import.
  const time = sheet.getCell('D3').value;
  assert.equal(time.getUTCHours(),7);
  assert.equal(time.getUTCMinutes(),30);
  assert.equal(sheet.getCell('D5').value,null);
  assert.equal(sheet.getCell('B7').value,null);
  assert.equal(sheet.views[0].ySplit,2);
  assert.equal(sheet.autoFilter,'A2:D7');
});

test('Excel vacío no inventa asistencia ni acepta fechas imposibles', () => {
  const result = buildWorkbook({date:'03/10/2026',arrivals:[]},[],ExcelJS);
  assert.equal(result.workbook.worksheets[0].rowCount,2);
  assert.throws(() => buildWorkbook({date:'31/02/2026'},[],ExcelJS),/fecha/);
  assert.throws(() => buildWorkbook({date:'bad'},[],ExcelJS),/fecha/);
});
