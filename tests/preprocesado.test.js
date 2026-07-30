/**
 * Suite de preprocesado de imagen — Agente de Captura
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/preprocesado.test.js
 *
 * El caso real que motivó esta suite: una fecha troquelada gris claro sobre
 * una etiqueta blanca (23/01/27 en un frasco de mayonesa). A ojo se lee
 * perfecto; el OCR no devolvía nada.
 *
 * La causa no era el foco ni la resolución —la foto estaba nítida— sino la
 * binarización: con el 98% de los píxeles entre 235 y 255 y el texto apenas
 * en 210, Otsu ponía el corte donde no correspondía y el troquelado
 * desaparecía por completo. Tesseract recibía un rectángulo blanco.
 *
 * Se testean las funciones PURAS de píxeles, sin canvas ni DOM.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
const stub = () => ({
  getContext: () => ({ drawImage: noop, getImageData: () => ({ data: [], width: 0, height: 0 }), putImageData: noop }),
  width: 0, height: 0, style: {}, appendChild: noop, remove: noop, addEventListener: noop, toDataURL: () => ''
});
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, RegExp, Number, String, Array, Object, Error, Set, Map,
  Float64Array, Uint8Array, Uint8ClampedArray,
  document: { createElement: stub, getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], addEventListener: noop, body: { appendChild: noop } },
  navigator: { mediaDevices: {} }, fetch: () => Promise.reject(new Error('sin red')),
  Image: function () { return stub(); },
  URL: { createObjectURL: () => '', revokeObjectURL: noop }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'agents', 'captura.js'), 'utf8') +
  '\n;globalThis.__cap = AgenteCaptura;', sandbox, { filename: 'captura.js' });

const { estirarContraste, umbralOtsu, umbralLocalAdaptativo } = sandbox.__cap;

let ok = 0;
const fallos = [];
function chequear(desc, cond, detalle) {
  if (cond) { ok++; return; }
  fallos.push({ desc, detalle });
}

/** Construye un RGBA plano a partir de una matriz de grises. */
function imagen(grises) {
  const d = new Uint8ClampedArray(grises.length * 4);
  grises.forEach((g, i) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255; });
  return d;
}
function histograma(d) {
  const h = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) h[d[i]]++;
  return h;
}
function grisesDe(d) {
  const out = [];
  for (let i = 0; i < d.length; i += 4) out.push(d[i]);
  return out;
}

/* ======================================================================
   EL CASO REPORTADO — troquelado gris claro sobre etiqueta blanca
   ==================================================================== */
{
  // 1000 píxeles: 970 de etiqueta (240-250) y 30 de troquelado (208-214).
  const grises = [];
  for (let i = 0; i < 970; i++) grises.push(240 + (i % 11));
  for (let i = 0; i < 30; i++) grises.push(208 + (i % 7));

  const d = imagen(grises);
  const hist = histograma(d);
  const total = grises.length;

  // Antes: Otsu directo sobre el histograma sin estirar.
  const umbralSinEstirar = umbralOtsu(hist, total);
  const perdidosSinEstirar = grises.filter((g) => g < 215 && g >= umbralSinEstirar).length;

  const histNuevo = estirarContraste(d, hist, total);
  const estirados = grisesDe(d);

  chequear('el estiramiento amplía el rango a casi todo el espectro',
    Math.max(...estirados) - Math.min(...estirados) > 200,
    `rango=${Math.max(...estirados) - Math.min(...estirados)}`);

  const umbralEstirado = umbralOtsu(histNuevo, total);
  const textoTrasEstirar = estirados.slice(970).filter((g) => g <= umbralEstirado).length;

  chequear('el troquelado sobrevive a la binarización',
    textoTrasEstirar === 30,
    `sobrevivieron ${textoTrasEstirar} de 30 píxeles de texto ` +
    `(sin estirar se perdían ${perdidosSinEstirar})`);

  /* DOCUMENTADO A PROPÓSITO: el estiramiento NO cambia la clasificación de
     Otsu. Es una transformación lineal y el umbral de Otsu es invariante a
     escala, así que corre el umbral proporcionalmente y separa exactamente
     los mismos píxeles. Se dejó este test para que quede registrado y nadie
     vuelva a atribuirle una mejora que no produce: su valor está en la
     estrategia que NO binariza, donde Tesseract recibe los grises. */
  const textoSinEstirar = grises.slice(970).filter((g) => g <= umbralSinEstirar).length;
  chequear('estirar no altera qué píxeles quedan como texto (es lineal)',
    textoSinEstirar === textoTrasEstirar,
    `sin estirar ${textoSinEstirar}, estirando ${textoTrasEstirar}`);

  chequear('el fondo no se convierte en texto',
    estirados.slice(0, 970).filter((g) => g <= umbralEstirado).length === 0,
    'parte del fondo quedó del lado del texto');
}

