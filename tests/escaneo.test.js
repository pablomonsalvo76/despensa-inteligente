/**
 * Suite del escaneo continuo — Agente de Captura
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/escaneo.test.js
 *
 * Motivada por una prueba real fallida: el usuario sostuvo el teléfono sobre
 * un frasco hasta el "intento 24 de 32" sin que pasara nada y sin ver nunca
 * qué estaba leyendo la cámara.
 *
 *   32 intentos × (OCR ~2 s + 900 ms de espera) ≈ 90 segundos
 *
 * Y aunque leyera bien la fecha no la entregaba: exigía verla dos veces
 * idéntica o con 85% de confianza. Estas pruebas fijan el contrato nuevo:
 * el escaneo se acota por TIEMPO, entrega apenas tiene algo, y emite el
 * texto crudo para que el fallo sea diagnosticable.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
/* El canvas falso devuelve datos del TAMAÑO que declara. La primera versión
   devolvía un array vacío con dimensiones de 1400 px, y el umbral local
   recorría 840.000 píxeles inexistentes: tres intentos tardaban 3,5 s y la
   medición de tiempos quedaba inservible. */
const stub = () => {
  const c = {
    width: 0, height: 0, style: {}, appendChild: noop, remove: noop,
    addEventListener: noop, toDataURL: () => ''
  };
  c.getContext = () => ({
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    drawImage: noop,
    getImageData: () => ({
      data: new Uint8ClampedArray(Math.max(1, c.width * c.height) * 4).fill(200),
      width: c.width, height: c.height
    }),
    putImageData: noop
  });
  return c;
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, RegExp, Number, String, Array, Object, Error, Set, Map,
  Float64Array, Uint8Array, Uint8ClampedArray,
  document: { createElement: stub, getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], addEventListener: noop, body: { appendChild: noop } },
  navigator: {}, fetch: () => Promise.reject(new Error('sin red')),
  Image: function () { return stub(); },
  URL: { createObjectURL: () => '', revokeObjectURL: noop },
  // Tesseract presente pero sustituido más abajo por un motor falso.
  Tesseract: { createWorker: async () => ({ setParameters: async () => {}, recognize: async () => ({ data: {} }), terminate: () => {} }) }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'agents', 'captura.js'), 'utf8') +
  '\n;globalThis.__cap = AgenteCaptura;', sandbox, { filename: 'captura.js' });
const cap = sandbox.__cap;

let ok = 0;
const fallos = [];
function chequear(desc, cond, detalle) {
  if (cond) { ok++; return; }
  fallos.push({ desc, detalle });
}

/* Motor de OCR controlado.
   -----------------------------------------------------------------------
   IMPORTANTE — dónde se pincha: el primer intento de esta suite reemplazaba
   `AgenteCaptura.procesarFoto` en el objeto exportado, y no funcionó: el
   ciclo llama a la función INTERNA del closure, no a la propiedad del
   objeto. Sustituir la superficie pública no ejercita nada.

   La sustitución tiene que ir más abajo, en `Tesseract.createWorker`, que
   es la única dependencia externa real. Así corre el código de producción
   entero —preprocesado, extracción de fecha, cálculo de confianza— y sólo
   se controla lo que "ve" la cámara. */
function motorFalso(guion, demoraMs = 5) {
  let i = 0;
  sandbox.Tesseract = {
    createWorker: async () => ({
      setParameters: async () => {},
      recognize: async () => {
        const paso = guion[Math.min(i, guion.length - 1)];
        i++;
        await new Promise((r) => setTimeout(r, demoraMs));
        const texto = paso.texto || '';
        const conf = paso.confianza === undefined ? 60 : Math.round(paso.confianza * 100);
        return {
          data: {
            text: texto,
            words: texto.split(/\s+/).filter(Boolean).map((t) => ({ text: t, confidence: conf })),
            lines: [{ text: texto, confidence: conf, bbox: { y0: 0, y1: 20 }, words: [] }]
          }
        };
      },
      terminate: () => {}
    })
  };
  cap.liberarOCR();   // fuerza a recrear el worker con el motor nuevo
  return { restaurar: () => cap.liberarOCR(), llamadas: () => i };
}

const video = { videoWidth: 320, videoHeight: 240 };

