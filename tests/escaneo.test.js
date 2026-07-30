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
    /* Los datos tienen CONTRASTE a propósito. Rellenar uniforme hacía que
       `cuadroSinContenido` descartara todos los cuadros por considerarlos
       vacíos —que es justamente su trabajo— y ningún intento llegaba al
       OCR. Un patrón alternado simula una imagen con texto. */
    getImageData: () => {
      const n = Math.max(1, c.width * c.height);
      const d = new Uint8ClampedArray(n * 4);
      for (let p = 0; p < n; p++) {
        const v = (p % 7 === 0) ? 30 : 230;
        d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
        d[p * 4 + 3] = 255;
      }
      return { data: d, width: c.width, height: c.height };
    },
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

  /* ==================================================================
     REGRESIÓN: alfabeto restringido contra la alucinación del OCR
     ------------------------------------------------------------------
     Sobre un cuadro oscuro y vacío, Tesseract en modo "texto disperso"
     devolvió texto inventado:

       "ib A LK FY Se > dik hoa ad wae » Lay a 2, Rot, &3 ot & el 3 Ae sal"

     No leyó mal: no había nada y aun así produjo letras. Limitar el
     alfabeto a dígitos y separadores hace que ni siquiera pueda hacerlo.
     ================================================================ */
  {
    const conAlfabeto = cap.ESTRATEGIAS.filter((e) => e.alfabeto);
    chequear('la mayoría de las estrategias restringen el alfabeto',
      conAlfabeto.length >= cap.ESTRATEGIAS.length - 1,
      `${conAlfabeto.length} de ${cap.ESTRATEGIAS.length}`);

    chequear('ningún alfabeto admite minúsculas ni símbolos raros',
      conAlfabeto.every((e) => !/[a-z»&>]/.test(e.alfabeto)),
      `alfabeto: ${conAlfabeto[0] && conAlfabeto[0].alfabeto}`);

    // REGRESIÓN: al restringir a dígitos se rompían las fechas con el mes
    // en letras ("20 AGO 2027", "DIC 2026"), que el extractor sí soporta.
    const conMes = cap.ESTRATEGIAS.find((e) => e.alfabeto && /[A-Z]/.test(e.alfabeto));
    chequear('hay una estrategia que puede leer meses en letras',
      !!conMes, 'ninguna estrategia admite letras: AGO, DIC, etc. quedarían ilegibles');
    if (conMes) {
      const meses = ['ENE','JAN','FEB','MAR','ABR','APR','MAY','JUN','JUL',
                     'AGO','AUG','SEP','SET','OCT','NOV','DIC','DEC'];
      const sinCubrir = meses.filter((m) => [...m].some((c) => !conMes.alfabeto.includes(c)));
      chequear('ese alfabeto cubre los 17 meses que entiende el extractor',
        sinCubrir.length === 0, `sin cubrir: ${sinCubrir.join(', ')}`);
    }

    chequear('el alfabeto de fecha cubre los separadores usados en envases',
      conAlfabeto.every((e) => ['/', '-', '.', ' '].every((c) => e.alfabeto.includes(c))),
      `alfabeto: ${conAlfabeto[0] && conAlfabeto[0].alfabeto}`);

    chequear('queda una estrategia sin restricción, para leer el nombre',
      cap.ESTRATEGIAS.some((e) => !e.alfabeto), 'todas restringidas: el nombre no se podría leer');

    // El texto alucinado real, pasado por el extractor: no debe dar fecha.
    const basura = 'ib A LK FY Se > dik hoa ad wae » Lay a 2, Rot, &3 ot & el 3 Ae sal A LR AALS 8.';
    chequear('el texto alucinado no produce una fecha falsa',
      cap.extraerFecha(basura) === null, `devolvió ${cap.extraerFecha(basura)}`);
  }

  /* ==================================================================
     REGRESIÓN: portón de FORMA — que no lea números al azar
     ------------------------------------------------------------------
     Apuntando la cámara a un mármol, el OCR leyó las motas de la piedra
     como "8 - 774634" y el sistema se puso a buscarle una fecha adentro.
     El orden estaba invertido: leía cualquier cosa y después probaba si
     algún patrón matcheaba. Ahora primero se exige FORMA de fecha.
     ================================================================ */
  {
    const forma = cap.tieneFormaDeFecha;

    const debenCortar = [
      ['8 - 774634', 'ruido de un mármol'],
      ['LH6 118 V1 23:00', 'lote y hora de envasado'],
      ['500 g 250 ml', 'pesos del envase'],
      ['1234567890', 'una tira de dígitos'],
      ['', 'texto vacío']
    ];
    debenCortar.forEach(([t, d]) => {
      chequear(`el portón corta: ${d}`, !forma(t), `"${t}" pasó el portón`);
    });

    const debenPasar = [
      ['23/01/27', 'dd/mm/aa'],
      ['03/27', 'mm/aa'],
      ['20 AGO 2027', 'mes en letras'],
      ['DIC 2026', 'sólo mes y año'],
      ['vto 30-07-2027', 'con guiones y palabra clave']
    ];
    debenPasar.forEach(([t, d]) => {
      chequear(`el portón deja pasar: ${d}`, forma(t), `"${t}" fue rechazado`);
    });
  }

  /* ==================================================================
     REGRESIÓN: procedencia — la fecha no se arma con dígitos dispersos
     ================================================================ */
  {
    const conf = cap.extraerFechaConConfianza;
    const w = (t, c = 70) => ({ text: t, confidence: c });

    let r = conf('23/01/27', [w('23/01/27', 72)]);
    chequear('acepta una fecha contenida en una sola palabra',
      r.fecha === '2027-01-23', JSON.stringify(r));

    r = conf('23/01/ 27', [w('23/01/', 70), w('27', 68)]);
    chequear('acepta una fecha partida en dos palabras contiguas',
      r.fecha === '2027-01-23', JSON.stringify(r));

    r = conf('23/ 01/ 27', [w('23/', 70), w('01/', 68), w('27', 66)]);
    chequear('acepta una fecha partida en TRES palabras (psm 11 lo hace seguido)',
      r.fecha === '2027-01-23', JSON.stringify(r));

    r = conf('23 xx 01 yy 27', [w('23', 70), w('xx', 30), w('01', 70), w('yy', 30), w('27', 70)]);
    chequear('RECHAZA dígitos dispersos por la imagen',
      r.fecha === null, `aceptó ${r.fecha}`);

    /* Caso que SÓLO atrapa la regla de procedencia: el texto completo tiene
       una fecha válida —el extractor la encuentra— pero los caracteres que
       la forman vienen de palabras separadas por ruido en el medio. Sin
       esta regla se aceptaría una fecha armada con dígitos de puntas
       distintas de la imagen. */
    r = conf('03/ 774634 27', [w('03/', 70), w('774634', 40), w('27', 65)]);
    chequear('RECHAZA una fecha armada salteando ruido',
      r.fecha === null, `aceptó ${r.fecha} — se armó cruzando el lote del medio`);

    r = conf('23/01/27', [w('23/01/27', 20)]);
    chequear('RECHAZA cuando el motor duda de los caracteres',
      r.fecha === null && r.motivo === 'baja_certeza', JSON.stringify(r));

    r = conf('8 - 774634', [w('8', 40), w('-', 20), w('774634', 35)]);
    chequear('RECHAZA el ruido del mármol de punta a punta',
      r.fecha === null, `aceptó ${r.fecha}`);

    // Sin detalle por palabra (algunos modos de Tesseract no lo dan) se
    // acepta con estimación prudente: exigir procedencia ahí dejaría la
    // función inutilizable.
    r = conf('23/01/27', []);
    chequear('sin detalle por palabra sigue funcionando',
      r.fecha === '2027-01-23', JSON.stringify(r));
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
