/**
 * Suite del Proveedor de IA compartido — AIProvider, respaldo de visión y
 * generación forzada para "varios productos por vencer a la vez"
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/aiProvider.test.js
 *
 * Tres cosas se ponen a prueba, todas con motor falso (sin red real):
 *
 *   1. AIProvider en sí: la config anidada (ollama/gemini) se mezcla bien,
 *      generarConImagen rechaza si el motor no es Gemini, generarTexto
 *      rechaza si no hay motor configurado.
 *   2. AgenteCaptura.leerConVisionIA: no gasta una llamada en una foto sin
 *      contraste (mismo chequeo que ya usa el OCR local), y arma la
 *      respuesta reutilizando extraerFecha() — el modelo no puede colar
 *      una fecha con forma inválida sólo porque vino por esta vía.
 *   3. AgenteGenerador.generarParaVencer: si el modelo dice que sí usó
 *      todos los productos obligatorios pero la receta devuelta en
 *      realidad no los incluye a todos, el código lo descarta igual —
 *      pedirlo en el prompt no alcanza como garantía.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const noop = () => {};

/* Canvas falso. El contraste de lo que "devuelve la cámara" no depende de
   la fuente que se le pase a leerConVisionIA (drawImage es un no-op acá:
   no hay pixels reales que copiar) sino de este estado compartido, que el
   test cambia según qué escenario quiere simular — igual que el resto de
   la suite de captura.js resuelve este mismo problema. */
function estadoCanvasCompartido() {
  const estado = { contraste: true };
  const stub = () => {
    const c = { width: 0, height: 0, style: {}, appendChild: noop, remove: noop, addEventListener: noop };
    c.getContext = () => ({
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high', drawImage: noop,
      getImageData: () => {
        const n = Math.max(1, c.width * c.height);
        const d = new Uint8ClampedArray(n * 4);
        for (let p = 0; p < n; p++) {
          const v = estado.contraste ? ((p % 7 === 0) ? 30 : 230) : 128;
          d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
          d[p * 4 + 3] = 255;
        }
        return { data: d, width: c.width, height: c.height };
      },
      putImageData: noop
    });
    c.toDataURL = () => 'data:image/jpeg;base64,ZmFsc28=';
    return c;
  };
  return { estado, stub };
}

function nuevoContexto() {
  const almacen = {};
  const { estado: estadoCanvas, stub: stubCanvas } = estadoCanvasCompartido();
  const sandbox = {
    console, Date, Math, JSON, Set, Map, Promise, RegExp, Number, String,
    Array, Object, Error, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
    Float64Array, Uint8Array, Uint8ClampedArray,
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; },
      clear: () => Object.keys(almacen).forEach((k) => delete almacen[k])
    },
    document: {
      createElement: stubCanvas,
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, body: { appendChild: noop }
    },
    navigator: {}, fetch: () => Promise.reject(new Error('sin red')),
    Image: stubCanvas,
    URL: { createObjectURL: () => '', revokeObjectURL: noop },
    Tesseract: { createWorker: async () => ({ setParameters: async () => {}, recognize: async () => ({ data: {} }), terminate: () => {} }) }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['js/db.js', 'js/recipes.js', 'js/agents/aiProvider.js',
   'js/agents/inventario.js', 'js/agents/vencimientos.js', 'js/agents/cocinero.js',
   'js/agents/evaluador.js', 'js/agents/aprendizaje.js', 'js/agents/hogar.js',
   'js/agents/captura.js', 'js/agents/generador.js'
  ].forEach((f) => vm.runInContext(leer(f), sandbox, { filename: f }));

  vm.runInContext(`globalThis.__api = { DB, AIProvider, AgenteCaptura, AgenteCocinero, AgenteGenerador };`, sandbox);
  return { api: sandbox.__api, sandbox, estadoCanvas };
}

// Fuente con dimensiones reales (no un canvas vacío 0×0): así preprocesar()
// no descarta el frame antes de llegar al chequeo de contraste.
const FUENTE_FOTO = { naturalWidth: 200, naturalHeight: 150, width: 200, height: 150 };

const HOY = new Date();
function prod(name, dias, category = 'otros') {
  return {
    id: 'p_' + name, name, category, quantity: 1,
    expiryDate: new Date(HOY.getTime() + dias * 86400000).toISOString().slice(0, 10),
    status: 'activo', addedDate: HOY.toISOString(), daysRemaining: dias,
    urgencia: dias <= 2 ? 'rojo' : dias <= 5 ? 'amarillo' : 'verde'
  };
}

let ok = 0;
const fallos = [];
function chequear(desc, cond, detalle) {
  if (cond) { ok++; return; }
  fallos.push({ desc, detalle });
}
async function chequearAsync(desc, fn) {
  try { chequear(desc, await fn()); }
  catch (e) { fallos.push({ desc, detalle: 'excepción: ' + e.message }); }
}

