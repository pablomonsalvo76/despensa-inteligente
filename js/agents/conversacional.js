/**
 * Agente Conversacional / Chatbot (Sección 4)
 * -----------------------------------------------------------------------
 * "Interpreta instrucciones y consultas del usuario en lenguaje natural,
 *  extrae las entidades relevantes (producto, fecha, cantidad) y, ante
 *  ambigüedad, solicita confirmación antes de cargar. Actúa como canal de
 *  entrada (envía el producto interpretado al agente de captura) y
 *  también de salida, respondiendo consultas."
 *
 * Sin API de LLM disponible en esta entrega (por decisión del usuario):
 * se implementa con un parser basado en reglas/regex. Queda documentado
 * como punto de extensión para la entrega final (Sección "Alcance").
 */

const AgenteConversacional = (() => {
  const MESES = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

  function extraerFecha(texto) {
    // dd/mm/yyyy o dd-mm-yyyy (año de 4 dígitos: sin ambigüedad de lectura)
    let m = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
      const [, d, mo, y] = m;
      const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      if (!isNaN(new Date(iso).getTime())) return { fecha: iso, ambigua: false };
    }
    // "20 de agosto" / "20 de agosto de 2026"
    m = texto.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?/i);
    if (m) {
      const [, d, mesTxt, y] = m;
      const mes = MESES[mesTxt.toLowerCase()];
      if (mes) {
        const anio = y || String(new Date().getFullYear());
        const iso = `${anio}-${mes}-${d.padStart(2, '0')}`;
        if (!isNaN(new Date(iso).getTime())) return { fecha: iso, ambigua: false };
      }
    }
    // Formato con año de 2 dígitos (ej. "20/08/01"): admite varias lecturas
    // (Sección 3 y 9: ante ambigüedad, el sistema pide confirmación).
    m = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/);
    if (m) return { fecha: null, ambigua: true, crudo: m[0] };
    return { fecha: null, ambigua: false };
  }

  function extraerCantidad(texto) {
    // Requiere una unidad explícita para no confundir números de la fecha
    // con la cantidad (ej. "vence el 30/07/2026" no implica cantidad = 30).
    const m = texto.match(/(\d+)\s?(unidades?|u\.|kg|gramos?|litros?|paquetes?)\b/i);
    return m ? Number(m[1]) : 1;
  }

  const CATEGORIAS = {
    leche: 'lacteos', yogur: 'lacteos', queso: 'lacteos', manteca: 'lacteos',
    tomate: 'verduras', lechuga: 'verduras', zanahoria: 'verduras', papa: 'verduras', cebolla: 'verduras', zapallito: 'verduras', zapallo: 'verduras',
    banana: 'frutas', manzana: 'frutas', naranja: 'frutas', uva: 'frutas',
    pollo: 'carnes', carne: 'carnes', jamon: 'carnes',
    arroz: 'cereales', fideos: 'cereales', harina: 'cereales', avena: 'cereales', pan: 'cereales',
    huevo: 'huevos', huevos: 'huevos'
  };

  function extraerProducto(texto) {
    const palabras = texto.toLowerCase().split(/\s+/);
    for (const palabraCruda of palabras) {
      const palabra = palabraCruda.replace(/[.,;:!?]/g, '');
      const norm = normalizeName(palabra);
      if (CATEGORIAS[norm]) return { name: palabra, category: CATEGORIAS[norm] };
    }
    // fallback: usa la palabra después de "ingresé"/"agregar"/"cargar"
    const m = texto.match(/(?:ingres[ée]|agregar|agrega|cargar|carga|anota|anotar)\s+([a-záéíóúñ]+)/i);
    if (m) return { name: m[1], category: 'otros' };
    return null;
  }

  // Detecta si el mensaje es una consulta (salida) o una instrucción de carga (entrada)
  function esConsulta(texto) {
    return /\?|qu[ée] (se|puedo|hay|tengo)|vence|vencen|cocinar|receta|ahorr|impacto|despensa|inventario|compr|hogar|comensal|qui[eé]n(es)? com|famili/i.test(texto) &&
      !/ingres[ée]|agregar|anot/i.test(texto);
  }

  // ---- Memoria de contexto conversacional ----
  // Cuando el agente pide una aclaración ("¿cuándo vence?"), guarda qué
  // estaba intentando cargar. Así el usuario puede responder sólo con el
  // dato faltante ("20/08/2026") en vez de reescribir la frase entera.
  // Reduce la fricción de carga, que el documento identifica como el
  // principal freno del sistema (Sección 8).
  let contextoPendiente = null; // { producto, cantidad }

  function limpiarContexto() { contextoPendiente = null; }

  // Punto de entrada: interpreta un mensaje del chatbot.
  // Devuelve { tipo: 'carga'|'consulta'|'ambiguo'|'no_entendido', ... }
  function interpretar(texto) {
    // 1) Si hay una aclaración pendiente, intenta resolverla con este mensaje.
    if (contextoPendiente) {
      // El usuario puede abandonar la carga pendiente
      if (/^(no|cancelar|nada|olvidalo|dejalo)\b/i.test(texto.trim())) {
        const nombre = contextoPendiente.producto.name;
        limpiarContexto();
        return { tipo: 'cancelado', mensaje: `Listo, cancelé la carga de "${nombre}".` };
      }

      const { fecha, ambigua, crudo } = extraerFecha(texto);
      if (fecha) {
        const pendiente = contextoPendiente;
        limpiarContexto();
        return {
          tipo: 'carga',
          producto: {
            name: pendiente.producto.name,
            category: pendiente.producto.category,
            quantity: pendiente.cantidad,
            expiryDate: fecha,
            source: 'chatbot'
          }
        };
      }
      if (ambigua) {
        return { tipo: 'ambiguo', mensaje: `La fecha "${crudo}" es ambigua (¿día/mes o mes/día?). Escribila como dd/mm/aaaa, por favor.` };
      }
      // No vino una fecha: quizá el usuario cambió de tema (una consulta)
      if (esConsulta(texto)) {
        limpiarContexto();
        return { tipo: 'consulta', respuesta: responderConsulta(texto) };
      }
      return {
        tipo: 'ambiguo',
        mensaje: `Sigo esperando la fecha de vencimiento de "${contextoPendiente.producto.name}" (dd/mm/aaaa). Si querés cancelar, escribí "cancelar".`
      };
    }

    // 2) Acciones sobre el ciclo: el Conversacional no es sólo un canal de
    //    carga; también registra desenlaces (Evaluación) desde el chat.
    const accion = interpretarAccion(texto);
    if (accion) return accion;

    // 3) Flujo normal
    if (esConsulta(texto)) {
      return { tipo: 'consulta', respuesta: responderConsulta(texto) };
    }

    const producto = extraerProducto(texto);
    const { fecha, ambigua, crudo } = extraerFecha(texto);
    const cantidad = extraerCantidad(texto);

    if (!producto) {
      return { tipo: 'no_entendido', mensaje: 'No pude identificar el producto. ¿Podés decirme qué producto es y cuándo vence? Ej: "ingresé leche, vence el 20/08/2026".' };
    }
    if (ambigua) {
      contextoPendiente = { producto, cantidad };
      return { tipo: 'ambiguo', mensaje: `La fecha "${crudo}" es ambigua (¿día/mes o mes/día?). Escribila como dd/mm/aaaa y la cargo.`, producto };
    }
    if (!fecha) {
      contextoPendiente = { producto, cantidad };
      return { tipo: 'ambiguo', mensaje: `Anoté "${producto.name}". ¿Cuándo vence? Respondeme sólo con la fecha (dd/mm/aaaa).`, producto };
    }

    return {
      tipo: 'carga',
      producto: { name: producto.name, category: producto.category, quantity: cantidad, expiryDate: fecha, source: 'chatbot' }
    };
  }

  // ---- Acciones de Evaluación desde el chat ----
  // "consumí la leche" / "terminé los huevos" -> desenlace cocinado
  // "tiré el yogur" / "descarté la lechuga"   -> desenlace descartado
  function interpretarAccion(texto) {
    const consumo = texto.match(/^\s*(?:consum[ií]|us[eé]|termin[eé]|me (?:com[ií]|tom[eé]))\s+(?:(\d+)\s+)?(?:el|la|los|las|un|una|unos|unas)?\s*([a-záéíóúñ\s]+?)\s*$/i);
    const descarte = texto.match(/^\s*(?:tir[eé]|descart[eé]|bot[eé]|se me (?:pudri[oó]|venci[oó]))\s+(?:el|la|los|las|un|una)?\s*([a-záéíóúñ\s]+?)\s*$/i);

    if (!consumo && !descarte) return null;

    // Grupos del regex de consumo: [1] = cantidad opcional, [2] = nombre
    const nombreCrudo = (consumo ? consumo[2] : descarte[1]).trim();
    const cantidad = consumo && consumo[1] ? Number(consumo[1]) : null;
    /* Busca el producto por INGREDIENTE, con el mismo resolvedor que usan el
       Cocinero, el Generador y el Evaluador. Antes hacía `includes()` en las
       dos direcciones, y eso acá es peligroso de verdad: este camino MODIFICA
       el inventario. Casos medidos que resolvía mal:

         "usé la sal"    -> marcaba consumida la Salchicha
         "tiré la leche" -> marcaba descartado el Dulce de leche
         "usé el te"     -> marcaba consumido el Tomate
         "cociné carne"  -> no encontraba la Milanesa

       `buscarEnDespensa` empareja por palabras completas y sólo como
       prefijo, así que "sal" no puede resolver a "salchicha", pero
       "mayonesa" sí resuelve a "Mayonesa Hellmann's Clásica" — que es lo
       que el usuario espera cuando nombra un producto suyo. */
    const activos = AgenteInventario.activos().map((p) => ({
      ...p, daysRemaining: AgenteVencimientos.daysRemaining(p.expiryDate)
    }));
    const producto = typeof AgenteCocinero !== 'undefined'
      ? AgenteCocinero.buscarEnDespensa(nombreCrudo,
          AgenteCocinero.inventarioPorIngrediente(AgenteCocinero.inventarioDisponible(activos)))
      : activos.find((p) => normalizeName(p.name) === normalizeName(nombreCrudo));

    if (!producto) {
      return { tipo: 'accion', mensaje: `No encontré "${nombreCrudo}" entre tus productos activos. Fijate el nombre exacto en Mis productos.` };
    }

    if (descarte) {
      AgenteEvaluador.registrarDesenlace({ productId: producto.id, outcome: 'descartado' });
      return { tipo: 'accion', mensaje: `Anotado: "${producto.name}" descartado. Queda registrado en tus métricas de desperdicio.` };
    }

    // Consumo: con número consume esa cantidad; sin número, todo el producto.
    if (cantidad && cantidad < producto.quantity) {
      const res = AgenteEvaluador.consumirUnidades(producto.id, cantidad);
      return { tipo: 'accion', mensaje: `Anotado: consumiste ${cantidad} de "${producto.name}". Quedan ${res.restante}.` };
    }
    AgenteEvaluador.registrarDesenlace({ productId: producto.id, outcome: 'cocinado' });
    return { tipo: 'accion', mensaje: `¡Rescatado! "${producto.name}" consumido por completo. Suma a tu impacto.` };
  }

  function responderConsulta(texto) {
    const enriquecidos = AgenteVencimientos.analyze();
    if (/vence|vencen/i.test(texto)) {
      const riesgo = AgenteVencimientos.enRiesgo(enriquecidos);
      if (riesgo.length === 0) return 'No tenés productos próximos a vencer esta semana. 🎉';
      return 'Próximos a vencer: ' + riesgo.map((p) => `${p.name} (${p.daysRemaining <= 0 ? 'vencido' : p.daysRemaining + ' días'})`).join(', ') + '.';
    }
    if (/cocinar|receta/i.test(texto)) {
      const sugerencias = AgenteCocinero.suggestRecipes(enriquecidos);
      if (sugerencias.length === 0) return 'No encontré recetas factibles con lo que tenés cargado ahora mismo.';
      return 'Podrías cocinar: ' + sugerencias.map((s) => s.receta.name).join(', ') + '.';
    }
    // "¿cuánto ahorré?" -> responde con las métricas de impacto (Sección 2)
    if (/ahorr|impacto|rescat/i.test(texto)) {
      const m = MetricasImpacto.calcular();
      if (m.resueltos === 0) return 'Todavía no hay datos: marcá productos como consumidos o descartados y te cuento tu impacto.';
      return `Rescataste ${m.rescatados} producto(s) y se desperdiciaron ${m.desperdiciados}. ` +
        `Aprovechamiento: ${m.tasaAprovechamiento}%. Ahorro estimado: $${m.ahorroEstimado.toLocaleString('es-AR')}.`;
    }
    // "¿quiénes comen?" -> resumen del hogar (perfil de comensales)
    if (/hogar|comensal|qui[eé]n(es)? com|famili/i.test(texto)) {
      return typeof AgenteHogar !== 'undefined'
        ? AgenteHogar.resumen()
        : 'Todavía no está configurado el perfil del hogar.';
    }
    // "¿qué compro?" -> sugerencias del Agente de Compras
    if (/compr|super|mercado|g[oó]ndola/i.test(texto)) {
      const comprar = AgenteCompras.queComprar(enriquecidos);
      if (comprar.length === 0) return 'No necesitás comprar nada urgente: con lo que tenés alcanza para rescatar lo que está por vencer.';
      return 'Te conviene comprar: ' + comprar.slice(0, 3).map((s) => s.ingrediente).join(', ') +
        `. ${comprar[0].motivo}`;
    }
    // "¿qué tengo?" -> resumen del inventario por categoría
    if (/qu[ée] (hay|tengo)|despensa|inventario/i.test(texto)) {
      if (enriquecidos.length === 0) return 'Tu despensa está vacía. Cargá productos con el botón + o decime "ingresé leche, vence el 20/08/2026".';
      const porCat = {};
      enriquecidos.forEach((p) => { porCat[p.category] = (porCat[p.category] || 0) + p.quantity; });
      const resumen = Object.entries(porCat).map(([c, n]) => `${n} de ${c}`).join(', ');
      return `Tenés ${enriquecidos.length} producto(s): ${resumen}. Los más urgentes: ` +
        enriquecidos.slice(0, 3).map((p) => `${p.name} (${p.daysRemaining <= 0 ? 'vencido' : p.daysRemaining + ' días'})`).join(', ') + '.';
    }
    return 'Puedo cargar productos ("ingresé leche, vence el 20/08/2026"), registrar consumos ("consumí la leche", "tiré el yogur") y responder "¿qué se vence?", "¿qué puedo cocinar?", "¿qué tengo?", "¿qué compro?", "¿quiénes comen?" o "¿cuánto ahorré?".';
  }

  return { interpretar, extraerFecha, extraerCantidad, extraerProducto, limpiarContexto };
})();
