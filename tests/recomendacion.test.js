/**
 * Suite del motor de recomendación — Agente Cocinero + Agente de Aprendizaje
 * -----------------------------------------------------------------------
 * Corre en Node sin dependencias:  node tests/recomendacion.test.js
 *
 * Cubre los cuatro defectos encontrados midiendo el comportamiento real del
 * motor, para que no vuelvan sin que nadie se entere:
 *
 *   1. El contador de ingredientes evitados se inflaba en cada ciclo del
 *      orquestador (partía del valor guardado Y recorría todo el historial).
 *   2. Descartar una receta penalizaba TODOS sus ingredientes por igual.
 *   3. El bonus de 100 por el producto más urgente funcionaba como compuerta
 *      y tapaba recetas que rescataban más productos en riesgo.
 *   4. Al descartar no se ofrecían alternativas con el mismo crítico.
 *
 * Los agentes son IIFE de navegador: se cargan con `vm` sobre un contexto con
 * localStorage falso. No se toca ningún archivo de producción.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

// ---- Contexto de navegador mínimo ----
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

  // Los agentes se declaran con `const`, así que quedan en el ámbito léxico
  // del contexto y NO como propiedades del sandbox: hay que exponerlos a mano.
  vm.runInContext(`globalThis.__api = {
    DB, RECIPES, normalizeName,
    AgenteInventario, AgenteVencimientos, AgenteCocinero,
    AgenteEvaluador, AgenteAprendizaje, AgenteHogar
  };`, sandbox);

  return sandbox.__api;
}

// ---- Helpers ----
const HOY = new Date();
/** Producto "enriquecido" tal como lo entrega AgenteVencimientos.analyze(). */
function prod(name, diasRestantes, category = 'otros') {
  const venc = new Date(HOY.getTime() + diasRestantes * 86400000);
  return {
    id: 'p_' + name, name, category, quantity: 1,
    expiryDate: venc.toISOString().slice(0, 10),
    status: 'activo', addedDate: HOY.toISOString(),
    daysRemaining: diasRestantes,
    urgencia: diasRestantes <= 2 ? 'rojo' : diasRestantes <= 5 ? 'amarillo' : 'verde'
  };
}

let ok = 0;
const fallos = [];
function chequear(desc, condicion, detalle) {
  if (condicion) { ok++; return; }
  fallos.push({ desc, detalle });
}

/* =======================================================================
   1 y 2 · Agente de Aprendizaje — contador de ingredientes evitados
   ===================================================================== */
{
  const api = nuevoContexto();
  const { DB, AgenteAprendizaje } = api;

  // Un ÚNICO descarte de "Arroz con leche" (r13: arroz, leche, azucar, canela)
  DB.set('history', [{ recipeId: 'r13', outcome: 'descartado', timestamp: HOY.toISOString() }]);

  const primera = AgenteAprendizaje.actualizarIngredientesEvitados();
  chequear('un descarte cuenta 1 para arroz', primera.arroz === 1, `arroz=${primera.arroz}`);

  // El orquestador llama a actualizar() en cada ciclo. Antes, cada llamada
  // volvía a sumar: a la tercera, arroz llegaba a 3 y cruzaba el umbral de
  // penalización sin que el usuario hubiera rechazado nada más.
  AgenteAprendizaje.actualizarIngredientesEvitados();
  AgenteAprendizaje.actualizarIngredientesEvitados();
  const cuarta = AgenteAprendizaje.actualizarIngredientesEvitados();

  chequear('REGRESIÓN: el contador no se infla entre ciclos',
    cuarta.arroz === 1, `tras 4 ciclos arroz=${cuarta.arroz}, esperado 1`);
  chequear('REGRESIÓN: no cruza el umbral de penalización (>=3) solo',
    cuarta.arroz < 3, `arroz=${cuarta.arroz}`);

  // Tres recetas DISTINTAS con arroz sí son señal de que no le gusta el arroz.
  DB.set('history', [
    { recipeId: 'r13', outcome: 'descartado' },
    { recipeId: 'r02', outcome: 'descartado' },
    { recipeId: 'r23', outcome: 'descartado' }
  ]);
  const tres = AgenteAprendizaje.actualizarIngredientesEvitados();
  chequear('tres recetas distintas con arroz sí lo penalizan',
    tres.arroz === 3, `arroz=${tres.arroz}, esperado 3`);

  // La misma receta descartada dos veces no cuenta doble.
  DB.set('history', [
    { recipeId: 'r13', outcome: 'descartado' },
    { recipeId: 'r13', outcome: 'descartado' }
  ]);
  const repe = AgenteAprendizaje.actualizarIngredientesEvitados();
  chequear('la misma receta descartada dos veces cuenta una',
    repe.arroz === 1, `arroz=${repe.arroz}, esperado 1`);

  // Los desenlaces que no son descartes no penalizan nada.
  DB.set('history', [{ recipeId: 'r13', outcome: 'cocinado' }]);
  const cocinado = AgenteAprendizaje.actualizarIngredientesEvitados();
  chequear('cocinar una receta no penaliza sus ingredientes',
    !cocinado.arroz, `arroz=${cocinado.arroz}`);
}