(async () => {
  /* ======================================================================
     1 · AIProvider — configuración y motores
     ==================================================================== */
  {
    const { api } = nuevoContexto();
    const { AIProvider } = api;

    chequear('sin configurar, no hay motor disponible', !AIProvider.disponible());

    AIProvider.configurar({ motor: 'ollama', ollama: { url: 'http://x:1', modelo: 'llama3.2' } });
    chequear('con motor ollama, disponible() es true', AIProvider.disponible());
    chequear('ollama no soporta imágenes', !AIProvider.soportaImagenes());

    AIProvider.configurar({ motor: 'gemini', gemini: { modelo: 'gemini-2.0-flash' } });
    chequear('gemini sí soporta imágenes', AIProvider.soportaImagenes());
    // La config de ollama, seteada antes, no se pierde al cambiar de motor:
    // configurar() mezcla objeto por objeto, no reemplaza todo.
    chequear('cambiar de motor no borra la config de ollama ya guardada',
      AIProvider.leerConfig().ollama.url === 'http://x:1');
  }

  /* ======================================================================
     2 · AIProvider — motor falso, sin red real
     ==================================================================== */
  {
    const { api } = nuevoContexto();
    const { AIProvider } = api;

    AIProvider.usarMotorFalso(async (llamado) => {
      if (llamado.tipo === 'imagen') return '{"textoVisible":"vence 23/01/27","nombreProducto":"Mayonesa"}';
      return '{"name":"Test"}';
    });
    AIProvider.configurar({ motor: 'gemini' });

    await chequearAsync('generarTexto devuelve lo que da el motor falso', async () =>
      (await AIProvider.generarTexto('hola')).includes('Test'));

    await chequearAsync('generarConImagen le pasa tipo:imagen al motor falso', async () =>
      (await AIProvider.generarConImagen('leé esto', 'ZmFrZQ==')).includes('Mayonesa'));

    chequear('parsearJSON tolera texto envuelto en explicación',
      AIProvider.parsearJSON('Claro, acá tenés:\n```json\n{"a":1}\n```').a === 1);
  }

  /* ======================================================================
     3 · AgenteCaptura.leerConVisionIA
     ==================================================================== */
  {
    const { api, estadoCanvas } = nuevoContexto();
    const { AIProvider, AgenteCaptura } = api;

    // Sin motor configurado: rechaza con un mensaje claro, no una excepción rara.
    await chequearAsync('sin Gemini configurado, leerConVisionIA rechaza con mensaje claro', async () => {
      try {
        await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
        return false;
      } catch (e) {
        return /no está configurada/i.test(e.message);
      }
    });

    AIProvider.configurar({ motor: 'gemini' });
    AIProvider.usarMotorFalso(async () =>
      '{"textoVisible":"vence 23/01/27","nombreProducto":"Mayonesa"}');

    await chequearAsync('foto sin contraste no gasta una llamada: motivo foto_ilegible', async () => {
      estadoCanvas.contraste = false;
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.motivo === 'foto_ilegible' && res.estado === 'sin_texto';
    });

    await chequearAsync('foto con contraste: usa extraerFecha() sobre el texto del modelo', async () => {
      estadoCanvas.contraste = true;
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.fechaDetectada === '2027-01-23' && res.motor === 'vision-ia';
    });

    await chequearAsync('el nombre detectado por visión llega recortado y con confianza', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.nombreDetectado && res.nombreDetectado.texto === 'Mayonesa' && res.nombreDetectado.confianza === 0.8;
    });

    // El modelo "alucina" una fecha sin forma válida: extraerFecha() la
    // descarta igual que descartaría una lectura de OCR local inventada.
    AIProvider.usarMotorFalso(async () => '{"textoVisible":"folio 99 lote AX-2","nombreProducto":""}');
    await chequearAsync('una fecha sin forma válida no se acepta aunque la "lea" la IA', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.fechaDetectada === null && res.estado === 'sin_fecha';
    });
  }

  /* ======================================================================
     4 · AgenteGenerador.generarParaVencer — el código verifica la cobertura
     ==================================================================== */
  {
    const { api } = nuevoContexto();
    const { AIProvider, AgenteGenerador } = api;

    const enriquecidos = [prod('arroz', 1), prod('leche', 2), prod('cebolla', 3)];
    const prioritarios = enriquecidos.map((p) => ({ name: p.name }));

    AIProvider.configurar({ motor: 'gemini' });

    // El modelo devuelve una receta VÁLIDA (pasa validar()) pero que sólo usa
    // dos de los tres productos obligatorios: no debe aceptarse como combo.
    AIProvider.usarMotorFalso(async () => JSON.stringify({
      name: 'Arroz con leche', ingredients: ['arroz', 'leche'], critical: ['arroz'],
      steps: ['Hervir el arroz con leche.', 'Servir tibio.'], cookTimeMin: 20, servings: 2
    }));

    await chequearAsync('receta que no cubre TODOS los obligatorios se rechaza, aunque sea válida', async () => {
      const res = await AgenteGenerador.generarParaVencer(enriquecidos, prioritarios, { intentos: 1 });
      return res.receta === null &&
        res.rechazadas.some((r) => /no cubrió/.test(r.motivo) && r.motivo.includes('cebolla'));
    });

    // Ahora el modelo sí cubre los tres: se acepta.
    AIProvider.usarMotorFalso(async () => JSON.stringify({
      name: 'Arroz con leche y cebolla salteada', ingredients: ['arroz', 'leche', 'cebolla'], critical: ['arroz'],
      steps: ['Saltear la cebolla.', 'Hervir el arroz con leche.', 'Mezclar y servir.'], cookTimeMin: 25, servings: 2
    }));

    await chequearAsync('receta que cubre todos los obligatorios se acepta', async () => {
      const res = await AgenteGenerador.generarParaVencer(enriquecidos, prioritarios, { intentos: 1 });
      return res.receta && res.receta.ingredients.length === 3;
    });
  }

  const total = ok + fallos.length;
  console.log(`\nSuite del Proveedor de IA — ${ok}/${total} OK\n`);
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
