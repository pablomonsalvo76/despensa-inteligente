/**
 * Suite de fechas — AgenteCaptura.extraerFecha
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/fechas.test.js
 *
 * captura.js es un IIFE pensado para el navegador, así que se carga con
 * `vm` sobre un contexto con los globals mínimos stubbeados. No se toca
 * el archivo de producción.
 *
 * Las fechas esperadas se calculan RELATIVAS A HOY donde corresponde,
 * porque extraerFecha descarta lo implausible (más de 1 año atrás o más
 * de 10 adelante) y resuelve dd/mm sin año a la próxima ocurrencia.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Carga del módulo en un contexto con globals de navegador stubbeados ----
const ruta = path.join(__dirname, '..', 'js', 'agents', 'captura.js');
const codigo = fs.readFileSync(ruta, 'utf8');

const noop = () => {};
const stubEl = () => ({
  getContext: () => ({
    drawImage: noop, getImageData: () => ({ data: [], width: 0, height: 0 }),
    putImageData: noop, fillRect: noop, scale: noop, translate: noop
  }),
  width: 0, height: 0, style: {}, appendChild: noop, remove: noop,
  addEventListener: noop, toDataURL: () => ''
});

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, RegExp, Number, String, Array, Object, Error,
  document: {
    createElement: stubEl, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, body: { appendChild: noop }
  },
  navigator: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('sin cámara')) } },
  window: {}, fetch: () => Promise.reject(new Error('sin red')),
  Tesseract: undefined, Image: function () { return stubEl(); },
  URL: { createObjectURL: () => '', revokeObjectURL: noop }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(codigo + '\n;globalThis.__captura = AgenteCaptura;', sandbox, { filename: 'captura.js' });

const { extraerFecha } = sandbox.__captura;

// ---- Helpers de fechas relativas ----
const HOY = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Próxima ocurrencia de dia/mes a partir de hoy (misma regla que el código). */
function proxima(dia, mes) {
  let a = HOY.getFullYear();
  let cand = new Date(`${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T00:00:00`);
  if (cand < HOY) cand = new Date(`${a + 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T00:00:00`);
  return iso(cand);
}
const ANIO = HOY.getFullYear();
const AA = String(ANIO).slice(2);
const SIG = String(ANIO + 1).slice(2);

