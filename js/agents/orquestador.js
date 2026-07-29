/**
 * Orquestador (Sección 4 y 5)
 * -----------------------------------------------------------------------
 * "Coordina la interacción entre los agentes y la secuencia del ciclo."
 *
 * Implementa el ciclo de la Sección 5:
 *   Observación -> Análisis -> Planificación -> Acción -> Evaluación -> Aprendizaje -> (nueva Observación)
 *
 * En la entrega final del proyecto (según el documento) esto se resolvería
 * con un motor de orquestación de flujos (ej. n8n). Acá se implementa la
 * misma lógica de ciclo de forma explícita en JS, con un log de
 * transparencia para poder observar la ejecución (pestaña "Sistema").
 */

const Orquestador = (() => {
  const listeners = []; // callbacks de UI que se refrescan tras cada ciclo

  function log(paso, detalle) {
    const entrada = { id: DB.uid(), paso, detalle, timestamp: new Date().toISOString() };
    const bitacora = DB.get('systemLog', []);
    bitacora.push(entrada);
    // conserva sólo las últimas 200 entradas
    DB.set('systemLog', bitacora.slice(-200));
    return entrada;
  }

  function onCycleComplete(cb) {
    listeners.push(cb);
  }

  /* ------------------------------------------------------------------------
     Emisión de notificaciones — una vez por día
     ------------------------------------------------------------------------
     El ciclo se ejecuta seguido (cada minuto y ante cada evento) porque debe
     mantener el análisis actualizado. Pero notificar en cada ciclo satura al
     usuario, y una alerta que satura se ignora: el documento marca la "baja
     participación del usuario" como uno de los frenos del sistema (Sección 8).
     Por eso se separa ANALIZAR de INTERRUMPIR: como máximo una notificación
     diaria, y sólo si el usuario las tiene activadas.
     ------------------------------------------------------------------------ */
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function emitirNotificacionDiaria(riesgo) {
    const prefs = DB.get('preferences', {});

    // 1) Respeta el interruptor de Configuración
    if (prefs.notificaciones === false) return;

    // 2) Requiere permiso del navegador
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    // 3) Sólo interrumpe por lo urgente (rojo o vencido)
    const criticos = riesgo.filter((p) => p.urgencia === 'rojo' || p.urgencia === 'vencido');
    if (criticos.length === 0) return;

    // 4) Como máximo una por día
    const estado = DB.get('notificationState', {});
    const hoy = hoyISO();
    if (estado.ultimaFecha === hoy) return;

    const nombres = criticos.slice(0, 3).map((p) => p.name).join(', ');
    const resto = criticos.length > 3 ? ` y ${criticos.length - 3} más` : '';

    try {
      new Notification('Despensa Inteligente', {
        body: `${criticos.length} producto(s) necesitan atención hoy: ${nombres}${resto}.`,
        tag: 'despensa-vencimientos', // reemplaza la anterior en vez de apilarse
        icon: 'icons/icon-192.png'
      });
      DB.set('notificationState', { ultimaFecha: hoy, cantidad: criticos.length });
      log('Acción', `Notificación diaria enviada (${criticos.length} producto(s) críticos). La próxima recién mañana.`);
    } catch (e) {
      console.warn('No se pudo emitir la notificación', e);
    }
  }

  // Permite probar la alerta desde Configuración sin esperar al día siguiente.
  function forzarNotificacionDePrueba() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return { ok: false, motivo: 'sin_permiso' };
    }
    const riesgo = AgenteVencimientos.enRiesgo(AgenteVencimientos.analyze());
    const criticos = riesgo.filter((p) => p.urgencia === 'rojo' || p.urgencia === 'vencido');
    new Notification('Despensa Inteligente', {
      body: criticos.length > 0
        ? `Así se ven tus alertas: ${criticos.length} producto(s) necesitan atención.`
        : 'Así se ven tus alertas. Ahora mismo no hay productos críticos.',
      tag: 'despensa-prueba',
      icon: 'icons/icon-192.png'
    });
    return { ok: true, criticos: criticos.length };
  }

  // Ciclo completo: Observación -> Análisis -> Planificación -> Acción
  // (Evaluación y Aprendizaje se disparan aparte, cuando el usuario actúa)
  function runCycle(motivo = 'periódico') {
    log('Observación', `Disparado por: ${motivo}. Leyendo estado del inventario.`);
    const enriquecidos = AgenteVencimientos.analyze();

    log('Análisis', `${enriquecidos.length} productos activos analizados.`);
    const riesgo = AgenteVencimientos.enRiesgo(enriquecidos);
    log('Análisis', `${riesgo.length} productos en riesgo (amarillo/rojo/vencido).`);

    let recetas = [];
    if (riesgo.length > 0) {
      log('Planificación', 'Consultando al Agente Cocinero por recetas que aprovechen los productos en riesgo.');
      recetas = AgenteCocinero.suggestRecipes(enriquecidos);
      log('Planificación', `${recetas.length} recetas sugeridas.`);
    }

    log('Acción', riesgo.length > 0
      ? `${riesgo.length} producto(s) en riesgo visibles en Alertas, con recetas asociadas cuando corresponde.`
      : 'Sin alertas que emitir en este ciclo.');

    // La notificación push se emite como máximo UNA VEZ POR DÍA (ver más abajo).
    // El ciclo, en cambio, sigue corriendo seguido para mantener la pantalla
    // al día: una cosa es *analizar* y otra distinta es *interrumpir* al usuario.
    emitirNotificacionDiaria(riesgo);

    const resultado = { enriquecidos, riesgo, recetas };
    listeners.forEach((cb) => cb(resultado));
    return resultado;
  }

  // Disparado tras registrar un desenlace (Evaluación) -> corre Aprendizaje
  // y luego reinicia el ciclo (nueva Observación), tal como describe la Sección 5.
  function afterEvaluation() {
    log('Evaluación', 'Desenlace registrado por el usuario.');
    log('Aprendizaje', 'Actualizando preferencias y patrones de consumo.');
    const ajustes = AgenteAprendizaje.actualizar();
    log('Aprendizaje', `Categorías con patrón de consumo: ${Object.keys(ajustes.patrones).join(', ') || 'ninguna aún'}.`);
    log('Aprendizaje', ajustes.ajustados.length > 0
      ? `Umbrales ajustados automáticamente en: ${ajustes.ajustados.join(', ')}. (No se tocan los que fijaste a mano.)`
      : 'Sin ajustes automáticos de umbrales en este ciclo.');
    return runCycle('post-evaluación');
  }

  // Mensajería entre agentes: cada agente emite eventos hacia el Orquestador,
  // que decide cómo reaccionar. El mensaje queda registrado en el log para
  // que la colaboración del sistema multiagente sea auditable (es el corazón
  // del diseño del TP: agentes con responsabilidades acotadas que colaboran,
  // no un módulo monolítico).
  function notifyEvent(tipo, payload = {}) {
    const emisor = payload.agente || 'Sistema';
    log('Comunicación', `${emisor} → Orquestador: ${tipo}${payload.producto ? ` (${payload.producto.name})` : ''}.`);

    if (tipo === 'producto_agregado') {
      runCycle('nuevo producto');
    }
    if (tipo === 'producto_editado') {
      runCycle('producto editado');
    }
    if (tipo === 'producto_eliminado') {
      runCycle('producto eliminado');
    }
    // El perfil del hogar cambió (alta/edición de comensal): las recetas
    // deben recalcularse porque cambian los filtros duros y los gustos.
    if (tipo === 'hogar_actualizado') {
      runCycle('perfil del hogar actualizado');
    }
    if (tipo === 'desenlace_registrado') {
      afterEvaluation();
    }
  }

  return {
    runCycle, afterEvaluation, notifyEvent, onCycleComplete, log,
    forzarNotificacionDePrueba, hoyISO
  };
})();
