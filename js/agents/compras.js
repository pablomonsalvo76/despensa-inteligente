/**
 * Agente de Compras
 * -----------------------------------------------------------------------
 * Responde al pedido explícito de la devolución docente: "qué no comprar /
 * qué comprar para poder usar con lo que está por vencer".
 *
 * Es el agente que cierra el círculo del sistema: compra → despensa →
 * consumo → compra. Y tiene una particularidad que lo distingue de una
 * lista de compras común: además de decir qué llevar, dice qué NO llevar,
 * porque comprar de más es una de las causas del desperdicio que la app
 * intenta evitar.
 */

const AgenteCompras = (() => {
  /* ----------------------------------------------------------------------
     QUÉ COMPRAR
     Estrategia: no sugerir "lo que falta en general", sino los pocos
     ingredientes que DESBLOQUEAN una receta capaz de rescatar un producto
     en riesgo. Se prioriza el mínimo esfuerzo de compra por máximo rescate:
     una receta a la que le falta 1 ingrediente vale mucho más que otra a la
     que le faltan 4.
     ---------------------------------------------------------------------- */
  function queComprar(enriquecidos) {
    /* Índice por INGREDIENTE, no por nombre de producto. Comparando texto,
       esta lista mandaba a comprar "carne" teniendo una milanesa en el
       freezer — y el mismo producto que la pantalla de recetas acababa de
       decir que alcanzaba. Se reutiliza el índice del Cocinero para que las
       dos pantallas no puedan volver a contradecirse. */
    const invMap = typeof AgenteCocinero !== 'undefined'
      ? AgenteCocinero.inventarioPorIngrediente(AgenteCocinero.inventarioDisponible(enriquecidos))
      : new Map(enriquecidos
          .filter((p) => p.urgencia !== 'vencido' && p.daysRemaining > 0)
          .map((p) => [normalizeName(p.name), p]));
    const clave = (ing) => (typeof AgenteCocinero !== 'undefined'
      ? AgenteCocinero.canonizar(ing) : normalizeName(ing));

    const enRiesgo = enriquecidos.filter((p) =>
      (p.urgencia === 'rojo' || p.urgencia === 'amarillo') && p.daysRemaining > 0);
    if (enRiesgo.length === 0) return [];

    const perfil = typeof AgenteHogar !== 'undefined' ? AgenteHogar.perfilCombinado() : null;
    const prefs = DB.get('preferences', {});
    const estado = DB.get('shoppingState', { comprados: [], ignorados: [] });
    const ignorados = new Set((estado.ignorados || []).map(normalizeName));

    const sugerencias = {}; // ingrediente -> { rescata:Set, recetas:Set, faltanConEl }

    catalogoRecetas().forEach((receta) => {
      // Respeta el hogar: no proponer comprar para una receta que alguien
      // de la casa no puede comer.
      if (perfil) {
        const veredicto = AgenteHogar.evaluarReceta(receta, perfil);
        if (!veredicto.apta) return;
      }
      for (const d of (prefs.dietary || [])) {
        if (!receta.tags.includes(d)) return;
      }

      const faltantes = receta.ingredients.filter((ing) => !invMap.has(clave(ing)));
      // Si falta demasiado, comprar para esa receta ya no es "aprovechar lo
      // que tengo": es hacer las compras del mes. Se acota a 2 faltantes.
      if (faltantes.length === 0 || faltantes.length > 2) return;

      // ¿Esta receta rescata algo que está por vencer?
      const rescata = receta.ingredients
        .map((ing) => invMap.get(clave(ing)))
        .filter((p) => p && (p.urgencia === 'rojo' || p.urgencia === 'amarillo'));
      if (rescata.length === 0) return;

      // Y los críticos que faltan tienen que ser comprables (si falta un
      // crítico, comprarlo es justamente lo que habilita la receta)
      faltantes.forEach((ing) => {
        const key = normalizeName(ing);
        if (ignorados.has(key)) return;
        if (!sugerencias[key]) {
          sugerencias[key] = {
            ingrediente: ing.replace(/_/g, ' '),
            rescata: new Set(),
            recetas: new Set(),
            minFaltantes: faltantes.length,
            urgenciaMax: 0
          };
        }
        const s = sugerencias[key];
        rescata.forEach((p) => {
          s.rescata.add(p.name);
          s.urgenciaMax = Math.max(s.urgenciaMax, 10 / Math.max(p.daysRemaining, 1));
        });
        s.recetas.add(receta.name);
        s.minFaltantes = Math.min(s.minFaltantes, faltantes.length);
      });
    });

    return Object.values(sugerencias)
      .map((s) => ({
        ingrediente: s.ingrediente,
        rescata: [...s.rescata],
        recetas: [...s.recetas].slice(0, 3),
        // Puntaje: cuánto rescata, cuántas recetas desbloquea y qué tan
        // poco hay que comprar para lograrlo.
        puntaje: s.urgenciaMax * 3 + s.recetas.size - (s.minFaltantes - 1) * 2,
        motivo: `Con esto podés cocinar ${[...s.recetas][0]} y salvar ${[...s.rescata].slice(0, 2).join(' y ')}.`
      }))
      .sort((a, b) => b.puntaje - a.puntaje)
      .slice(0, 6);
  }

  /* ----------------------------------------------------------------------
     QUÉ NO COMPRAR
     Dos fuentes, ambas basadas en datos reales del hogar:
       1. Ya tenés stock suficiente y encima está por vencer: comprar más
          garantiza tirar algo.
       2. Historial: productos que solés descartar más de lo que consumís.
          Ese patrón es exactamente el desperdicio que hay que cortar.
     ---------------------------------------------------------------------- */
  function queNoComprar(enriquecidos) {
    const avisos = [];

    // 1) Stock vigente que todavía no consumiste
    enriquecidos
      .filter((p) => p.daysRemaining > 0)
      .forEach((p) => {
        if (p.urgencia === 'rojo' || p.urgencia === 'amarillo') {
          avisos.push({
            ingrediente: p.name,
            tipo: 'stock',
            motivo: `Ya tenés ${p.quantity > 1 ? `${p.quantity} unidades` : '1'} que vence${p.daysRemaining === 1 ? ' mañana' : ` en ${p.daysRemaining} días`}. Consumí eso antes de comprar más.`
          });
        } else if (p.quantity >= 3) {
          avisos.push({
            ingrediente: p.name,
            tipo: 'stock',
            motivo: `Tenés ${p.quantity} unidades en la despensa. No hace falta reponer todavía.`
          });
        }
      });

    // 2) Patrón histórico de desperdicio por producto
    const historial = DB.get('history', []);
    const productos = AgenteInventario.getAll();
    const stats = {};
    productos.forEach((p) => {
      if (p.status === 'activo') return;
      const key = normalizeName(p.name);
      if (!stats[key]) stats[key] = { nombre: p.name, consumido: 0, descartado: 0 };
      if (p.status === 'consumido') stats[key].consumido++;
      if (p.status === 'descartado') stats[key].descartado++;
    });

    Object.values(stats).forEach((s) => {
      const total = s.consumido + s.descartado;
      // Se necesita evidencia mínima para no acusar por una sola vez
      if (total >= 3 && s.descartado > s.consumido) {
        avisos.push({
          ingrediente: s.nombre,
          tipo: 'historial',
          motivo: `Descartaste ${s.descartado} de ${total} veces que lo compraste. Quizá conviene comprar menos cantidad o más seguido.`
        });
      }
    });

    // Sin duplicados por ingrediente, priorizando el aviso de stock
    const vistos = new Set();
    return avisos.filter((a) => {
      const k = normalizeName(a.ingrediente);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).slice(0, 8);
  }

  /* --------------------- Marcar como comprado --------------------------- */
  // Al comprar algo de la lista, se ofrece cargarlo directo al inventario:
  // el círculo compra → despensa se cierra sin re-tipear.
  function marcarComprado(ingrediente) {
    const estado = DB.get('shoppingState', { comprados: [], ignorados: [] });
    estado.comprados = [...(estado.comprados || []), { ingrediente, fecha: new Date().toISOString() }].slice(-50);
    DB.set('shoppingState', estado);
  }

  function ignorar(ingrediente) {
    const estado = DB.get('shoppingState', { comprados: [], ignorados: [] });
    if (!(estado.ignorados || []).includes(ingrediente)) {
      estado.ignorados = [...(estado.ignorados || []), ingrediente];
    }
    DB.set('shoppingState', estado);
    Orquestador.log('Aprendizaje', `Compras: "${ingrediente}" ya no se va a sugerir.`);
  }

  function limpiarIgnorados() {
    const estado = DB.get('shoppingState', {});
    DB.set('shoppingState', { ...estado, ignorados: [] });
  }

  return { queComprar, queNoComprar, marcarComprado, ignorar, limpiarIgnorados };
})();
