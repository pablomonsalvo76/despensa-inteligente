/**
 * Agente Generador de Recetas (capa 2 del Agente Cocinero)
 * -----------------------------------------------------------------------
 * Un recetario fijo no es un agente cocinero: es una tabla de consulta. Con
 * 27 recetas y 35 ingredientes, aprender que al usuario le gusta la cocina
 * italiana sirve de poco, porque hay tres platos italianos para ofrecerle.
 * Este agente levanta ese techo: genera recetas a partir de lo que REALMENTE
 * hay en la despensa y del estilo que el Agente de Aprendizaje dedujo.
 *
 * ARQUITECTURA EN DOS CAPAS
 *   · Recetario local  = piso garantizado. Siempre responde, offline, sin
 *     modelo. Es la red de seguridad y nunca se apaga.
 *   · Generación       = techo. Cuando hay un modelo disponible, propone.
 *
 * EL PRINCIPIO QUE ORDENA TODO EL ARCHIVO
 *   El modelo PROPONE, el código determinístico VETA.
 *
 * Esto no es una precaución genérica: esta app guarda alergias y condiciones
 * médicas de los comensales, y la Sección 7 del documento establece que la
 * seguridad alimentaria prevalece sobre cualquier otro criterio. Un modelo
 * que alucina un ingrediente es un riesgo real, no una molestia. Por eso
 * NINGUNA receta generada llega al usuario sin pasar por `validar()`, que es
 * una función pura, sin red, y testeada aparte con salidas adversarias.
 *
 * LISTA CERRADA
 *   Al modelo se le entrega la despensa y se le exige usar SÓLO eso. Una
 *   receta que nombre cualquier otro ingrediente se rechaza entera. Esto
 *   hace verificable la restricción de alergias —no se puede garantizar que
 *   algo esté libre de alérgenos si no se sabe qué es— y de paso desactiva
 *   la inyección de prompt: aunque un nombre de producto leído por OCR
 *   trajera instrucciones y el modelo las obedeciera, no puede producir nada
 *   fuera de la lista sin que el validador lo tire.
 */

