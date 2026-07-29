/**
 * Agente de Inventario (Sección 4)
 * -----------------------------------------------------------------------
 * "Mantiene el estado actualizado de la despensa: qué productos hay, en
 *  qué cantidad y con qué fecha de vencimiento. Es la fuente de verdad
 *  sobre la que operan los demás agentes."
 *
 * Entradas: productos normalizados (del Agente de Captura), consultas de
 * otros agentes.
 * Salidas: estado del inventario (productos, cantidades, fechas).
 */

const AgenteInventario = (() => {
  function getAll() {
    return DB.get('products', []);
  }

  function getById(id) {
    return getAll().find((p) => p.id === id) || null;
  }

  // Recibe un producto ya normalizado por el Agente de Captura y lo
  // incorpora a la fuente de verdad.
  function add(productoNormalizado) {
    const producto = {
      id: DB.uid(),
      name: productoNormalizado.name,
      category: productoNormalizado.category || 'otros',
      quantity: productoNormalizado.quantity || 1,
      expiryDate: productoNormalizado.expiryDate, // ISO string yyyy-mm-dd
      source: productoNormalizado.source || 'manual', // manual|chatbot|scan|photo
      location: productoNormalizado.location || 'Heladera', // Heladera|Freezer|Alacena
      addedDate: new Date().toISOString().slice(0, 10),
      status: 'activo', // activo|consumido|descartado
      perishable: productoNormalizado.perishable ?? true,
      value: productoNormalizado.value ?? 1
    };
    DB.push('products', producto);
    Orquestador.notifyEvent('producto_agregado', { producto, agente: 'Inventario' });
    return producto;
  }

  function updateStatus(id, status) {
    return DB.update('products', id, { status, resolvedDate: new Date().toISOString().slice(0, 10) });
  }

  // Corrección de una carga previa (dato mal escaneado, fecha mal leída por
  // OCR, cantidad equivocada). Mantener el inventario fiel a la realidad es
  // la condición para que el resto de los agentes decidan bien: el documento
  // señala la "carga incompleta o errónea del inventario" como el principal
  // freno del sistema (Sección 8).
  // `silencioso: true` actualiza sin reactivar el ciclo: lo usan operaciones
  // internas que tocan varios productos seguidos (ej. el Evaluador
  // descontando los ingredientes de una receta) y disparan UN ciclo al final,
  // en vez de uno por producto.
  function edit(id, cambios, { silencioso = false } = {}) {
    const permitidos = ['name', 'category', 'quantity', 'expiryDate', 'location', 'perishable', 'value'];
    const patch = {};
    permitidos.forEach((k) => {
      if (cambios[k] !== undefined && cambios[k] !== null && cambios[k] !== '') patch[k] = cambios[k];
    });
    if (patch.quantity !== undefined) patch.quantity = Number(patch.quantity) > 0 ? Number(patch.quantity) : 1;
    if (patch.expiryDate && isNaN(new Date(patch.expiryDate).getTime())) {
      throw new Error('Fecha de vencimiento inválida.');
    }
    const actualizado = DB.update('products', id, patch);
    if (!silencioso) {
      Orquestador.notifyEvent('producto_editado', { producto: actualizado, agente: 'Inventario' });
    }
    return actualizado;
  }

  // Elimina el registro por completo (carga por error). Se distingue de
  // "descartado": eliminar NO cuenta como desperdicio en las métricas,
  // porque el producto nunca existió realmente en la despensa.
  function remove(id) {
    DB.remove('products', id);
    Orquestador.notifyEvent('producto_eliminado', { id, agente: 'Inventario' });
  }

  function activos() {
    return getAll().filter((p) => p.status === 'activo');
  }

  return { getAll, getById, add, edit, updateStatus, remove, activos };
})();
