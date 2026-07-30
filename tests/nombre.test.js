/**
 * Suite de reconocimiento de nombre de producto — Agente de Captura
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/nombre.test.js
 *
 * El defecto que motivó esta suite: `extraerNombre` se quedaba con la línea
 * de MAYOR ALTURA del envase. En un frasco de mayonesa Hellmann's la palabra
 * más grande es "CLÁSICA" —el descriptor de variante— así que el sistema
 * guardaba un producto llamado "Clásica".
 *
 * No es un problema cosmético: el Agente Cocinero matchea ingredientes por
 * nombre, y "Clásica" no entra en ninguna receta. El producto quedaba inerte
 * en la despensa, que es lo contrario de lo que la app promete.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ruta = path.join(__dirname, '..', 'js', 'agents', 'captura.js');
const codigo = fs.readFileSync(ruta, 'utf8');

const noop = () => {};
const stubEl = () => ({
  getContext: () => ({ drawImage: noop, getImageData: () => ({ data: [], width: 0, height: 0 }), putImageData: noop }),
  width: 0, height: 0, style: {}, appendChild: noop, remove: noop, addEventListener: noop, toDataURL: () => ''
});
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, RegExp, Number, String, Array, Object, Error, Set, Map,
  document: { createElement: stubEl, getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], addEventListener: noop, body: { appendChild: noop } },
  navigator: { mediaDevices: {} }, fetch: () => Promise.reject(new Error('sin red')),
  Image: function () { return stubEl(); },
  URL: { createObjectURL: () => '', revokeObjectURL: noop }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(codigo + '\n;globalThis.__cap = AgenteCaptura;', sandbox, { filename: 'captura.js' });
const { extraerNombre } = sandbox.__cap;

/** Arma la estructura que devuelve Tesseract: líneas con alto y confianza. */
function ocr(lineas) {
  return {
    lines: lineas.map(([text, alto, confidence = 90]) => ({
      text, confidence, bbox: { y0: 0, y1: alto }
    }))
  };
}

let ok = 0;
const fallos = [];
function chequear(desc, cond, detalle) {
  if (cond) { ok++; return; }
  fallos.push({ desc, detalle });
}

/* ======================================================================
   EL CASO REPORTADO — frasco de mayonesa
   ==================================================================== */
{
  // Tal como sale de un envase real: la variante impresa enorme, la marca
  // mediana y el tipo de producto en letra chica.
  const frasco = ocr([
    ['CLASICA', 80],        // <- la más grande: es el descriptor
    ['Hellmanns', 55],
    ['Mayonesa', 30],
    ['475 g', 15]
  ]);
  const r = extraerNombre(frasco);

  chequear('REGRESIÓN: no devuelve el descriptor de variante',
    r && !/clasica/i.test(r.texto), `devolvió "${r && r.texto}"`);
  chequear('identifica el tipo de producto',
    r && r.tipo === 'mayonesa', `tipo=${r && r.tipo}`);
  chequear('conserva la marca como calificador',
    r && /hellmanns/i.test(r.texto), `devolvió "${r && r.texto}"`);
  chequear('deduce la categoría desde el tipo',
    r && r.categoria === 'conservas', `categoria=${r && r.categoria}`);
}

/* ======================================================================
   El tipo se busca en TODO el texto, no sólo en lo grande
   ==================================================================== */
{
  // Marca gigante, producto en letra chica: caso clásico de gaseosas y lácteos.
  const sachet = ocr([['LA SERENISIMA', 90], ['Leche entera', 25], ['1 L', 12]]);
  const r = extraerNombre(sachet);
  chequear('encuentra el tipo aunque esté en letra chica',
    r && r.tipo === 'leche', `tipo=${r && r.tipo}`);
  chequear('categoriza como lácteo', r && r.categoria === 'lacteos', `cat=${r && r.categoria}`);

  // "entera" es descriptor y no debe ganarle a nada.
  chequear('el descriptor no aparece solo como nombre',
    r && !/^entera/i.test(r.texto), `devolvió "${r && r.texto}"`);
}

/* ======================================================================
   Plurales y tildes
   ==================================================================== */
{
  const r1 = extraerNombre(ocr([['MARCA X', 60], ['Huevos frescos', 40]]));
  chequear('reconoce plurales', r1 && r1.tipo === 'huevo' || r1 && r1.tipo === 'huevos',
    `tipo=${r1 && r1.tipo}`);

  const r2 = extraerNombre(ocr([['Café molido', 50], ['MARCA', 70]]));
  chequear('reconoce palabras con tilde', r2 && r2.tipo === 'cafe', `tipo=${r2 && r2.tipo}`);
}

