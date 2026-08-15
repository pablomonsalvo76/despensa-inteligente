/**
 * Agente de Perfil del Hogar
 * -----------------------------------------------------------------------
 * Responde a la observación central de la devolución docente: "el agente debe
 * conocer al usuario y a quienes comen con este: gustos, necesidades,
 * alergias, problemas médicos e historia".
 *
 * Modela a los COMENSALES, no sólo al dueño del teléfono. Una recomendación
 * que ignora que en la casa hay alguien celíaco o hipertenso no es útil: es
 * peligrosa. Por eso este agente entrega al Cocinero un "perfil combinado"
 * del hogar con el que filtrar y puntuar.
 *
 * IMPORTANTE — alcance sanitario: la app NO da consejo médico. Las
 * condiciones se usan como filtros y advertencias de sentido común
 * (por ejemplo, marcar como no apta una receta con gluten si hay una persona
 * celíaca). Cualquier indicación clínica corresponde a un profesional.
 */

const AgenteHogar = (() => {
  /* ----------------------------------------------------------------------
     Propiedades de los ingredientes.
     Se declaran una vez por ingrediente en lugar de etiquetar a mano las 27
     recetas: así, al agregar recetas nuevas, las restricciones se derivan
     solas y no hay riesgo de olvidar una etiqueta (que en salud sería grave).
     ---------------------------------------------------------------------- */
  const PROPIEDADES = {
    // gluten
    harina:     { gluten: true },
    fideos:     { gluten: true },
    pan:        { gluten: true },
    pan_rallado:{ gluten: true },
    avena:      { gluten: true }, // por contaminación cruzada habitual
    // lactosa
    leche:      { lactosa: true },
    queso:      { lactosa: true, sodio: 'alto', grasa: 'alta' },
    yogur:      { lactosa: true },
    manteca:    { lactosa: true, grasa: 'alta' },
    // sodio
    sal:        { sodio: 'alto' },
    caldo:      { sodio: 'alto' },
    jamon:      { sodio: 'alto', grasa: 'alta' },
    chorizo:    { sodio: 'alto', grasa: 'alta' },
    // azúcares
    azucar:     { azucar: 'alto' },
    banana:     { azucar: 'medio' },
    uva:        { azucar: 'medio' },
    manzana:    { azucar: 'medio' },
    naranja:    { azucar: 'medio' },
    // grasas
    carne:      { grasa: 'alta' },
    aceite:     { grasa: 'media' },
    huevo:      { grasa: 'media' },
    // el resto se considera neutro
  };

  // Condiciones médicas soportadas y qué implica cada una.
  const CONDICIONES = {
    celiaquia:   { etiqueta: 'Celiaquía',              evita: 'gluten',  duro: true },
    lactosa:     { etiqueta: 'Intolerancia a lactosa', evita: 'lactosa', duro: true },
    diabetes:    { etiqueta: 'Diabetes',               limita: 'azucar', duro: false },
    hipertension:{ etiqueta: 'Hipertensión',           limita: 'sodio',  duro: false },
    colesterol:  { etiqueta: 'Colesterol alto',        limita: 'grasa',  duro: false }
  };

  const DIETAS = {
    vegetariano: 'Vegetariano',
    vegano: 'Vegano',
    sin_tacc: 'Sin TACC'
  };

  /* ---------------------------- CRUD comensales ------------------------- */
  function comensales() {
    return DB.get('household', []);
  }

  function agregar({ nombre, alergias = [], dietas = [], condiciones = [], gusta = [], noGusta = [], notas = '' }) {
    if (!nombre || !nombre.trim()) throw new Error('El comensal necesita un nombre.');
    const c = {
      id: DB.uid(),
      nombre: nombre.trim(),
      alergias: normalizarLista(alergias),
      dietas,
      condiciones,
      gusta: normalizarLista(gusta),
      noGusta: normalizarLista(noGusta),
      notas: notas.trim(),
      creado: new Date().toISOString()
    };
    DB.push('household', c);
    Orquestador.notifyEvent('hogar_actualizado', { agente: 'Hogar', comensal: c });
    return c;
  }

  function editar(id, cambios) {
    const patch = { ...cambios };
    ['alergias', 'gusta', 'noGusta'].forEach((k) => {
      if (patch[k]) patch[k] = normalizarLista(patch[k]);
    });
    const actualizado = DB.update('household', id, patch);
    Orquestador.notifyEvent('hogar_actualizado', { agente: 'Hogar', comensal: actualizado });
    return actualizado;
  }

  function eliminar(id) {
    DB.remove('household', id);
    Orquestador.notifyEvent('hogar_actualizado', { agente: 'Hogar' });
  }

  function normalizarLista(lista) {
    if (typeof lista === 'string') lista = lista.split(',');
    return (lista || []).map((s) => String(s).trim()).filter(Boolean);
  }

  /* ------------------------- Perfil combinado --------------------------- */
  /**
   * Combina a todos los comensales en un único perfil para el Cocinero.
   * Criterio: las restricciones se UNEN (si una sola persona es alérgica al
   * maní, la casa entera no come maní) y las dietas se INTERSECAN sólo si
   * todos las comparten — un vegetariano en la casa no obliga a que el plato
   * sea vegetariano, pero sí obliga a advertirlo.
   */
  function perfilCombinado() {
    const gente = comensales();
    const prefs = DB.get('preferences', {});

    // Alergias del titular (Preferencias) + de todos los comensales
    const alergias = new Set(normalizarLista(prefs.allergies || []).map(normalizeName));
    const evitarDuro = new Set();     // gluten / lactosa por condición médica
    const limitar = new Set();        // sodio / azúcar / grasa por condición
    const gusta = {};                 // ingrediente -> cuánta gente lo quiere
    const noGusta = {};               // ingrediente -> cuánta gente lo rechaza
    const dietasPorPersona = [];

    gente.forEach((c) => {
      c.alergias.forEach((a) => alergias.add(normalizeName(a)));
      (c.condiciones || []).forEach((k) => {
        const cond = CONDICIONES[k];
        if (!cond) return;
        if (cond.duro) evitarDuro.add(cond.evita);
        if (cond.limita) limitar.add(cond.limita);
      });
      (c.dietas || []).forEach(() => {});
      dietasPorPersona.push({ nombre: c.nombre, dietas: c.dietas || [] });
      c.gusta.forEach((g) => { gusta[normalizeName(g)] = (gusta[normalizeName(g)] || 0) + 1; });
      c.noGusta.forEach((g) => { noGusta[normalizeName(g)] = (noGusta[normalizeName(g)] || 0) + 1; });
    });

    // Las dietas del titular (Preferencias) siguen siendo un filtro duro
    (prefs.dietary || []).forEach((d) => {
      if (d === 'sin_tacc') evitarDuro.add('gluten');
    });

    return {
      cantidadComensales: gente.length,
      alergias: [...alergias],
      evitarDuro: [...evitarDuro],
      limitar: [...limitar],
      gusta, noGusta,
      dietasTitular: prefs.dietary || [],
      dietasPorPersona,
      comensales: gente
    };
  }

  /* --------------------- Evaluación de una receta ----------------------- */
  /**
   * Dice si una receta es apta para el hogar y por qué.
   * Devuelve { apta, bloqueos:[], advertencias:[], afinidad:number }
   *  - bloqueos: motivos por los que NO debe ofrecerse (alergia, celiaquía…)
   *  - advertencias: no bloquean, pero hay que avisarlas (sodio alto con
   *    hipertensión, plato con carne si alguien es vegetariano…)
   *  - afinidad: puntaje por gustos declarados, para ordenar
   */
  function evaluarReceta(receta, perfil = perfilCombinado()) {
    const bloqueos = [];
    const advertencias = [];
    let afinidad = 0;

    /* Por ingrediente canónico, no por texto: en la despensa dice "Milanesa"
       y en la receta dice `carne`. Comparando literales, un comensal con
       alergia a la carne recibiría la receta. Es el mismo criterio que usan
       el Cocinero y el validador del Generador. */
    const canon = (n) => (typeof AgenteCocinero !== 'undefined'
      ? AgenteCocinero.canonizar(n) : normalizeName(n));
    const ingredientes = receta.ingredients.map(canon);

    // 1) Alergias: filtro duro e innegociable
    perfil.alergias.forEach((al) => {
      if (ingredientes.includes(canon(al))) bloqueos.push(`contiene ${al} (alergia declarada)`);
    });

    // 2) Condiciones médicas de exclusión total
    perfil.evitarDuro.forEach((prop) => {
      const culpables = receta.ingredients.filter((ing) => (PROPIEDADES[normalizeName(ing)] || {})[prop]);
      if (culpables.length) {
        const quien = perfil.comensales.find((c) =>
          (c.condiciones || []).some((k) => CONDICIONES[k] && CONDICIONES[k].evita === prop));
        bloqueos.push(`tiene ${prop} (${culpables.join(', ')})${quien ? ` — ${quien.nombre}` : ''}`);
      }
    });

    // 3) Condiciones que limitan sin prohibir: se advierte, no se bloquea
    perfil.limitar.forEach((prop) => {
      const altos = receta.ingredients.filter((ing) => {
        const p = PROPIEDADES[normalizeName(ing)] || {};
        return p[prop] === 'alto' || p[prop] === 'alta';
      });
      if (altos.length) {
        const quien = perfil.comensales.find((c) =>
          (c.condiciones || []).some((k) => CONDICIONES[k] && CONDICIONES[k].limita === prop));
        advertencias.push(`${prop} elevado por ${altos.join(', ')}${quien ? ` — cuidar por ${quien.nombre}` : ''}`);
      }
    });

    // 4) Dietas de cada comensal: advertencia de para quién no sirve
    perfil.dietasPorPersona.forEach(({ nombre, dietas }) => {
      dietas.forEach((d) => {
        if (!receta.tags.includes(d)) {
          advertencias.push(`no es ${DIETAS[d] ? DIETAS[d].toLowerCase() : d}: ${nombre} no puede comerlo`);
        }
      });
    });

    // 5) Gustos: suman o restan afinidad (no bloquean nunca)
    ingredientes.forEach((ing) => {
      if (perfil.gusta[ing]) afinidad += 2 * perfil.gusta[ing];
      if (perfil.noGusta[ing]) afinidad -= 3 * perfil.noGusta[ing];
    });

    return { apta: bloqueos.length === 0, bloqueos, advertencias, afinidad };
  }

  // Resumen legible del hogar, para mostrar en pantalla y en el chatbot.
  function resumen() {
    const gente = comensales();
    if (gente.length === 0) return 'Todavía no cargaste a los comensales de tu casa.';
    const perfil = perfilCombinado();
    const partes = [`${gente.length} comensal(es): ${gente.map((c) => c.nombre).join(', ')}`];
    if (perfil.alergias.length) partes.push(`alergias: ${perfil.alergias.join(', ')}`);
    if (perfil.evitarDuro.length) partes.push(`se evita: ${perfil.evitarDuro.join(', ')}`);
    if (perfil.limitar.length) partes.push(`a cuidar: ${perfil.limitar.join(', ')}`);
    return partes.join(' · ');
  }

  return {
    comensales, agregar, editar, eliminar,
    perfilCombinado, evaluarReceta, resumen,
    CONDICIONES, DIETAS, PROPIEDADES
  };
})();
