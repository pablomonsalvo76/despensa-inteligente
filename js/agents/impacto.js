/**
 * Métricas de impacto (Sección 2 del documento — KPIs)
 * -----------------------------------------------------------------------
 * Es el "diario de consumo y desperdicio" que el documento menciona como
 * diferenciador de la propuesta: habilita las métricas de impacto y
 * retroalimenta el aprendizaje.
 *
 * KPIs definidos en la Sección 2:
 *  - Alimentos no desperdiciados (productos rescatados).
 *  - Porcentaje de recomendaciones de recetas efectivamente seguidas.
 *  - Reducción del número de productos que vencen sin consumirse.
 *  - Proporción de alertas atendidas a tiempo respecto del total emitido.
 *
 * No es un agente que decida: es una capa de lectura sobre la memoria
 * persistente que traduce el historial en el propósito de la app —
 * reducir el desperdicio de alimentos en el hogar.
 */

const MetricasImpacto = (() => {
  // Valor de referencia para estimar el ahorro. Es una aproximación
  // deliberadamente conservadora y transparente: la app no conoce el precio
  // real de cada producto, así que se muestra como estimación, no como dato.
  const VALOR_ESTIMADO_POR_PRODUCTO = 1500; // ARS

  function calcular() {
    const productos = AgenteInventario.getAll();
    const historial = DB.get('history', []);

    const rescatados = productos.filter((p) => p.status === 'consumido').length;
    const desperdiciados = productos.filter((p) => p.status === 'descartado').length;
    const resueltos = rescatados + desperdiciados;

    // Tasa de aprovechamiento: de todo lo que salió de la despensa,
    // cuánto terminó consumido en lugar de tirado.
    const tasaAprovechamiento = resueltos === 0 ? null : Math.round((rescatados / resueltos) * 100);

    // Recomendaciones de recetas seguidas vs. ignoradas/rechazadas.
    const recomendaciones = historial.filter((h) => h.recipeId);
    const seguidas = recomendaciones.filter((h) => h.outcome === 'cocinado').length;
    const tasaRecetas = recomendaciones.length === 0
      ? null
      : Math.round((seguidas / recomendaciones.length) * 100);

    // Alertas atendidas a tiempo: productos que estuvieron en riesgo y
    // terminaron consumidos (la alerta cumplió su función).
    const alertasAtendidas = rescatados;
    const tasaAlertas = resueltos === 0 ? null : Math.round((alertasAtendidas / resueltos) * 100);

    return {
      rescatados,
      desperdiciados,
      resueltos,
      tasaAprovechamiento,
      tasaRecetas,
      recomendacionesTotales: recomendaciones.length,
      recomendacionesSeguidas: seguidas,
      tasaAlertas,
      ahorroEstimado: rescatados * VALOR_ESTIMADO_POR_PRODUCTO,
      valorReferencia: VALOR_ESTIMADO_POR_PRODUCTO
    };
  }

  // Mensaje honesto según los datos disponibles: sin historial suficiente
  // no se inventan conclusiones (coherente con el "arranque en frío").
  function resumen(m) {
    if (m.resueltos === 0) {
      return 'Todavía no hay datos suficientes. A medida que marques productos como cocinados o descartados, vas a ver acá cuánto desperdicio estás evitando.';
    }
    if (m.tasaAprovechamiento >= 80) {
      return `Muy buen aprovechamiento: ${m.tasaAprovechamiento}% de lo que salió de tu despensa se consumió en lugar de tirarse.`;
    }
    if (m.tasaAprovechamiento >= 50) {
      return `Vas bien: ${m.tasaAprovechamiento}% de aprovechamiento. Atender las alertas en rojo es lo que más mueve este número.`;
    }
    return `Hay margen de mejora: ${m.tasaAprovechamiento}% de aprovechamiento. Probá cocinar las recetas sugeridas cuando algo entra en rojo.`;
  }

  return { calcular, resumen, VALOR_ESTIMADO_POR_PRODUCTO };
})();