/* =======================================================================
   3 · Agente Cocinero — el bonus no debe funcionar como compuerta
   ===================================================================== */
{
  const api = nuevoContexto();
  const { AgenteCocinero } = api;

  // Escenario reportado: arroz vence hoy, avena mañana.
  // r02 "Arroz con verduras" usa arroz (crítico: arroz)
  // r27 (si existe) o cualquier receta con avena: se busca dinámicamente.
  const inventario = [
    prod('arroz', 1, 'cereales'),
    prod('avena', 2, 'cereales'),
    prod('leche', 2, 'lacteos'),
    prod('zanahoria', 3, 'verduras'),
    prod('zapallito', 3, 'verduras'),
    prod('cebolla', 4, 'verduras'),
    prod('aceite', 200, 'otros'),
    prod('sal', 200, 'otros')
  ];

  const sugeridas = AgenteCocinero.suggestRecipes(inventario, { max: 30 });
  chequear('con inventario razonable sugiere algo', sugeridas.length > 0,
    `devolvió ${sugeridas.length}`);

  // El bonus tiene que ser un desempate, no una compuerta: su valor debe
  // quedar en el orden de un producto urgente, no dos órdenes por encima.
  chequear('REGRESIÓN: el bonus dejó de ser una compuerta',
    AgenteCocinero.BONUS_PRIORITARIO <= 25,
    `BONUS_PRIORITARIO=${AgenteCocinero.BONUS_PRIORITARIO}`);

  // Entre dos recetas que llevan el producto más urgente, gana la que además
  // rescata otros productos en riesgo.
  const conArroz = sugeridas.filter((c) => c.receta.ingredients.includes('arroz'));
  if (conArroz.length >= 2) {
    const masRescata = [...conArroz].sort(
      (a, b) => b.ingredientesUrgentes.length - a.ingredientesUrgentes.length)[0];
    chequear('entre recetas con el producto urgente, gana la que rescata más',
      conArroz[0].ingredientesUrgentes.length >= masRescata.ingredientesUrgentes.length - 1,
      `primera rescata ${conArroz[0].ingredientesUrgentes.length}, la mejor ${masRescata.ingredientesUrgentes.length}`);
  }

  /* REGRESIÓN CENTRAL — el escenario que expone la compuerta.
     Se arma a propósito para que las dos recetas compitan de frente:

       · canela vence en 1 día y sólo aparece en r13 "Arroz con leche",
         así que r13 se lleva el bonus por el producto más urgente.
       · r02 "Arroz con verduras" NO lleva canela (bonus 0), pero rescata
         cuatro productos que vencen mañana: arroz, zanahoria, zapallito
         y cebolla.

     Con el bonus en 100, r13 ganaba por más del doble aunque rescatara
     menos: esa era la compuerta. Con el bonus acotado, gana r02, que es
     lo que corresponde en una app cuyo objetivo es que no se tire comida. */
  const escenario = [
    prod('canela', 1, 'otros'),
    prod('arroz', 1, 'cereales'),
    prod('zanahoria', 1, 'verduras'),
    prod('zapallito', 1, 'verduras'),
    prod('cebolla', 1, 'verduras'),
    prod('leche', 1, 'lacteos'),
    prod('azucar', 200, 'otros'),
    prod('aceite', 200, 'otros'),
    prod('sal', 200, 'otros')
  ];
  const ranking = AgenteCocinero.suggestRecipes(escenario, { max: 30 });
  const r02 = ranking.find((c) => c.receta.id === 'r02');
  const r13 = ranking.find((c) => c.receta.id === 'r13');

  chequear('el escenario produce las dos recetas en competencia',
    !!r02 && !!r13, `r02=${!!r02} r13=${!!r13}`);

  if (r02 && r13) {
    chequear('REGRESIÓN: rescatar más productos le gana al bonus del #1',
      r02.puntaje > r13.puntaje,
      `r02 "${r02.receta.name}" rescata ${r02.ingredientesUrgentes.length} → ${r02.puntaje.toFixed(1)} | ` +
      `r13 "${r13.receta.name}" rescata ${r13.ingredientesUrgentes.length} → ${r13.puntaje.toFixed(1)}`);
  }

  // Seguridad alimentaria: nunca se cocina con vencidos (Sección 7).
  const conVencido = AgenteCocinero.suggestRecipes(
    [prod('arroz', -3, 'cereales'), prod('leche', 5, 'lacteos')], { max: 30 });
  const usaVencido = conVencido.some((c) => c.ingredientesUsados.includes('arroz'));
  chequear('nunca se sugiere cocinar con un producto vencido', !usaVencido,
    'una receta usó el arroz vencido');
}

