const {test}=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('../vendor/exceljs.min.js');
const {parseBuffer,parseDate}=require('../agenda-parser.js');

async function sample(){
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Agenda');
  ws.addRow(['Agenda del Día — Domingo, 8 de noviembre de 2026']);ws.mergeCells('A1:W1');
  ws.addRow(['','','MAÑANA',null,null,null,null,null,null,'TARDE',null,null,null,null,null,null,'EXTRAS']);
  const h=['Cliente','Teléfono','Distrito','Monto (S/)','Extra (S/)','Método Pago','Ingreso Total'];
  ws.addRow(['MOVILIDAD','OPERARIO',...h,...h,...h]);
  ws.addRow(['TAXI 1','YERSON ROBIÑO ALVARADO CAMPOS','GEORGINA CAMPOS','997900085','SAN MARTIN','140','','Yape / Plin',{formula:'F4+G4'}]);
  ws.addRow([null,null,'LUIS NIMA','908777963','CALLAO',130,'','Efectivo',{formula:'F5+G5'}]);ws.mergeCells('B4:B5');
  ws.addRow(['Sin movilidad','JORGE STEPHANO LOAYZA CARLOS','RAQUEL V','985580140','SMP',130,'20','Tarjeta',null,'ANA TARDE','911','LINCE',150,'','Efectivo']);
  const lionel=ws.addRow([null,'LIONEL MATÍAS ROJAS PICON']);
  lionel.getCell(17).value='EXTRA CLI';lionel.getCell(18).value='922';lionel.getCell(19).value='ATE';lionel.getCell(20).value=100;lionel.getCell(22).value='Yape / Plin';
  ws.addRow([null,'FABRIZIO CRUZ']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('el parser de la agenda lee fecha, operarios combinados, los tres turnos y los datos de cada servicio',async()=>{
  assert.equal(parseDate('Agenda del Día — Domingo, 8 de noviembre de 2026'),'2026-11-08');
  assert.equal(parseDate('sin fecha'),'');
  const {date,services}=await parseBuffer(await sample(),ExcelJS);
  assert.equal(date,'2026-11-08');
  assert.equal(services.length,5);
  const y=services.filter(s=>s.operator.startsWith('YERSON'));
  assert.equal(y.length,2,'el operario combinado cubre sus dos filas');
  assert.deepEqual({...y[1]},{slot:'MAÑANA',operator:'YERSON ROBIÑO ALVARADO CAMPOS',movilidad:'TAXI 1',client:'LUIS NIMA',phone:'908777963',district:'CALLAO',amount:130,extra:0,payment_method:'Efectivo'});
  const jorge=services.filter(s=>s.operator.startsWith('JORGE'));
  assert.deepEqual(jorge.map(s=>[s.slot,s.client,s.amount,s.extra,s.payment_method]),[['MAÑANA','RAQUEL V',130,20,'Tarjeta'],['TARDE','ANA TARDE',150,0,'Efectivo']]);
  assert.equal(services.find(s=>s.slot==='EXTRAS').operator,'LIONEL MATÍAS ROJAS PICON');
  assert.ok(!services.some(s=>s.operator.startsWith('FABRIZIO')),'una fila sin cliente no crea servicios');
});

test('el parser rechaza archivos que no son la agenda',async()=>{
  const wb=new ExcelJS.Workbook();wb.addWorksheet('X').addRow(['otra cosa']);
  await assert.rejects(async()=>parseBuffer(Buffer.from(await wb.xlsx.writeBuffer()),ExcelJS),/fecha/);
});
