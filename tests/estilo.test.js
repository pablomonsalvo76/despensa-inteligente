/**
 * Suite de aprendizaje de estilo — Agente de Aprendizaje + Agente Cocinero
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/estilo.test.js
 *
 * Verifica que el agente aprenda QUÉ LE GUSTA al usuario (no sólo qué evita),
 * desde dos fuentes —conducta y preferencia declarada— y que ese gusto ordene
 * sin nunca pisar la urgencia ni la seguridad alimentaria.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

function nuevoContexto() {
  const almacen = {};
  const noop = () => {};
  const sandbox = {
    console, Date, Math, JSON, Set, Map, Promise, RegExp,
    Number, String, Array, Object, Error, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; },
      clear: () => Object.keys(almacen).forEach((k) => delete almacen[k])
    },
    document: { createElement: () => ({ style: {}, appendChild: noop }), addEventListener: noop,
                getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    navigator: {}, fetch: () => Promise.reject(new Error('sin red'))
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['js/db.js', 'js/recipes.js',
   'js/agents/inventario.js', 'js/agents/vencimientos.js', 'js/agents/cocinero.js',
   'js/agents/evaluador.js', 'js/agents/aprendizaje.js', 'js/agents/hogar.js'
  ].forEach((f) => vm.runInContext(leer(f), sandbox, { filename: f }));

  vm.runInContext(`globalThis.__api = {
    DB, RECIPES, AgenteCocinero, AgenteAprendizaje
  };`, sandbox);
  return sandbox.__api;
}

const HOY = new Date();
function prod(name, dias, category = 'otros') {
  const venc = new Date(HOY.getTime() + dias * 86400000);
  return {
    id: 'p_' + name, name, category, quantity: 1,
    expiryDate: venc.toISOString().slice(0, 10), status: 'activo',
    addedDate: HOY.toISOString(), daysRemaining: dias,
    urgencia: dias <= 2 ? 'rojo' : dias <= 5 ? 'amarillo' : 'verde'
  };
}

let ok = 0;
const fallos = [];
function chequear(desc, cond, detalle) {
  if (cond) { ok++; return; }
  fallos.push({ desc, detalle });
}

/* ======================================================================
   El recetario tiene que estar clasificado: sin esto no hay nada que aprender
   ==================================================================== */
{
  const { RECIPES } = nuevoContexto();
  const sinClasificar = RECIPES.filter((r) => !r.cocina || !r.estilo || !r.tipo);
  chequear('las 27 recetas están clasificadas', sinClasificar.length === 0,
    `sin clasificar: ${sinClasificar.map((r) => r.id).join(', ')}`);

  const estilos = new Set(RECIPES.map((r) => r.estilo));
  chequear('las tres franjas de elaboración existen',
    ['express', 'casera', 'elaborada'].every((e) => estilos.has(e)),
    [...estilos].join(', '));
}

/* ======================================================================
   Aprendizaje desde la CONDUCTA
   ==================================================================== */
{
  const { DB, AgenteAprendizaje } = nuevoContexto();

  // r05 y r21 son italianas; r15 también (pizza casera).
  DB.set('history', [
    { recipeId: 'r05', outcome: 'cocinado' },
    { recipeId: 'r21', outcome: 'cocinado' },
    { recipeId: 'r15', outcome: 'cocinado' }
  ]);
  const perfil = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('cocinar tres italianas deja la cocina italiana en positivo',
    perfil.cocina.italiana === 3, `italiana=${perfil.cocina.italiana}`);

  // Descartar resta.
  DB.set('history', [
    { recipeId: 'r05', outcome: 'cocinado' },
    { recipeId: 'r21', outcome: 'descartado' }
  ]);
  const mixto = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('descartar resta en la misma dimensión',
    mixto.cocina.italiana === 0, `italiana=${mixto.cocina.italiana}`);

  // Cocinar dos veces el mismo plato no es evidencia de gusto por el estilo.
  DB.set('history', [
    { recipeId: 'r05', outcome: 'cocinado' },
    { recipeId: 'r05', outcome: 'cocinado' },
    { recipeId: 'r05', outcome: 'cocinado' }
  ]);
  const repetida = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('la misma receta repetida cuenta una vez',
    repetida.cocina.italiana === 1, `italiana=${repetida.cocina.italiana}`);

  // Si cambiás de opinión, vale lo último que hiciste.
  DB.set('history', [
    { recipeId: 'r05', outcome: 'descartado' },
    { recipeId: 'r05', outcome: 'cocinado' }
  ]);
  const cambio = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('vale la última decisión sobre una receta',
    cambio.cocina.italiana === 1, `italiana=${cambio.cocina.italiana}`);

  // Recalcula desde cero: mismo bug que tenía el contador de evitados.
  const otra = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('REGRESIÓN: el perfil no se infla entre ciclos',
    otra.cocina.italiana === 1, `tras 2 ciclos italiana=${otra.cocina.italiana}`);
}

/* ======================================================================
   Aprendizaje desde la DECLARACIÓN (arranque en frío)
   ==================================================================== */
{
  const { DB, AgenteAprendizaje } = nuevoContexto();

  DB.set('history', []);
  DB.set('preferences', { estilosPreferidos: { cocina: ['italiana'], estilo: ['elaborada'] } });
  const perfil = AgenteAprendizaje.actualizarEstiloPreferido();

  chequear('sin historial, la preferencia declarada orienta igual',
    perfil.cocina.italiana > 0 && perfil.estilo.elaborada > 0,
    JSON.stringify(perfil));

  // La conducta tiene que poder contradecir a la declaración: mucha gente
  // dice que le gusta cocinar elaborado y después resuelve en 10 minutos.
  DB.set('history', [
    { recipeId: 'r04', outcome: 'descartado' },  // elaborada
    { recipeId: 'r08', outcome: 'descartado' },  // elaborada
    { recipeId: 'r12', outcome: 'descartado' },  // elaborada
    { recipeId: 'r16', outcome: 'descartado' }   // elaborada
  ]);
  const contradicho = AgenteAprendizaje.actualizarEstiloPreferido();
  chequear('la conducta puede contradecir lo declarado',
    contradicho.estilo.elaborada < 0,
    `elaborada=${contradicho.estilo.elaborada} (declarado +2, 4 descartes)`);
}