/* ======================================================================
   Conexión con el recetario: lo escaneado tiene que poder cocinarse
   ==================================================================== */
{
  const casos = [
    [['ARROZ', 70], ['Gallo Oro', 50]],
    [['MARCA', 80], ['Fideos guiseros', 30]],
    [['Queso cremoso', 40], ['LA PAULINA', 75]]
  ];
  const tipos = casos.map((c) => { const r = extraerNombre(ocr(c)); return r && r.tipo; });
  chequear('los productos escaneados caen en ingredientes del recetario',
    tipos.every((t) => ['arroz', 'fideos', 'queso'].includes(t)),
    `tipos=${JSON.stringify(tipos)}`);
}

/* ======================================================================
   Sin tipo reconocido: degrada, pero nunca a un descriptor
   ==================================================================== */
{
  const raro = ocr([['PREMIUM', 90], ['Delicias del Sur', 45], ['Producto gourmet', 30]]);
  const r = extraerNombre(raro);
  chequear('sin tipo conocido no devuelve un descriptor suelto',
    r && !/^premium$/i.test(r.texto), `devolvió "${r && r.texto}"`);
  chequear('sin tipo conocido igual devuelve algo útil',
    r && r.texto.length >= 3, `devolvió "${r && r.texto}"`);
}

/* ======================================================================
   REGRESIÓN: la foto de la FECHA no debe aportar el nombre
   ----------------------------------------------------------------------
   Al fotografiar el vencimiento, el OCR arrastra el texto que rodea al
   troquelado: "CONS. PREF.", el lote, la hora de envasado. Esas líneas
   competían como candidatas a nombre y a veces ganaban.
   ==================================================================== */
{
  const zonaFecha = ocr([
    ['CONS. PREF.', 70],
    ['03/27', 65],
    ['L-2847', 55],
    ['FAB. 03/26', 50]
  ]);
  const r = extraerNombre(zonaFecha);
  chequear('la zona del troquelado no produce un nombre',
    r === null, `devolvió "${r && r.texto}"`);

  const casos = [
    ['CONS. PREF. 03/27', 'abreviatura de consumo preferente'],
    ['L-2847', 'código de lote'],
    ['FAB 03/26', 'fecha de fabricación'],
    ['EXP 12/28', 'expiry abreviado'],
    ['03/27', 'la fecha sola'],
    ['23/01/2027', 'fecha completa'],
    ['H 14:35', 'hora de envasado']
  ];
  casos.forEach(([linea, desc]) => {
    const res = extraerNombre(ocr([[linea, 80], ['Mayonesa', 25]]));
    chequear(`no toma como nombre: ${desc}`,
      res && !new RegExp(linea.split(/\s/)[0], 'i').test(res.texto),
      `con "${linea}" devolvió "${res && res.texto}"`);
  });
}

/* ======================================================================
   Ruido legal y nutricional: sigue filtrado
   ==================================================================== */
{
  const dorso = ocr([
    ['INFORMACION NUTRICIONAL', 60],
    ['Ingredientes: agua, sal', 40],
    ['CONTENIDO NETO 500 g', 35],
    ['Industria Argentina', 30]
  ]);
  const r = extraerNombre(dorso);
  chequear('descarta el texto legal y nutricional del dorso',
    !r || !/nutricional|ingredientes|contenido neto|industria/i.test(r.texto),
    `devolvió "${r && r.texto}"`);
}

/* ======================================================================
   Robustez
   ==================================================================== */
{
  const casos = [
    ['sin líneas', { lines: [] }],
    ['objeto vacío', {}],
    ['líneas sin texto', ocr([['', 50], ['  ', 40]])],
    ['confianza baja', ocr([['Mayonesa', 50, 20]])],
    ['todo números', ocr([['475 500 900', 60]])]
  ];
  casos.forEach(([desc, data]) => {
    let r, err = null;
    try { r = extraerNombre(data); } catch (e) { err = e; }
    chequear(`no rompe con ${desc}`, !err, err && err.message);
  });
}

const total = ok + fallos.length;
console.log(`\nSuite de nombre de producto — ${ok}/${total} OK\n`);
if (fallos.length) {
  console.log('FALLOS:');
  fallos.forEach((f) => {
    console.log(`  ✗ ${f.desc}`);
    if (f.detalle) console.log(`      ${f.detalle}`);
  });
  console.log('');
  process.exit(1);
}
console.log('Todo verde.\n');
