/**
 * Agente Evaluador (Sección 4)
 * -----------------------------------------------------------------------
 * "Registra el desenlace de cada recomendación: si la receta se cocinó,
 *  si se ignoró, o si el producto igualmente se venció y se descartó.
 *  Es el que cierra el ciclo aportando retroalimentación."
 *
 * Entradas: acción del usuario (cocinado/descartado), estado del producto.
 * Salidas: desenlace registrado en la memoria (para el Agente de Aprendizaje)
 * y actualización del inventario cuando corresponde.
 */

const AgenteEvaluador = (() => {
  /**
   * Cierra el lazo Cocinero → Evaluador → Inventario: cuando una receta se
   * cocina, sus ingredientes DEJAN de estar en la despensa. Sin este paso el
   * inventario miente (el freno №1 del sistema, Sección 8) y las métricas de
   * impacto no registran los productos realmente rescatados.
   *
   * Regla: por cada ingrediente de la receta que exista como producto activo
   * y apto (no vencido), se descuenta 1 de la cantidad; si llega a 0, el
   * producto pasa a "consumido". Es una heurística deliberadamente simple:
   * la app no conoce gramajes reales del envase, y descontar de a una unidad
   * es el comportamiento menos sorprendente para el usuario.
   */
  function descontarIngredientesDeReceta(recipeId) {
    const receta = RECIPES.find((r) => r.id === recipeId);
    if (!receta) return { consumidos: [], descontados: [] };

    const activos = AgenteInventario.activos()
      .filter((p) => AgenteVencimientos.daysRemaining(p.expiryDate) > 0);

    const consumidos = [];   // pasaron a estado consumido (cantidad llegó a 0)
    const descontados = [];  // se les restó 1 pero les queda stock

    receta.ingredients.forEach((ing) => {
      const norm = normalizeName(ing);
      // Si hay más de un producto con el mismo nombre, consume el más urgente
      const candidatos = activos
        .filter((p) => normalizeName(p.name) === norm)
        .sort((a, b) => AgenteVencimientos.daysRemaining(a.expiryDate) - AgenteVencimientos.daysRemaining(b.expiryDate));
      const producto = candidatos[0];
      if (!producto) return;

      if (producto.quantity > 1) {
        // silencioso: el ciclo se dispara UNA vez al final del desenlace,
        // no una vez por ingrediente descontado.
        AgenteInventario.edit(producto.id, { quantity: producto.quantity - 1 }, { silencioso: true });
        descontados.push(producto.name);
      } else {
        AgenteInventario.updateStatus(producto.id, 'consumido');
        consumidos.push(producto.name);
      }
    });

    return { consumidos, descontados };
  }

  // outcome: 'cocinado' | 'descartado' | 'ignorado'
  function registrarDesenlace({ productId, recipeId = null, outcome, ingredientesUsados = [] }) {
    const registro = {
      id: DB.uid(),
      productId,
      recipeId,
      outcome,
      ingredientesUsados,
      timestamp: new Date().toISOString()
    };

    let descuento = null;

    // Si el desenlace es el descarte de una RECETA (no de un producto), el
    // Agente Cocinero deja de ofrecerla: descartar debe sacarla del listado,
    // no repetirla en el próximo ciclo.
    if (recipeId && !productId && outcome === 'descartado') {
      AgenteCocinero.descartarReceta(recipeId);
    }

    // Receta cocinada -> descuenta sus ingredientes del inventario.
    if (recipeId && !productId && outcome === 'cocinado') {
      descuento = descontarIngredientesDeReceta(recipeId);
      registro.ingredientesUsados = [...descuento.consumidos, ...descuento.descontados];
      Orquestador.log('Evaluación',
        `Receta cocinada: ${descuento.consumidos.length + descuento.descontados.length} ingrediente(s) descontado(s) del inventario` +
        (descuento.consumidos.length ? ` (agotados: ${descuento.consumidos.join(', ')})` : '') + '.');
    }

    DB.push('history', registro);

    // Desenlace sobre un producto puntual
    if (productId) {
      const nuevoEstado = outcome === 'cocinado' ? 'consumido' : outcome === 'descartado' ? 'descartado' : 'activo';
      if (nuevoEstado !== 'activo') AgenteInventario.updateStatus(productId, nuevoEstado);
    }

    Orquestador.notifyEvent('desenlace_registrado', { registro, agente: 'Evaluador' });
    return { ...registro, descuento };
  }

  /**
   * Consumo parcial de un producto (fuera de una receta): "usé 1 de mis 6
   * huevos". Registra la muestra para el Aprendizaje sólo cuando el producto
   * se agota, porque el ritmo de consumo se mide de alta a fin de vida.
   */
  function consumirUnidades(productId, unidades = 1) {
    const p = AgenteInventario.getById(productId);
    if (!p || p.status !== 'activo') return null;
    const n = Math.max(1, Math.min(Number(unidades) || 1, p.quantity));

    if (n >= p.quantity) {
      return registrarDesenlace({ productId, outcome: 'cocinado' });
    }
    AgenteInventario.edit(productId, { quantity: p.quantity - n });
    Orquestador.log('Evaluación', `Consumo parcial: ${n} de ${p.quantity} ${p.name}. Quedan ${p.quantity - n}.`);
    return { parcial: true, restante: p.quantity - n };
  }

  function historial() {
    return DB.get('history', []);
  }

  return { registrarDesenlace, consumirUnidades, historial };
})();