/* ======================================================================
   El gusto ORDENA pero no MANDA
   ==================================================================== */
{
  const { DB, AgenteCocinero } = nuevoContexto();

  chequear('la afinidad está acotada', AgenteCocinero.MAX_AFINIDAD <= 10,
    `MAX_AFINIDAD=${AgenteCocinero.MAX_AFINIDAD}`);

  // Perfil exageradamente sesgado a propósito: aunque el usuario hubiera
  // cocinado cincuenta italianas, el aporte del gusto sigue acotado.
  const extremo = { cocina: { italiana: 50 }, estilo: { casera: 50 }, tipo: { principal: 50 } };
  const recetaItaliana = { cocina: 'italiana', estilo: 'casera', tipo: 'principal' };
  chequear('un perfil extremo no desborda el tope',
    AgenteCocinero.afinidadEstilo(recetaItaliana, extremo) === AgenteCocinero.MAX_AFINIDAD,
    `afinidad=${AgenteCocinero.afinidadEstilo(recetaItaliana, extremo)}`);

  const extremoNegativo = { cocina: { italiana: -50 }, estilo: {}, tipo: {} };
  chequear('el recorte es simétrico para el disgusto',
    AgenteCocinero.afinidadEstilo(recetaItaliana, extremoNegativo) === -AgenteCocinero.MAX_AFINIDAD,
    `afinidad=${AgenteCocinero.afinidadEstilo(recetaItaliana, extremoNegativo)}`);

  // El tope tiene que ser menor que lo que aporta UN producto urgente
  // (pesoUrgencia de 1 día = 10, multiplicado por 2 = 20).
  chequear('el gusto pesa menos que un producto a punto de vencer',
    AgenteCocinero.MAX_AFINIDAD < 20, `MAX_AFINIDAD=${AgenteCocinero.MAX_AFINIDAD}`);

  // Seguridad alimentaria: el gusto nunca habilita un vencido.
  DB.set('stylePreferences', extremo);
  const conVencido = AgenteCocinero.suggestRecipes(
    [prod('fideos', -2, 'cereales'), prod('tomate', 4, 'verduras'),
     prod('queso', 5, 'lacteos'), prod('aceite', 200), prod('sal', 200)], { max: 30 });
  chequear('el gusto no habilita cocinar con vencidos',
    !conVencido.some((c) => c.ingredientesUsados.includes('fideos')),
    'una receta usó los fideos vencidos');
}

/* ======================================================================
   Reserva de exploración — que el gusto no encierre al usuario
   ==================================================================== */
{
  const { DB, AgenteCocinero } = nuevoContexto();

  const despensa = [
    prod('fideos', 3, 'cereales'), prod('tomate', 3, 'verduras'),
    prod('queso', 3, 'lacteos'), prod('huevo', 3, 'huevos'),
    prod('papa', 3, 'verduras'), prod('cebolla', 3, 'verduras'),
    prod('leche', 3, 'lacteos'), prod('banana', 3, 'frutas'),
    prod('yogur', 3, 'lacteos'), prod('zapallito', 3, 'verduras'),
    prod('zanahoria', 3, 'verduras'), prod('manteca', 200), prod('aceite', 200),
    prod('sal', 200), prod('harina', 200), prod('azucar', 200)
  ];

  /* Se usa la dimensión `tipo` a propósito: 15 de las 27 recetas son
     "principal", así que sin reserva de exploración el top entero queda
     capturado por el gusto. Con `cocina: italiana` el test no discriminaría,
     porque sólo hay 3 italianas y la tercera posición ya cae sola en algo
     neutro — pasaría aunque el mecanismo no existiera. */
  DB.set('stylePreferences', { cocina: {}, estilo: {}, tipo: { principal: 6 } });

  const sug = AgenteCocinero.suggestRecipes(despensa, { max: 3 });
  chequear('con perfil sesgado igual sugiere el máximo pedido',
    sug.length === 3, `devolvió ${sug.length}`);

  chequear('REGRESIÓN: se reserva un lugar para explorar fuera del gusto',
    sug.some((c) => c.esExploracion),
    `sugeridas: ${sug.map((c) => `${c.receta.name}(${c.afinidadEstilo})`).join(' | ')}`);

  const todasFavorecidas = sug.every((c) => (c.afinidadEstilo || 0) > 0);
  chequear('la lista no queda 100% capturada por el gusto aprendido',
    !todasFavorecidas,
    `afinidades: ${sug.map((c) => c.afinidadEstilo).join(', ')}`);

  chequear('la primera posición la sigue mandando la urgencia, no la exploración',
    !sug[0].esExploracion, 'la exploración desplazó a la más urgente');

  // Sin perfil, el comportamiento tiene que ser el de siempre.
  DB.set('stylePreferences', null);
  const neutro = AgenteCocinero.suggestRecipes(despensa, { max: 3 });
  chequear('sin perfil aprendido, ninguna receta recibe afinidad',
    neutro.every((c) => (c.afinidadEstilo || 0) === 0),
    `afinidades: ${neutro.map((c) => c.afinidadEstilo).join(', ')}`);
}

const total = ok + fallos.length;
console.log(`\nSuite de aprendizaje de estilo — ${ok}/${total} OK\n`);
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
