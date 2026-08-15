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
    Float64Array, Uint8Array, Uint8ClampedArray, atob, btoa,
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

    // Sin que el usuario configure nada, ya viene disponible con el
    // proyecto Gemini de fábrica (decisión: la app funciona con IA "out
    // of the box", no depende de que cada persona arme su propio proyecto
    // Firebase). Debe poder desactivarse explícitamente igual.
    chequear('sin configurar nada, ya hay motor disponible (config de fábrica)',
      AIProvider.disponible());
    chequear('la config de fábrica es gemini con firebaseConfig real',
      AIProvider.leerConfig().motor === 'gemini' && !!AIProvider.leerConfig().gemini.firebaseConfig);

    AIProvider.configurar({ motor: 'ninguno' });
    chequear('el usuario puede desactivarlo igual', !AIProvider.disponible());

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
      if (llamado.tipo === 'imagen') return '{"textoVisible":"vence 23/01/27","producto":"Mayonesa"}';
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
     2b · Errores del modelo, traducidos
     ----------------------------------------------------------------------
     El SDK devuelve el volcado del error HTTP completo y eso se imprimía
     tal cual en pantalla: ocupaba la pantalla entera y no decía si era
     culpa del usuario, si se arreglaba solo, ni qué hacer mientras tanto.
     ==================================================================== */
  {
    const { AIProvider } = nuevoContexto().api;
    const t = (e) => AIProvider.traducirError(e).message;

    // Textual, tal como llegó a la pantalla del usuario.
    const CUOTA = 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/'
      + 'projects/despensa-inteligente-ia/models/gemini-3.6-flash:generateContent: [429 ] '
      + 'You exceeded your current quota, please check your plan and billing details. '
      + 'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. '
      + '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, '
      + 'limit: 20, model: gemini-3.6-flash Please retry in 8.245768379s. '
      + '[{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas"}]}]';

    const cuota = t(new Error(CUOTA));
    chequear('la cuota agotada se explica en una frase', cuota.length < 180, `${cuota.length} caracteres`);
    chequear('y dice cuánto esperar', /9 segundos/.test(cuota), cuota);
    chequear('sin volcar el JSON del error', !/@type|googleapis/.test(cuota), cuota);
    // Aunque el error traiga un retryDelay corto, puede ser el tope diario:
    // esperar no lo libera y el usuario quedaba en un bucle de 50 segundos.
    chequear('avisa que si se repite es el tope diario',
      /tope diario|mañana/i.test(cuota), cuota);

    /* La cuota POR DÍA no se libera esperando —Google la reinicia a la
       medianoche del Pacífico— pero el error la reporta con un retryDelay
       de segundos igual que la cuota por minuto. Prometer la espera corta
       ahí es mandar al usuario a fallar de nuevo. */
    const DIARIA = 'Quota exceeded for metric: generativelanguage.googleapis.com/'
      + 'generate_content_free_tier_requests_per_model_per_day, limit: 20, '
      + 'model: gemini-3.6-flash Please retry in 47.3s. [429]';
    const diaria = t(new Error(DIARIA));
    chequear('la cuota diaria NO promete una espera de segundos',
      !/\d+ segundos/.test(diaria), diaria);
    chequear('la cuota diaria dice cuándo se renueva',
      /hoy/i.test(diaria) && /medianoche/i.test(diaria), diaria);

    chequear('cuota sin tiempo sugerido ofrece la alternativa offline',
      /recetario/i.test(t(new Error('[429] RESOURCE_EXHAUSTED'))), t(new Error('[429] RESOURCE_EXHAUSTED')));

    chequear('un 503 se lee como sobrecarga temporal',
      /sobrecargado/i.test(t(new Error('[503] The model is overloaded'))), t(new Error('[503] UNAVAILABLE')));
    chequear('un 403 manda a revisar la credencial',
      /credencial/i.test(t(new Error('[403] PERMISSION_DENIED: API key not valid'))),
      t(new Error('[403] PERMISSION_DENIED')));
    chequear('sin red avisa que el recetario sigue andando',
      /recetario/i.test(t(new TypeError('Failed to fetch'))), t(new TypeError('Failed to fetch')));

    // Lo desconocido no se inventa ni se vuelca entero.
    const raro = t(new Error('Algo inesperado\ncon muchas líneas\ny más'.repeat(20)));
    chequear('un error desconocido se acota a una línea',
      raro.length <= 140 && !raro.includes('\n'), `${raro.length} caracteres`);
    chequear('un error vacío no deja el mensaje en blanco',
      t(new Error('')).length > 0, `"${t(new Error(''))}"`);
  }

  /* ======================================================================
     3 · AgenteCaptura.leerConVisionIA
     ==================================================================== */
  {
    const { api, estadoCanvas } = nuevoContexto();
    const { AIProvider, AgenteCaptura } = api;

    // Motor desactivado a mano (el default de fábrica es 'gemini', así
    // que hay que apagarlo explícito para probar este caso): rechaza con
    // un mensaje claro, no una excepción rara.
    AIProvider.configurar({ motor: 'ninguno' });
    await chequearAsync('sin Gemini configurado, leerConVisionIA rechaza con mensaje claro', async () => {
      try {
        await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
        return false;
      } catch (e) {
        return /no está configurada/i.test(e.message);
      }
    });

    AIProvider.configurar({ motor: 'gemini' });
    // Respuesta con la forma que pide el prompt: el modelo IDENTIFICA el
    // producto (tipo, marca, categoría) y señala cuál de las fechas del
    // envase es la de vencimiento — no devuelve un bloque de texto suelto.
    const RESPUESTA_TIPICA = JSON.stringify({
      producto: 'mayonesa', marca: 'Hellmanns', categoria: 'conservas',
      fechaVencimiento: '23/01/27',
      textoVisible: 'HELLMANNS CLASICA MAYONESA 475g LOTE L-2847 FAB 03/26 VTO 23/01/27'
    });
    AIProvider.usarMotorFalso(async () => RESPUESTA_TIPICA);

    await chequearAsync('foto sin contraste no gasta una llamada: motivo foto_ilegible', async () => {
      estadoCanvas.contraste = false;
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.motivo === 'foto_ilegible' && res.estado === 'sin_texto';
    });

    await chequearAsync('foto con contraste: usa extraerFecha() sobre la fecha que señaló el modelo', async () => {
      estadoCanvas.contraste = true;
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.fechaDetectada === '2027-01-23' && res.motor === 'vision-ia';
    });

    await chequearAsync('la visión identifica el producto, no sólo transcribe', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      const n = res.nombreDetectado;
      // Tipo adelante y marca atrás: así lo matchea el Cocinero.
      return n && /^mayonesa/i.test(n.texto) && /hellmanns/i.test(n.texto)
        && n.categoria === 'conservas' && n.confianza === 0.8;
    });

    // REGRESIÓN: antes se cortaba si `textoVisible` venía vacío y se perdía
    // el nombre que el modelo SÍ había identificado — el caso de fotografiar
    // el frente del envase, donde hay producto pero ninguna fecha.
    AIProvider.usarMotorFalso(async () =>
      '{"producto":"leche entera","marca":"La Serenisima","categoria":"lacteos","fechaVencimiento":"","textoVisible":""}');
    await chequearAsync('sin texto visible no se tira el producto identificado', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.nombreDetectado && /leche/i.test(res.nombreDetectado.texto)
        && res.nombreDetectado.categoria === 'lacteos' && res.estado === 'sin_fecha';
    });

    // La fecha del envase que NO es la de vencimiento no debe colarse: el
    // modelo señala una y el respaldo sobre el texto completo sólo corre si
    // ese campo vino vacío.
    AIProvider.usarMotorFalso(async () => JSON.stringify({
      producto: 'yogur', marca: '', categoria: 'lacteos',
      fechaVencimiento: '15/02/27',
      textoVisible: 'ELAB 01/01/26 LOTE 88 VTO 15/02/27'
    }));
    await chequearAsync('se queda con la fecha que el modelo marcó como vencimiento', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.fechaDetectada === '2027-02-15';
    });

    // El modelo "alucina" una fecha sin forma válida: extraerFecha() la
    // descarta igual que descartaría una lectura de OCR local inventada.
    AIProvider.usarMotorFalso(async () =>
      '{"textoVisible":"folio 99 lote AX-2","producto":"","fechaVencimiento":"99/99/99"}');
    await chequearAsync('una fecha sin forma válida no se acepta aunque la "lea" la IA', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.fechaDetectada === null && res.estado === 'sin_fecha';
    });

    // Una categoría que el formulario no tiene no puede guardarse: se
    // descarta el valor, no el producto.
    AIProvider.usarMotorFalso(async () =>
      '{"producto":"snack de kale","marca":"Verdex","categoria":"ultraprocesados","textoVisible":"snack"}');
    await chequearAsync('una categoría inventada por el modelo se descarta', async () => {
      const res = await AgenteCaptura.leerConVisionIA(FUENTE_FOTO);
      return res.nombreDetectado && res.nombreDetectado.categoria === null
        && /kale/i.test(res.nombreDetectado.texto);
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
