/**
 * Agente de Aprendizaje (Sección 4 y 6)
 * -----------------------------------------------------------------------
 * "A partir de lo registrado por el evaluador, actualiza las preferencias
 *  del usuario y refina la predicción del ritmo de consumo, ajustando
 *  tanto las futuras sugerencias de recetas como el momento de las alertas."
 *
 * Entradas: desenlaces históricos, patrones de consumo.
 * Salidas: ajustes a preferencias, umbrales y ritmo de consumo.
 */

const AgenteAprendizaje = (() => {
  /* 1) Ingredientes evitados -------------------------------------------
     Si el usuario descarta repetidamente recetas con cierto ingrediente,
     se penaliza a futuro.

     Dos correcciones respecto de la versión anterior, y las dos cambiaban
     el comportamiento de forma silenciosa:

     a) EL CONTADOR SE INFLABA SOLO. Antes se partía del valor ya guardado
        (`{ ...prefs.avoidedIngredients }`) y ADEMÁS se recorría todo el
        historial de nuevo. Como el orquestador llama a `actualizar()` en
        cada ciclo, el mismo descarte se sumaba una y otra vez: un único
        rechazo cruzaba el umbral de 3 a los tres ciclos y el ingrediente
        quedaba penalizado sin que el usuario lo hubiera rechazado nunca
        dos veces. El contador ahora se RECALCULA desde cero: el historial
        es la única fuente de verdad.

     b) EL DESCARTE CULPABA A TODOS LOS INGREDIENTES. Rechazar "arroz con
        leche" sumaba +1 a arroz, leche, azúcar y canela por igual. Pero
        rechazar un arroz con leche dice que no gusta ESE PLATO, no el
        arroz. Ahora se cuenta en cuántas recetas DISTINTAS descartadas
        aparece cada ingrediente: tres postres distintos rechazados no
        significan nada sobre el arroz, pero tres platos distintos CON
        arroz sí. Ese es el patrón que el agente debería aprender.
     -------------------------------------------------------------------- */
  function actualizarIngredientesEvitados() {
    const historial = DB.get('history', []);
    const prefs = DB.get('preferences', {});

    // Recetas distintas descartadas (si una se descartó dos veces, cuenta una).
    const recetasDescartadas = new Set(
      historial
        .filter((h) => h.outcome === 'descartado' && h.recipeId)
        .map((h) => h.recipeId)
    );

    const avoided = {};
    recetasDescartadas.forEach((id) => {
      const receta = RECIPES.find((r) => r.id === id);
      if (!receta) return;
      // Un ingrediente suma UNA vez por receta descartada, no una por aparición.
      new Set(receta.ingredients.map(normalizeName)).forEach((norm) => {
        avoided[norm] = (avoided[norm] || 0) + 1;
      });
    });

    DB.set('preferences', { ...prefs, avoidedIngredients: avoided });
    return avoided;
  }

  // 2) Ritmo de consumo por categoría: promedio de días entre el alta de
  //    un producto y su consumo, para ajustar los umbrales de alerta
  //    (Sección 6: "anticipar o postergar las alertas").
  function actualizarPatronesConsumo() {
    const productos = AgenteInventario.getAll();
    const consumidos = productos.filter((p) => p.status === 'consumido' && p.resolvedDate);
    const porCategoria = {};

    consumidos.forEach((p) => {
      const dias = Math.round((new Date(p.resolvedDate) - new Date(p.addedDate)) / 86400000);
      if (dias < 0) return;
      if (!porCategoria[p.category]) porCategoria[p.category] = [];
      porCategoria[p.category].push(dias);
    });

    const patrones = {};
    Object.entries(porCategoria).forEach(([cat, arr]) => {
      patrones[cat] = {
        promedioDias: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10,
        muestras: arr.length
      };
    });

    DB.set('consumptionPatterns', patrones);

    // Ajusta umbrales de alerta por categoría: si el hogar consume rápido
    // una categoría, conviene alertar con más anticipación (yellow más alto).
    //
    // IMPORTANTE — autonomía vs. control del usuario: el aprendizaje NUNCA
    // pisa un umbral que el usuario fijó explícitamente en Preferencias.
    // Los umbrales marcados con `lockedByUser` quedan bajo control humano;
    // el agente sólo ajusta los que nadie fijó a mano. Esto evita que el
    // sistema "desobedezca" en silencio una decisión del usuario.
    const prefs = DB.get('preferences', {});
    const thresholds = { ...(prefs.alertThresholds || { default: { yellow: 3, red: 1 } }) };
    const ajustados = [];
    Object.entries(patrones).forEach(([cat, info]) => {
      if (info.muestras < 2) return; // arranque en frío: no ajusta sin suficientes datos
      if (thresholds[cat] && thresholds[cat].lockedByUser) return; // respeta la decisión del usuario
      const yellow = info.promedioDias <= 2 ? 4 : info.promedioDias >= 6 ? 2 : 3;
      thresholds[cat] = { yellow, red: 1, learned: true };
      ajustados.push(cat);
    });
    DB.set('preferences', { ...prefs, alertThresholds: thresholds });

    return { patrones, ajustados };
  }

  /* 3) Estilo de cocina preferido ----------------------------------------
     Hasta acá el agente sólo aprendía de lo que el usuario RECHAZA. Podía
     decir "no le gusta el arroz", pero no tenía forma de saber qué SÍ le
     gusta: le faltaba la señal positiva. Sin ella, el Cocinero ordena por
     urgencia y nada más, y dos recetas igual de urgentes le dan lo mismo
     aunque el usuario haya cocinado italiana cinco veces seguidas.

     Se aprende sobre tres dimensiones declaradas en el recetario:
       · cocina  — italiana, criolla, española, asiática, mediterránea…
       · estilo  — express, casera, elaborada (proxy de cuánto se complica)
       · tipo    — principal, entrada, postre, desayuno, guarnición

     DOS FUENTES, y se combinan a propósito:
       · CONDUCTA: cocinar suma, descartar resta. Es la señal honesta,
         porque son actos y no declaraciones, pero necesita historial.
       · DECLARACIÓN: lo que el usuario elige en Preferencias. Resuelve el
         arranque en frío, cuando todavía no hay conducta que mirar.
     La conducta pesa más que la declaración: mucha gente declara que le
     gusta la comida elaborada y después cocina siempre en diez minutos.

     Igual que en los ingredientes evitados, se cuenta por RECETAS DISTINTAS:
     cocinar tres veces el mismo plato no es lo mismo que cocinar tres platos
     italianos distintos, y sólo lo segundo dice algo sobre el gusto.
     -------------------------------------------------------------------- */
  const DIMENSIONES = ['cocina', 'estilo', 'tipo'];
  const PESO_CONDUCTA = 1;
  const PESO_DECLARADO = 2;   // equivale a ~2 recetas cocinadas: orienta sin dominar

  function actualizarEstiloPreferido() {
    const historial = DB.get('history', []);
    const prefs = DB.get('preferences', {});

    // Última decisión por receta: si cocinaste algo que antes habías
    // descartado, vale lo último que hiciste, no la suma de las dos cosas.
    const ultimoPorReceta = new Map();
    historial
      .filter((h) => h.recipeId && (h.outcome === 'cocinado' || h.outcome === 'descartado'))
      .forEach((h) => ultimoPorReceta.set(h.recipeId, h.outcome));

    const perfil = {};
    DIMENSIONES.forEach((d) => { perfil[d] = {}; });

    ultimoPorReceta.forEach((outcome, id) => {
      const receta = RECIPES.find((r) => r.id === id);
      if (!receta) return;
      const signo = outcome === 'cocinado' ? 1 : -1;
      DIMENSIONES.forEach((d) => {
        const valor = receta[d];
        if (!valor) return;
        perfil[d][valor] = (perfil[d][valor] || 0) + signo * PESO_CONDUCTA;
      });
    });

    // Preferencias declaradas: { cocina: ['italiana'], estilo: ['elaborada'] }
    const declarado = prefs.estilosPreferidos || {};
    DIMENSIONES.forEach((d) => {
      (declarado[d] || []).forEach((valor) => {
        perfil[d][valor] = (perfil[d][valor] || 0) + PESO_DECLARADO;
      });
    });

    DB.set('stylePreferences', perfil);
    return perfil;
  }

  // Punto de entrada llamado por el Orquestador tras cada evaluación.
  function actualizar() {
    const avoided = actualizarIngredientesEvitados();
    const { patrones, ajustados } = actualizarPatronesConsumo();
    const estilo = actualizarEstiloPreferido();
    return { avoided, patrones, ajustados, estilo };
  }

  return {
    actualizar, actualizarIngredientesEvitados, actualizarPatronesConsumo,
    actualizarEstiloPreferido, DIMENSIONES
  };
})();