(async () => {
  /* ==================================================================
     Se acota por TIEMPO, no por número de intentos
     ================================================================ */
  {
    const m = motorFalso([{ texto: 'lh6 118 v1' }], 5);
    const t0 = Date.now();
    let motivo = null;
    await cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 600, intervaloMs: 20,
      onFecha: (iso, conf, mot) => { motivo = mot; }
    });
    const duracion = Date.now() - t0;
    m.restaurar();

    chequear('el escaneo respeta el presupuesto de tiempo',
      duracion < 1500, `tardó ${duracion} ms con presupuesto de 600`);
    chequear('al agotarse informa que no encontró nada',
      motivo === 'no_encontrada', `motivo=${motivo}`);
  }

  /* ==================================================================
     REGRESIÓN: la fecha se entrega apenas se lee
     ------------------------------------------------------------------
     Antes, una lectura de confianza media que no se repetía obligaba a
     agotar los 32 intentos para terminar ofreciendo exactamente lo mismo.
     ================================================================ */
  {
    // Una sola lectura buena y después nada más: no hay confirmación.
    const guion = [
      { texto: '23/01/27', confianza: 0.6 },
      { texto: 'lh6 118' }
    ];
    const m = motorFalso(guion, 5);
    let resultado = null;
    const t0 = Date.now();
    await cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 8000, intervaloMs: 10, intentosConfirmacion: 2,
      onFecha: (iso, conf, mot) => { resultado = { iso, mot }; }
    });
    const duracion = Date.now() - t0;
    m.restaurar();

    chequear('entrega la fecha aunque no se confirme',
      resultado && resultado.iso === '2027-01-23',
      `devolvió ${JSON.stringify(resultado)}`);
    chequear('la marca como sin confirmar, para que el usuario la revise',
      resultado && resultado.mot === 'sin_confirmar', `motivo=${resultado && resultado.mot}`);
    /* La aserción va sobre la FRACCIÓN del presupuesto, no sobre un número
       absoluto de milisegundos: cuánto tarda cada vuelta depende de la
       máquina y del recolector de basura, y fijar un umbral en ms hace el
       test frágil sin medir nada útil. Lo que importa es que corte por
       tener la respuesta y no por agotar el tiempo. */
    chequear('no agota el presupuesto esperando una confirmación que no llega',
      duracion < 8000 * 0.6, `usó ${Math.round(duracion / 80)}% del presupuesto`);
  }

  /* ==================================================================
     Si la lectura SÍ se repite, se corta antes y con más certeza
     ================================================================ */
  {
    const m = motorFalso([{ texto: '23/01/27', confianza: 0.6 }], 5);
    let resultado = null;
    await cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 8000, intervaloMs: 10,
      onFecha: (iso, conf, mot) => { resultado = { iso, mot }; }
    });
    m.restaurar();
    chequear('dos lecturas iguales cierran como confirmada',
      resultado && resultado.mot === 'confirmada', `motivo=${resultado && resultado.mot}`);
  }

  /* ==================================================================
     REGRESIÓN: el texto crudo se emite en vivo
     ------------------------------------------------------------------
     Antes se descartaba en cada vuelta, así que el usuario no veía nada
     y un fallo era imposible de diagnosticar.
     ================================================================ */
  {
    const m = motorFalso([{ texto: 'lh6 118 v1' }], 5);
    const leidos = [];
    await cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 400, intervaloMs: 10,
      onTexto: (t) => leidos.push(t),
      onFecha: () => {}
    });
    m.restaurar();
    chequear('emite el texto crudo mientras escanea', leidos.length > 0,
      `no emitió nada en ${leidos.length} llamadas`);
    chequear('el texto emitido es el que leyó la cámara',
      leidos.some((t) => /lh6/.test(t)), JSON.stringify(leidos.slice(0, 3)));
  }

  /* ==================================================================
     Alta confianza corta de inmediato
     ================================================================ */
  {
    const m = motorFalso([{ texto: '03/27', confianza: 0.9 }], 5);
    let resultado = null;
    await cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 8000, intervaloMs: 10,
      onFecha: (iso, conf, mot) => { resultado = { iso, mot }; }
    });
    m.restaurar();
    chequear('una lectura de alta confianza no espera confirmación',
      resultado && resultado.mot === 'alta_confianza', `motivo=${resultado && resultado.mot}`);
  }

  /* ==================================================================
     El usuario puede cortar cuando quiera
     ================================================================ */
  {
    const m = motorFalso([{ texto: 'nada' }], 10);
    let avisado = false;
    const p = cap.iniciarEscaneoContinuo(video, {
      presupuestoMs: 5000, intervaloMs: 10,
      onFecha: () => { avisado = true; }
    });
    setTimeout(() => cap.detenerEscaneo(), 80);
    await p;
    m.restaurar();
    chequear('detener no dispara un aviso de fallo', !avisado,
      'reportó "no encontrada" tras una cancelación del usuario');
    chequear('detener deja el escaneo inactivo', !cap.estaEscaneando(), 'quedó activo');
  }

  const total = ok + fallos.length;
  console.log(`\nSuite de escaneo continuo — ${ok}/${total} OK\n`);
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
})();