// ---- Casos ----
// [descripción, textoOCR, esperado]
const casos = [
  // --- Formatos base ---
  ['dd/mm/yyyy',                'vto 30/07/2027',                         '2027-07-30'],
  ['dd-mm-yy',                  'vto 30-07-27',                           '2027-07-30'],
  ['dd.mm.yyyy',                'vto 05.11.2028',                         '2028-11-05'],
  ['dd mm yyyy con espacios',   'vto 05 11 2028',                         '2028-11-05'],
  ['yyyy-mm-dd',               `consumir antes de ${ANIO + 2}-03-15`,     `${ANIO + 2}-03-15`],
  ['un dígito de día y mes',    'vto 5/3/2029',                           '2029-03-05'],

  // --- REGRESIÓN: el caso reportado 23/01/27 ---
  ['23/01/27 suelto',           '23/01/27',                               '2027-01-23'],
  ['23/01/27 con vto',          'vto 23/01/27',                           '2027-01-23'],
  ['23/01/27 entre ruido OCR',  'BHT y BHA 23/01/27 contiene huevo',      '2027-01-23'],
  ['23 01 27 con espacios',     'vto 23 01 27',                           '2027-01-23'],
  ['23-01-27',                  'cons. pref. 23-01-27',                   '2027-01-23'],
  ['23.01.27',                  'vence 23.01.27',                         '2027-01-23'],

  // --- REGRESIÓN: mes/año, el formato más común en despensa ---
  // No estaba contemplado en ningún patrón: el de dd/mm leía "03/27" como
  // día 3 del mes 27 y lo descartaba por mes inválido.
  ['MM/AA suelto',              '03/27',                                  '2027-03-31'],
  ['MM/AA con vto',             'vto 03/27',                              '2027-03-31'],
  ['MM/AA con cons. pref.',     'CONS. PREF. 03/27',                      '2027-03-31'],
  ['MM/AAAA',                   '03/2027',                                '2027-03-31'],
  ['MM-AA con guion',           '03-27',                                  '2027-03-31'],
  ['MM AA con espacio',         '03 27',                                  '2027-03-31'],
  ['MM/AA diciembre',           '12/26',                                  '2026-12-31'],
  ['MM/AA junto a un lote',     'L2847 03/27',                            '2027-03-31'],
  ['ambiguo sin clave → null',  'lote 03/07',                             null],
  ['mes inválido en MM/AA',     '13/27',                                  null],

  // --- Meses en letras ---
  ['dd MMM yyyy',               'vto 20 AGO 2027',                        '2027-08-20'],
  ['dd MMM yy',                 'vto 20 ago 27',                          '2027-08-20'],
  ['MMM yyyy sin día',          `vto DIC ${ANIO + 1}`,                    `${ANIO + 1}-12-31`],
  ['MMM yyyy febrero bisiesto', 'vto FEB 2028',                           '2028-02-29'],

  // --- Contexto: vencimiento vs elaboración ---
  ['elaboración se descarta',   'elaborado 01/01/2026 vto 01/01/2028',    '2028-01-01'],
  ['sólo elaboración → null',   'elaborado 01/06/2027',                   null],
  ['gana la más lejana',        '10/01/2027 y 10/01/2028',                '2028-01-10'],

  // --- Formatos que exigen palabra clave ---
  ['compacto ddmmyy con vto',   'vto 230127',                             '2027-01-23'],
  ['compacto sin vto → lote',   'lote 230127 producto',                   null],
  ['dd/mm sin año con vto',     'vto 23/01',                              proxima(23, 1)],
  ['dd/mm sin año sin clave',   'peso 23/01 neto',                        null],

  // --- Corrección de confusiones del OCR ---
  ['O por 0',                   'vto 3O/O7/27',                           '2027-07-30'],
  ['I y l por 1',               'vto 23/Ol/27',                           '2027-01-23'],
  ['S por 5 y B por 8',         'vto 2S/01/2B',                           '2028-01-25'],
  ['no rompe "vto" vecino',     'vto 3o/o7/27',                           '2027-07-30'],

  // --- Plausibilidad ---
  ['muy en el pasado → null',   'vto 30/07/1998',                         null],
  ['muy en el futuro → null',   'vto 30/07/2099',                         null],
  ['mes 13 → null',             'vto 30/13/2027',                         null],
  ['día 32 → null',             'vto 32/07/2027',                         null],

  // --- Sin fecha ---
  ['texto sin fecha',           'ingredientes: harina, sal, conservantes', null],
  ['vacío',                     '',                                       null],
  ['sólo ruido OCR real',       '1CH00 S0TDIC0, BHT y BHA CONTIENE HUEVO Conpervi Inge', null],

  // --- Robustez / rendimiento ---
  ['espacios múltiples',        'vto     23/01/27',                       '2027-01-23'],
  ['multilínea',                'CONSUMIR ANTES DE\n23/01/27\nLOTE A45',  '2027-01-23']
];

// ---- Corrida ----
let ok = 0;
const fallos = [];

for (const [desc, texto, esperado] of casos) {
  let real, error = null;
  const t0 = Date.now();
  try { real = extraerFecha(texto); } catch (e) { error = e; }
  const ms = Date.now() - t0;

  if (error) {
    fallos.push({ desc, texto, esperado, real: `EXCEPCIÓN: ${error.message}`, ms });
  } else if (real === esperado) {
    ok++;
  } else {
    fallos.push({ desc, texto, esperado, real, ms });
  }
  if (ms > 500) fallos.push({ desc: desc + ' [LENTO]', texto, esperado: '<500ms', real: ms + 'ms', ms });
}

// ---- Anti-ReDoS: el bug de backtracking que ya se corrigió una vez ----
const patologico = 'vto ' + ' '.repeat(300) + '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 x';
const tp = Date.now();
try { extraerFecha(patologico); } catch (e) { /* no importa el valor, sí que termine */ }
const msPat = Date.now() - tp;
if (msPat > 1000) fallos.push({ desc: 'ReDoS: texto patológico', texto: '(300 espacios + dígitos)', esperado: '<1000ms', real: msPat + 'ms' });
else ok++;

// ---- Reporte ----
console.log(`\nSuite de fechas — ${ok}/${casos.length + 1} OK\n`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) {
    console.log(`  ✗ ${f.desc}`);
    console.log(`      entrada:  ${JSON.stringify(f.texto)}`);
    console.log(`      esperado: ${JSON.stringify(f.esperado)}`);
    console.log(`      obtenido: ${JSON.stringify(f.real)}`);
  }
  console.log('');
  process.exit(1);
}
console.log('Todo verde.\n');
