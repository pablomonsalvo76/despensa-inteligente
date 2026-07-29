/**
 * Agente de Vencimientos / Monitor (Sección 4)
 * -----------------------------------------------------------------------
 * "Se ejecuta de forma permanente. Detecta los productos próximos a
 *  vencer, los ordena por urgencia según los días restantes y los
 *  umbrales configurados, y emite las alertas de vencimiento al usuario."
 *
 * Entradas: estado del inventario, fecha/hora, umbrales de alerta.
 * Salidas: alertas de vencimiento (al usuario) + lista priorizada de
 * productos en riesgo (al Agente Cocinero).
 */

const AgenteVencimientos = (() => {
  function daysRemaining(expiryDateStr) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const venc = new Date(expiryDateStr + 'T00:00:00');
    return Math.round((venc - hoy) / (1000 * 60 * 60 * 24));
  }

  // Umbrales por categoría, ajustados por el Agente de Aprendizaje
  // (Sección 6: "anticipar o postergar las alertas").
  function thresholdsFor(category) {
    const prefs = DB.get('preferences', {});
    const th = prefs.alertThresholds || {};
    return th[category] || th.default || { yellow: 3, red: 1 };
  }

  function semaphore(days, category) {
    const th = thresholdsFor(category);
    if (days <= 0) return 'vencido';
    if (days <= th.red) return 'rojo';
    if (days <= th.yellow) return 'amarillo';
    return 'verde';
  }

  // Análisis del ciclo: recorre el inventario activo y arma la lista de
  // riesgo ordenada por urgencia (Sección 7: criterios de priorización).
  function analyze() {
    const productos = AgenteInventario.activos();
    const enriquecidos = productos.map((p) => {
      const days = daysRemaining(p.expiryDate);
      return { ...p, daysRemaining: days, urgencia: semaphore(days, p.category) };
    });

    enriquecidos.sort((a, b) => {
      if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
      // Empate: prioriza perecederos y de mayor valor
      if (a.perishable !== b.perishable) return a.perishable ? -1 : 1;
      return (b.value || 0) - (a.value || 0);
    });

    return enriquecidos;
  }

  function enRiesgo(enriquecidos) {
    return enriquecidos.filter((p) => ['rojo', 'amarillo', 'vencido'].includes(p.urgencia));
  }

  return { daysRemaining, semaphore, analyze, enRiesgo, thresholdsFor };
})();
