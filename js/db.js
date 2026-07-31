/**
 * db.js — Capa de memoria persistente (Sección 6 del documento de diseño)
 * -----------------------------------------------------------------------
 * Implementa la "memoria persistente" del sistema usando localStorage
 * (en una versión con backend real, esto sería una base de datos como
 * SQLite/Postgres). Se organiza en "stores" independientes, tal como
 * describe el documento:
 *   - products              -> Historial de productos (inventario vivo)
 *   - history               -> Decisiones anteriores y resultados obtenidos
 *   - preferences           -> Preferencias y restricciones del usuario
 *   - consumptionPatterns   -> Patrones de consumo por categoría
 *   - systemLog             -> Bitácora del ciclo de orquestación (transparencia)
 */

const DB = (() => {
  const NS = 'despensa_inteligente_v1';

  // Stores que componen la memoria persistente (Sección 6).
  const STORES = ['products', 'history', 'preferences', 'consumptionPatterns', 'gtinCache',
    'dismissedRecipes', 'profile', 'household', 'shoppingState', 'notificationState', 'systemLog',
    'stylePreferences', 'generadorConfig'];

  function _key(store) {
    return `${NS}::${store}`;
  }

  function _read(store, fallback) {
    try {
      const raw = localStorage.getItem(_key(store));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('DB read error', store, e);
      return fallback;
    }
  }

  function _write(store, value) {
    localStorage.setItem(_key(store), JSON.stringify(value));
  }

  function uid() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // ---- Inicialización de datos por defecto (arranque en frío, Sección 6) ----
  function init() {
    if (_read('products', null) === null) _write('products', []);
    if (_read('history', null) === null) _write('history', []); // desenlaces: cocinado/descartado/ignorado
    if (_read('systemLog', null) === null) _write('systemLog', []);
    if (_read('consumptionPatterns', null) === null) _write('consumptionPatterns', {});
    if (_read('gtinCache', null) === null) _write('gtinCache', {}); // productos escaneados, para uso offline
    if (_read('dismissedRecipes', null) === null) _write('dismissedRecipes', []); // recetas que el usuario descartó
    if (_read('profile', null) === null) _write('profile', {}); // nombre/correo, sólo local
    if (_read('notificationState', null) === null) _write('notificationState', {}); // control de 1 alerta por día
    if (_read('household', null) === null) _write('household', []); // comensales del hogar
    if (_read('shoppingState', null) === null) _write('shoppingState', { comprados: [], ignorados: [] });
    if (_read('preferences', null) === null) {
      _write('preferences', {
        allergies: [],          // filtros duros (ej: "mani", "gluten")
        dietary: [],            // "vegetariano", "sin_tacc", "vegano"
        avoidedIngredients: {}, // aprendidos: { ingrediente: contadorRechazos }
        alertThresholds: {      // umbrales configurables (Sección 7), por categoría
          default: { yellow: 3, red: 1 } // días
        },
        maxSuggestions: 3,
        ocrMinConfidence: 0.6
      });
    }
  }

  return {
    uid,
    init,
    get: (store, fallback = []) => _read(store, fallback),
    set: (store, value) => _write(store, value),
    push: (store, item) => {
      const arr = _read(store, []);
      arr.push(item);
      _write(store, arr);
      return item;
    },
    update: (store, id, patch) => {
      const arr = _read(store, []);
      const idx = arr.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      arr[idx] = { ...arr[idx], ...patch };
      _write(store, arr);
      return arr[idx];
    },
    remove: (store, id) => {
      const arr = _read(store, []);
      _write(store, arr.filter((x) => x.id !== id));
    },
    // Borra explícitamente cada store conocido (no depende de poder
    // enumerar localStorage, que varía según el entorno).
    clearAll: () => {
      STORES.forEach((store) => localStorage.removeItem(_key(store)));
      init();
    },

    // ---- Portabilidad de la memoria persistente ----
    // La memoria es lo que convierte un alertador genérico en un asistente
    // que aprende (Sección 6). Si vive sólo en localStorage, se pierde al
    // borrar los datos del navegador o cambiar de dispositivo: exportarla
    // protege el aprendizaje acumulado.
    exportAll: () => JSON.stringify({
      _app: 'despensa-inteligente',
      _version: 1,
      _exportedAt: new Date().toISOString(),
      products: _read('products', []),
      history: _read('history', []),
      preferences: _read('preferences', {}),
      consumptionPatterns: _read('consumptionPatterns', {}),
      gtinCache: _read('gtinCache', {}),
      dismissedRecipes: _read('dismissedRecipes', []),
      profile: _read('profile', {}),
      household: _read('household', []),
      shoppingState: _read('shoppingState', {}),
      notificationState: _read('notificationState', {}),
      systemLog: _read('systemLog', []),
      stylePreferences: _read('stylePreferences', null),
      generadorConfig: _read('generadorConfig', {})
    }, null, 2),

    importAll: (json) => {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || data._app !== 'despensa-inteligente') {
        throw new Error('El archivo no parece una copia de seguridad de Despensa Inteligente.');
      }
      if (!Array.isArray(data.products)) {
        throw new Error('La copia de seguridad está incompleta o dañada.');
      }
      _write('products', data.products);
      _write('history', Array.isArray(data.history) ? data.history : []);
      _write('preferences', data.preferences && typeof data.preferences === 'object' ? data.preferences : {});
      _write('consumptionPatterns', data.consumptionPatterns && typeof data.consumptionPatterns === 'object' ? data.consumptionPatterns : {});
      _write('gtinCache', data.gtinCache && typeof data.gtinCache === 'object' ? data.gtinCache : {});
      _write('dismissedRecipes', Array.isArray(data.dismissedRecipes) ? data.dismissedRecipes : []);
      _write('profile', data.profile && typeof data.profile === 'object' ? data.profile : {});
      _write('household', Array.isArray(data.household) ? data.household : []);
      _write('shoppingState', data.shoppingState && typeof data.shoppingState === 'object' ? data.shoppingState : { comprados: [], ignorados: [] });
      _write('notificationState', data.notificationState && typeof data.notificationState === 'object' ? data.notificationState : {});
      _write('systemLog', Array.isArray(data.systemLog) ? data.systemLog : []);
      if (data.stylePreferences && typeof data.stylePreferences === 'object') _write('stylePreferences', data.stylePreferences);
      _write('generadorConfig', data.generadorConfig && typeof data.generadorConfig === 'object' ? data.generadorConfig : {});
      init(); // completa cualquier store faltante con sus valores por defecto
      return { productos: data.products.length, desenlaces: (data.history || []).length };
    }
  };
})();