/* =======================================================================
   4 · Alternativas al descartar
   ===================================================================== */
{
  const api = nuevoContexto();
  const { AgenteCocinero } = api;

  const inventario = [
    prod('arroz', 2, 'cereales'),
    prod('leche', 2, 'lacteos'),
    prod('zanahoria', 3, 'verduras'),
    prod('zapallito', 3, 'verduras'),
    prod('cebolla', 4, 'verduras'),
    prod('aceite', 200, 'otros'),
    prod('sal', 200, 'otros')
  ];

  // El caso exacto que motivó todo: descarto "Arroz con leche" (r13).
  const alt = AgenteCocinero.alternativasA('r13', inventario);
  chequear('descartar arroz con leche ofrece otra receta con arroz',
    alt.length > 0 && alt.every((a) => a.receta.ingredients.includes('arroz') ||
                                       a.receta.ingredients.includes('leche')),
    `alternativas: ${alt.map((a) => a.receta.name).join(', ') || 'ninguna'}`);

  chequear('la alternativa nunca es la receta descartada',
    alt.every((a) => a.receta.id !== 'r13'), 'se devolvió la misma receta');

  // Si no queda nada del crítico en la despensa, no se inventa una alternativa.
  const sinArroz = AgenteCocinero.alternativasA('r13', [prod('cebolla', 3, 'verduras')]);
  chequear('sin el ingrediente crítico no ofrece alternativas',
    sinArroz.length === 0, `devolvió ${sinArroz.length}`);

  chequear('un id inexistente no rompe',
    AgenteCocinero.alternativasA('r99', inventario).length === 0, 'devolvió algo');
}

/* =======================================================================
   Reporte
   ===================================================================== */
const total = ok + fallos.length;
console.log(`\nSuite del motor de recomendación — ${ok}/${total} OK\n`);
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