/* ======================================================================
   El estiramiento no debe empeorar lo que ya andaba
   ==================================================================== */
{
  // Imagen con buen contraste: negro real y blanco real.
  const grises = [];
  for (let i = 0; i < 500; i++) grises.push(250);
  for (let i = 0; i < 500; i++) grises.push(10);
  const d = imagen(grises);
  const antes = grisesDe(d).join(',');
  estirarContraste(d, histograma(d), grises.length);
  chequear('con buen contraste no toca la imagen',
    grisesDe(d).join(',') === antes, 'modificó una imagen que ya estaba bien');
}
{
  // Imagen casi plana: estirarla sólo amplificaría ruido.
  const grises = new Array(1000).fill(128);
  grises[0] = 131;
  const d = imagen(grises);
  const antes = grisesDe(d).join(',');
  estirarContraste(d, histograma(d), grises.length);
  chequear('con rango minúsculo no amplifica ruido',
    grisesDe(d).join(',') === antes, 'estiró una imagen plana');
}
{
  /* Una mota de ruido no debe definir la escala: por eso se usan
     percentiles y no el mínimo y el máximo absolutos.

     Si la mota mandara, el rango sería 0–249 (amplio) y la función
     devolvería la imagen sin tocar por considerarla ya contrastada,
     dejando el fondo pegado arriba. Con percentiles, la mota se descarta,
     el rango real resulta angosto y tampoco se estira — pero por el motivo
     correcto. Lo que se verifica es que la mota NO haya sido tomada como
     el piso de la escala. */
  const grises = new Array(1000).fill(0).map((_, i) => 240 + (i % 10));
  grises[0] = 0;      // píxel negro aislado
  const d = imagen(grises);
  estirarContraste(d, histograma(d), grises.length);
  const g = grisesDe(d);
  const fondo = g.slice(1);
  chequear('un píxel de ruido no define el piso de la escala',
    Math.max(...fondo) - Math.min(...fondo) < 60,
    `el fondo quedó desparramado en ${Math.max(...fondo) - Math.min(...fondo)} niveles`);
}

/* ======================================================================
   Umbral local — iluminación despareja (tapa curva, frasco con brillo)
   ==================================================================== */
{
  // 40×20 con un gradiente fuerte de izquierda a derecha y texto encima.
  const w = 40, h = 20;
  const grises = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fondo = 80 + Math.round((x / w) * 170);   // de 80 a 250
      const esTexto = (y >= 8 && y <= 11) && (x % 8 < 3);
      grises[y * w + x] = esTexto ? Math.max(0, fondo - 45) : fondo;
    }
  }
  const d = imagen(grises);
  umbralLocalAdaptativo(d, w, h);
  const out = grisesDe(d);

  let textoDetectadoIzq = 0, textoDetectadoDer = 0;
  for (let y = 8; y <= 11; y++) {
    for (let x = 0; x < w; x++) {
      if (x % 8 >= 3) continue;
      if (out[y * w + x] === 0) { (x < w / 2 ? textoDetectadoIzq++ : textoDetectadoDer++); }
    }
  }
  chequear('el umbral local detecta texto en la zona oscura', textoDetectadoIzq > 0,
    `detectados ${textoDetectadoIzq}`);
  chequear('y también en la zona con brillo', textoDetectadoDer > 0,
    `detectados ${textoDetectadoDer}`);

  // Un umbral global no puede con las dos a la vez: se comprueba que
  // efectivamente falle, para justificar que exista el camino local.
  const dGlobal = imagen(grises);
  const uGlobal = umbralOtsu(histograma(dGlobal), w * h);
  let fallaGlobalDer = 0;
  for (let y = 8; y <= 11; y++) {
    for (let x = Math.floor(w / 2); x < w; x++) {
      if (x % 8 >= 3) continue;
      if (grises[y * w + x] >= uGlobal) fallaGlobalDer++;
    }
  }
  chequear('queda demostrado que el umbral global pierde texto con gradiente',
    fallaGlobalDer > 0, 'el global no falló, el camino local sería innecesario');
}