const AgenteGenerador = (() => {
  // Básicos que se asumen presentes en cualquier cocina y que el modelo puede
  // usar sin que estén cargados en el inventario. Deliberadamente cortísima:
  // cada agregado es una cosa más que el validador no puede verificar contra
  // la despensa real.
  const BASICOS = ['sal', 'agua', 'pimienta'];

  /* Clasificación mínima para poder VERIFICAR las pautas alimentarias en vez
     de confiar en los tags que declare el modelo. Si el usuario es vegano y
     el modelo devuelve `tags: ['vegano']` sobre una receta con pollo, lo que
     vale es esta tabla, no lo que el modelo dijo de sí mismo. */
  const ORIGEN_ANIMAL = {
    carne: 'carne', pollo: 'carne', chorizo: 'carne', jamon: 'carne',
    pescado: 'carne', atun: 'carne',
    leche: 'lacteo', queso: 'lacteo', yogur: 'lacteo', manteca: 'lacteo', crema: 'lacteo',
    huevo: 'huevo', miel: 'animal'
  };
  const VETO_DIETA = {
    vegetariano: ['carne'],
    vegano: ['carne', 'lacteo', 'huevo', 'animal']
  };

  /* La configuración del motor (Ollama/Gemini/ninguno) vive en un solo
     lugar: AIProvider. Este agente ya no gestiona su propia conexión al
     modelo — sólo arma el prompt, pide texto y valida lo que vuelve. Estos
     tres nombres se mantienen como fachada fina para no romper a quien ya
     los llama (main.js), pero delegan enteros. */
  function configurar(nueva) { return AIProvider.configurar(nueva); }
  function leerConfig() { return AIProvider.leerConfig(); }
  function disponible() { return AIProvider.disponible(); }
  function usarMotorFalso(fn) { return AIProvider.usarMotorFalso(fn); }
  function parsearJSON(texto) { return AIProvider.parsearJSON(texto); }

  /* =====================================================================
     VALIDACIÓN — función pura, sin red. Es el corazón de la seguridad.
     Devuelve { ok:true, receta } o { ok:false, motivo }.
     ===================================================================== */
  function validar(cruda, { disponibles, prefs = {}, perfilHogar = null } = {}) {
    const rechazo = (motivo) => ({ ok: false, motivo });

    if (!cruda || typeof cruda !== 'object') return rechazo('no es un objeto');

    // --- Forma ---
    const name = typeof cruda.name === 'string' ? cruda.name.trim() : '';
    if (name.length < 3 || name.length > 60) return rechazo('nombre inválido');

    if (!Array.isArray(cruda.ingredients) || !cruda.ingredients.length) return rechazo('sin ingredientes');
    if (cruda.ingredients.length > 12) return rechazo('demasiados ingredientes');
    if (!cruda.ingredients.every((i) => typeof i === 'string' && i.trim())) return rechazo('ingrediente vacío');

    if (!Array.isArray(cruda.steps) || cruda.steps.length < 2) return rechazo('sin pasos suficientes');
    if (cruda.steps.length > 15) return rechazo('demasiados pasos');
    if (!cruda.steps.every((s) => typeof s === 'string' && s.trim().length >= 5 && s.length <= 400)) {
      return rechazo('paso inválido');
    }

    const cookTimeMin = Number(cruda.cookTimeMin);
    if (!Number.isFinite(cookTimeMin) || cookTimeMin < 1 || cookTimeMin > 300) return rechazo('tiempo inválido');
    const servings = Number(cruda.servings);
    if (!Number.isFinite(servings) || servings < 1 || servings > 12) return rechazo('porciones inválidas');

    const ingredientes = cruda.ingredients.map((i) => normalizeName(i));
    if (new Set(ingredientes).size !== ingredientes.length) return rechazo('ingredientes repetidos');

    // --- LISTA CERRADA: sólo lo que hay en la despensa, más los básicos ---
    // Es lo que hace verificable todo lo que sigue: no se puede afirmar que
    // una receta está libre de un alérgeno si contiene algo no identificado.
    const permitidos = new Set([...disponibles.keys(), ...BASICOS]);
    const invasores = ingredientes.filter((i) => !permitidos.has(i));
    if (invasores.length) return rechazo(`usa ingredientes que no tenés: ${invasores.join(', ')}`);

    // --- Críticos: deben existir en la despensa (nunca sólo en los básicos) ---
    const critical = Array.isArray(cruda.critical) ? cruda.critical.map(normalizeName) : [];
    if (critical.some((c) => !ingredientes.includes(c))) return rechazo('crítico ausente de la receta');
    if (critical.some((c) => !disponibles.has(c))) return rechazo('crítico que no está en la despensa');

    // --- ALERGIAS: filtro duro e innegociable (Sección 7) ---
    const alergias = (prefs.allergies || []).map(normalizeName).filter(Boolean);
    const alergeno = ingredientes.find((i) => alergias.includes(i));
    if (alergeno) return rechazo(`contiene ${alergeno}, declarado como alergia`);

    // --- PAUTAS ALIMENTARIAS: se verifican, no se creen ---
    // Los tags que devuelve el modelo se descartan por completo: se recalculan
    // acá desde los ingredientes reales.
    for (const dieta of prefs.dietary || []) {
      const vetados = VETO_DIETA[dieta];
      if (!vetados) continue;
      const culpable = ingredientes.find((i) => vetados.includes(ORIGEN_ANIMAL[i]));
      if (culpable) return rechazo(`${culpable} no es apto para la pauta "${dieta}"`);
    }

    const receta = {
      id: 'gen_' + Math.random().toString(36).slice(2, 9),
      name, ingredients: ingredientes, critical,
      steps: cruda.steps.map((s) => s.trim()),
      cookTimeMin: Math.round(cookTimeMin),
      servings: Math.round(servings),
      tags: tagsVerificados(ingredientes),
      cocina: typeof cruda.cocina === 'string' ? normalizeName(cruda.cocina) : 'internacional',
      estilo: cookTimeMin <= 10 ? 'express' : cookTimeMin >= 40 ? 'elaborada' : 'casera',
      tipo: typeof cruda.tipo === 'string' ? normalizeName(cruda.tipo) : 'principal',
      generada: true
    };

    // --- Último filtro: el veredicto del hogar (alergias y condiciones de
    // TODOS los comensales, no sólo del titular del teléfono) ---
    if (perfilHogar && typeof AgenteHogar !== 'undefined') {
      const veredicto = AgenteHogar.evaluarReceta(receta, perfilHogar);
      if (!veredicto.apta) return rechazo(`el hogar la bloquea: ${veredicto.bloqueos.join('; ')}`);
    }

    return { ok: true, receta };
  }

  // Los tags se derivan de los ingredientes, nunca de lo que declare el modelo.
  function tagsVerificados(ingredientes) {
    const origenes = ingredientes.map((i) => ORIGEN_ANIMAL[i]).filter(Boolean);
    const tags = [];
    if (!origenes.includes('carne')) tags.push('vegetariano');
    if (!origenes.length) tags.push('vegano');
    return tags;
  }

  /* =====================================================================
     PROMPT
     ===================================================================== */
  // Los nombres de producto vienen de OCR y de entrada libre del usuario:
  // son texto no confiable que termina dentro del prompt. Se los limpia de
  // saltos de línea y caracteres de control, que es el vehículo habitual de
  // la inyección. La defensa real igual es la lista cerrada del validador:
  // esto sólo reduce la superficie.
  function sanitizar(texto) {
    return String(texto).replace(/[\r\n\t]+/g, ' ').replace(/[^\p{L}\p{N} .,%-]/gu, '').trim().slice(0, 40);
  }

  // `obligatorios`: nombres de producto que la receta DEBE usar, todos. Lo
  // usa `generarParaVencer` para el caso "varios productos por vencer a la
  // vez" (Agente Cocinero, `recetasParaVencer`): a diferencia del pedido
  // general, acá no alcanza con "priorizar", el combo tiene que incluirlos
  // sí o sí — y el código lo vuelve a chequear después (ver más abajo),
  // porque pedirlo en el prompt no lo garantiza.
  function armarPrompt(disponibles, perfilEstilo, prefs, obligatorios = []) {
    // La ubicación va en la lista por una razón de cocina, no de prolijidad:
    // un ingrediente que está en el freezer necesita descongelarse, y una
    // receta que no lo dice no se puede seguir. Al modelo se le da el dato
    // para que lo incorpore a los pasos; quién le cuenta al usuario dónde
    // está cada cosa es el Cocinero (`desglosarIngredientes`), no el modelo.
    const lista = [...disponibles.values()]
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .map((p) => `- ${sanitizar(p.name)} (en ${sanitizar(p.location || 'Heladera')}, vence en ${p.daysRemaining} día/s)`)
      .join('\n');

    const gustos = [];
    ['cocina', 'estilo'].forEach((d) => {
      Object.entries((perfilEstilo && perfilEstilo[d]) || {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 2)
        .forEach(([v]) => gustos.push(v));
    });

    const restricciones = [
      ...(prefs.allergies || []).map((a) => `PROHIBIDO usar ${sanitizar(a)} (alergia)`),
      ...(prefs.dietary || []).map((d) => `la receta debe ser ${sanitizar(d)}`)
    ];

    const nombresObligatorios = obligatorios.map(sanitizar).filter(Boolean);

    return [
      'Sos un cocinero que evita el desperdicio de alimentos.',
      'Creá UNA receta usando SOLAMENTE los ingredientes de esta lista.',
      nombresObligatorios.length
        ? `La receta TIENE que usar TODOS estos productos, sin excepción: ${nombresObligatorios.join(', ')}.`
        : 'Priorizá los que vencen antes.',
      // El pedido explícito de completar con el resto de la despensa. Sin
      // esto el modelo tiende a cocinar SÓLO con lo obligatorio y devuelve
      // platos pobres —"espinaca salteada"— cuando el usuario tenía queso y
      // huevos ahí al lado para una tarta. Aprovechar lo que ya está en la
      // casa es justamente el objetivo de la app.
      'Completá la receta con los demás ingredientes de la lista que hagan',
      'falta para que sea un plato de verdad y no una mezcla forzada.',
      'Preferí los que ya están en la casa antes que una versión más pobre',
      'del plato. Si usás algo que está en Freezer, el primer paso tiene que',
      'ser descongelarlo.',
      '',
      'DESPENSA:', lista,
      '', `Podés asumir que hay: ${BASICOS.join(', ')}.`,
      gustos.length ? `Al usuario le gusta: ${gustos.join(', ')}.` : '',
      restricciones.length ? `RESTRICCIONES OBLIGATORIAS:\n- ${restricciones.join('\n- ')}` : '',
      '',
      'Respondé SÓLO con JSON válido, sin texto alrededor, con esta forma:',
      '{"name":"","ingredients":[],"critical":[],"steps":["",""],"cookTimeMin":25,"servings":2,"cocina":"","tipo":""}',
      'No inventes ingredientes que no estén en la lista.'
    ].filter(Boolean).join('\n');
  }

  /* =====================================================================
     GENERACIÓN
     ===================================================================== */
  async function generar(enriquecidos, { intentos = 2 } = {}) {
    const prefs = DB.get('preferences', {});
    const perfilEstilo = DB.get('stylePreferences', null);
    const perfilHogar = typeof AgenteHogar !== 'undefined' ? AgenteHogar.perfilCombinado() : null;

    // Se reutiliza el pool del Cocinero: ya excluye vencidos, que es la regla
    // de seguridad más importante y no puede depender de este archivo.
    const disponibles = AgenteCocinero.inventarioDisponible(enriquecidos);
    if (!disponibles.size) return { recetas: [], rechazadas: [], motivo: 'no hay ingredientes aptos' };

    const prompt = armarPrompt(disponibles, perfilEstilo, prefs);
    const recetas = [];
    const rechazadas = [];

    for (let i = 0; i < intentos; i++) {
      let cruda;
      try {
        cruda = AIProvider.parsearJSON(await AIProvider.generarTexto(prompt));
      } catch (e) {
        rechazadas.push({ motivo: e.message });
        break; // si el motor falla, reintentar no cambia nada
      }
      if (!cruda) { rechazadas.push({ motivo: 'el modelo no devolvió JSON válido' }); continue; }

      const v = validar(cruda, { disponibles, prefs, perfilHogar });
      if (v.ok) recetas.push(v.receta);
      else rechazadas.push({ motivo: v.motivo, nombre: cruda.name });
    }

    return { recetas, rechazadas };
  }

  /* ---- Combo generado para "varios productos por vencer a la vez" ------
     Respalda a `AgenteCocinero.recetasParaVencer`: cuando el catálogo fijo
     de 27 recetas no tiene ninguna que use TODOS los productos prioritarios
     (el caso normal — 27 recetas cubren 35 ingredientes, la despensa real
     tiene muchos más), se le pide al modelo una receta a medida que sí los
     use a todos.

     No alcanza con pedirlo en el prompt: el código VUELVE A CHEQUEAR que
     la receta devuelta contenga cada producto obligatorio, después de
     pasar `validar()`. Si el modelo "se olvidó" de alguno, se descarta —
     mismo principio que el resto del archivo, aplicado a un requisito
     nuevo (cobertura completa) además de a la seguridad alimentaria. */
  async function generarParaVencer(enriquecidos, prioritarios, { intentos = 2 } = {}) {
    const prefs = DB.get('preferences', {});
    const perfilEstilo = DB.get('stylePreferences', null);
    const perfilHogar = typeof AgenteHogar !== 'undefined' ? AgenteHogar.perfilCombinado() : null;

    const disponibles = AgenteCocinero.inventarioDisponible(enriquecidos);
    if (!disponibles.size) return { receta: null, rechazadas: [], motivo: 'no hay ingredientes aptos' };

    const nombresObligatorios = (prioritarios || []).map((p) => p.name);
    const prompt = armarPrompt(disponibles, perfilEstilo, prefs, nombresObligatorios);
    const rechazadas = [];

    for (let i = 0; i < intentos; i++) {
      let cruda;
      try {
        cruda = AIProvider.parsearJSON(await AIProvider.generarTexto(prompt));
      } catch (e) {
        rechazadas.push({ motivo: e.message });
        break;
      }
      if (!cruda) { rechazadas.push({ motivo: 'el modelo no devolvió JSON válido' }); continue; }

      const v = validar(cruda, { disponibles, prefs, perfilHogar });
      if (!v.ok) { rechazadas.push({ motivo: v.motivo, nombre: cruda.name }); continue; }

      const ingredientesReceta = new Set(v.receta.ingredients);
      const faltantes = nombresObligatorios.filter((n) => !ingredientesReceta.has(normalizeName(n)));
      if (faltantes.length) {
        rechazadas.push({ motivo: `no cubrió: ${faltantes.join(', ')}`, nombre: v.receta.name });
        continue;
      }

      return { receta: v.receta, rechazadas };
    }

    return { receta: null, rechazadas };
  }

  return {
    generar, generarParaVencer, validar, armarPrompt, parsearJSON, sanitizar,
    configurar, leerConfig, disponible, usarMotorFalso,
    BASICOS, ORIGEN_ANIMAL, VETO_DIETA
  };
})();