/* ======================================================================
   CABLEADO — que el pipeline REALMENTE use lo anterior
   ----------------------------------------------------------------------
   Los bloques de arriba prueban las funciones en aislamiento, y eso no
   alcanza: al desactivar el estiramiento dentro de `preprocesar` seguían
   pasando todas. Un test que pasa con el código apagado no verifica nada.

   Acá se ejercita `preprocesar` completo contra un canvas falso, con la
   misma imagen del caso reportado.
   ==================================================================== */
{
  function canvasFalso(grises, w, h) {
    const datos = imagen(grises);
    const img = { data: datos, width: w, height: h };
    const ctx = {
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
      drawImage: noop,
      getImageData: () => img,
      putImageData: noop
    };
    return { width: w, height: h, getContext: () => ctx, __img: img };
  }

  // Etiqueta blanca con troquelado gris claro, como en la foto real.
  const w = 40, h = 25;
  const grises = new Array(w * h);
  for (let i = 0; i < w * h; i++) grises[i] = 240 + (i % 11);
  for (let y = 10; y < 14; y++) {
    for (let x = 4; x < 36; x++) {
      if (x % 5 < 2) grises[y * w + x] = 208 + (x % 7);
    }
  }

  const lienzo = canvasFalso(grises, w, h);
  const docOriginal = sandbox.document.createElement;
  sandbox.document.createElement = () => lienzo;

  const fuente = { width: w, height: h, naturalWidth: w, naturalHeight: h };
  const salida = sandbox.__cap.preprocesar(fuente, { anchoObjetivo: w, binarizar: true });
  sandbox.document.createElement = docOriginal;

  chequear('preprocesar devuelve un lienzo', !!salida, 'devolvió null');

  const res = grisesDe(lienzo.__img.data);
  const negros = res.filter((v) => v === 0).length;
  const blancos = res.filter((v) => v === 255).length;

  chequear('la salida quedó binarizada', negros + blancos === res.length,
    `quedaron ${res.length - negros - blancos} píxeles sin binarizar`);

  chequear('REGRESIÓN DE CABLEADO: el troquelado sobrevive al pipeline completo',
    negros > 0 && negros < res.length * 0.5,
    `negros=${negros} de ${res.length} — si es 0, el texto se perdió entero`);

  // Cuántos píxeles de texto original quedaron marcados como texto.
  let textoOriginal = 0, textoConservado = 0;
  grises.forEach((g, i) => {
    if (g < 220) { textoOriginal++; if (res[i] === 0) textoConservado++; }
  });
  chequear('se conserva la mayor parte del trazo',
    textoConservado >= textoOriginal * 0.9,
    `conservados ${textoConservado} de ${textoOriginal}`);
}

/* ======================================================================
   Robustez
   ==================================================================== */
{
  const casos = [
    ['imagen de 1 píxel', () => { const d = imagen([128]); estirarContraste(d, histograma(d), 1); }],
    ['todo negro', () => { const d = imagen(new Array(100).fill(0)); estirarContraste(d, histograma(d), 100); }],
    ['todo blanco', () => { const d = imagen(new Array(100).fill(255)); estirarContraste(d, histograma(d), 100); }],
    ['umbral local en 1×1', () => { const d = imagen([200]); umbralLocalAdaptativo(d, 1, 1); }],
    ['umbral local en franja', () => { const d = imagen(new Array(50).fill(120)); umbralLocalAdaptativo(d, 50, 1); }]
  ];
  casos.forEach(([desc, fn]) => {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    chequear(`no rompe con ${desc}`, !err, err && err.message);
  });
}

const total = ok + fallos.length;
console.log(`\nSuite de preprocesado — ${ok}/${total} OK\n`);
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
