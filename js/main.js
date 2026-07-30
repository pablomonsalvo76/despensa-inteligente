/**
 * main.js — Capa de interfaz (Sección 9: interfaces de entrada, procesamiento
 * y salida)
 * -----------------------------------------------------------------------
 * No contiene lógica de negocio: esa vive en los agentes. Este archivo sólo
 * enruta pantallas, renderiza el estado que producen los agentes y traduce
 * las interacciones del usuario en llamadas a ellos.
 */

/**
 * Reporte de errores visible.
 * Sin esto, un error de JavaScript deja la app muda: los botones simplemente
 * no responden y no hay forma de saber por qué sin abrir la consola.
 */
window.addEventListener('error', (e) => {
  const barra = document.createElement('div');
  barra.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#b3261e;color:#fff;' +
    'padding:10px 14px;font:12px/1.4 system-ui,sans-serif;white-space:pre-wrap';
  barra.textContent =
    `Error en la app: ${e.message}\n(${(e.filename || '').split('/').pop()}:${e.lineno})`;
  barra.addEventListener('click', () => barra.remove());
  (document.body || document.documentElement).appendChild(barra);
});

document.addEventListener('DOMContentLoaded', () => {
  DB.init();

  /* =========================================================================
     UTILIDADES
     ========================================================================= */
  // Búsqueda estricta: devuelve null si el elemento no existe.
  const find = (id) => document.getElementById(id);

  /**
   * Búsqueda tolerante a fallos.
   *
   * Si el id no existe devuelve un nodo suelto y descartable en lugar de null.
   * Motivo: un solo id faltante — por ejemplo si el navegador sirvió un
   * index.html viejo del caché junto a un main.js nuevo — hacía que
   * `$('algo').addEventListener(...)` lanzara un TypeError. Ese error cortaba
   * la ejecución del archivo y dejaba SIN CONECTAR todos los botones que
   * venían después, incluido "Guardar producto" y el "+". Un elemento
   * ausente ahora degrada esa función sola, no la app entera.
   */
  const idsFaltantes = new Set();
  function $(id) {
    const nodo = find(id);
    if (nodo) return nodo;
    if (!idsFaltantes.has(id)) {
      idsFaltantes.add(id);
      console.warn(`[Despensa] Falta el elemento #${id} en el HTML. Probá recargar con Ctrl+Shift+R.`);
    }
    return document.createElement('div');
  }

  // Conecta un listener sólo si el elemento existe de verdad.
  function on(id, evento, handler) {
    const nodo = find(id);
    if (!nodo) { console.warn(`[Despensa] Falta #${id}: se omite su listener.`); return null; }
    nodo.addEventListener(evento, handler);
    return nodo;
  }

  // Asigna una propiedad sólo si el elemento existe (misma lógica defensiva).
  function set(id, prop, valor) {
    const nodo = find(id);
    if (nodo) nodo[prop] = valor;
    return nodo;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function fechaLarga(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function textoDias(p) {
    if (p.daysRemaining < 0) return `Hace ${Math.abs(p.daysRemaining)} d`;
    if (p.daysRemaining === 0) return 'Hoy';
    return `${p.daysRemaining} días`;
  }

  const NOMBRE_CATEGORIA = {
    lacteos: 'Lácteos', verduras: 'Verduras', frutas: 'Frutas', carnes: 'Carnes',
    cereales: 'Granos', huevos: 'Huevos', conservas: 'Conservas',
    bebidas: 'Bebidas', otros: 'Otros'
  };

  /* =========================================================================
     TEMA (claro / oscuro / sistema)
     ========================================================================= */
  const THEME_KEY = 'despensa_inteligente_v1::theme';

  function temaEfectivo(pref) {
    if (pref === 'dark') return 'dark';
    if (pref === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function aplicarTema(pref) {
    const efectivo = temaEfectivo(pref);
    document.documentElement.setAttribute('data-theme', efectivo);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', efectivo === 'dark' ? '#0e1310' : '#f4f8f3');
    document.querySelectorAll('#cfg-theme .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.theme === pref));
  }

  let prefTema = localStorage.getItem(THEME_KEY) || 'sistema';
  aplicarTema(prefTema);

  document.querySelectorAll('#cfg-theme .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefTema = btn.dataset.theme;
      localStorage.setItem(THEME_KEY, prefTema);
      aplicarTema(prefTema);
    });
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (prefTema === 'sistema') aplicarTema('sistema');
    });
  }

  /* =========================================================================
     ROUTER DE PANTALLAS
     ========================================================================= */
  // Cada pantalla declara su título, si muestra botón "volver", buscador, y a
  // qué ítem de la tabbar corresponde.
  const PANTALLAS = {
    'sc-inicio':        { titulo: 'Inicio', tab: 'sc-inicio' },
    'sc-productos':     { titulo: 'Mis productos', tab: 'sc-productos', back: true, buscar: true },
    'sc-agregar':       { titulo: 'Agregar producto', back: true },
    'sc-alertas':       { titulo: 'Alertas', back: true },
    'sc-recetas':       { titulo: 'Recetas para vos', tab: 'sc-recetas' },
    'sc-receta':        { titulo: 'Receta', back: true },
    'sc-calendario':    { titulo: 'Calendario', back: true },
    'sc-estadisticas':  { titulo: 'Estadísticas', back: true },
    'sc-perfil':        { titulo: 'Perfil', tab: 'sc-perfil' },
    'sc-mis-datos':     { titulo: 'Mi información', back: true },
    'sc-config':        { titulo: 'Configuración', back: true },
    'sc-preferencias':  { titulo: 'Preferencias', back: true },
    'sc-historial':     { titulo: 'Historial y aprendizaje', back: true },
    'sc-sistema':       { titulo: 'Sistema · agentes', back: true },
    'sc-hogar':         { titulo: 'Mi hogar', back: true },
    'sc-comensal':      { titulo: 'Comensal', back: true },
    'sc-compras':       { titulo: 'Lista de compras', back: true }
  };

  let pantallaActual = 'sc-inicio';
  const historial = [];

  function ir(id, { push = true } = {}) {
    const cfg = PANTALLAS[id];
    if (!cfg) return;
    if (push && id !== pantallaActual) historial.push(pantallaActual);

    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    pantallaActual = id;

    $('hdr-title').textContent = cfg.titulo;
    $('hdr-sub').textContent = '';
    $('hdr-back').hidden = !cfg.back;
    $('hdr-search').hidden = !cfg.buscar;

    document.querySelectorAll('.tb-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.nav === cfg.tab));

    $('view').scrollTop = 0;
    window.scrollTo(0, 0);

    // Render bajo demanda: cada pantalla se dibuja al entrar
    if (id === 'sc-inicio') renderDashboard();
    if (id === 'sc-productos') renderProductos();
    if (id === 'sc-alertas') renderAlertas();
    if (id === 'sc-recetas') renderRecetas();
    if (id === 'sc-calendario') renderCalendario();
    if (id === 'sc-estadisticas') renderEstadisticas();
    if (id === 'sc-perfil') renderPerfil();
    if (id === 'sc-mis-datos') cargarPerfilForm();
    if (id === 'sc-config') cargarConfigForm();
    if (id === 'sc-preferencias') renderPreferencias();
    if (id === 'sc-historial') renderHistorial();
    if (id === 'sc-sistema') renderSystemLog();
    if (id === 'sc-hogar') renderHogar();
    if (id === 'sc-compras') renderCompras();
  }

  $('hdr-back').addEventListener('click', () => {
    const previa = historial.pop();
    ir(previa || 'sc-inicio', { push: false });
  });

  document.querySelectorAll('.tb-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      historial.length = 0; // la tabbar reinicia la pila
      ir(btn.dataset.nav, { push: false });
    });
  });

  $('tb-add').addEventListener('click', () => abrirAgregar());
  $('btn-add-inline').addEventListener('click', () => abrirAgregar());
  $('hdr-bell').addEventListener('click', () => ir('sc-alertas'));
  $('card-vencer').addEventListener('click', () => ir('sc-alertas'));
  $('card-recetas').addEventListener('click', () => { historial.length = 0; ir('sc-recetas', { push: false }); });

  document.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => ir(btn.dataset.go));
  });

  /* =========================================================================
     1. SPLASH  y  2. ONBOARDING
     ========================================================================= */
  const ONB_PASOS = [
    {
      titulo: 'Tu despensa<br>bajo control',
      texto: 'Agregá productos escaneando, con una foto o escribiendo. La app lleva el inventario por vos.'
    },
    {
      titulo: 'Nunca más<br>tires comida',
      texto: 'Un semáforo te muestra qué está por vencer, ordenado por urgencia, para consumir primero lo que corre riesgo.'
    },
    {
      titulo: 'Recetas con<br>lo que ya tenés',
      texto: 'El agente cocinero prioriza los productos más próximos a vencer y te dice el paso a paso.'
    }
  ];

  let onbPaso = 0;

  function pintarOnboarding() {
    const p = ONB_PASOS[onbPaso];
    $('onb-art').innerHTML = Ilustraciones.onboarding(onbPaso);
    $('onb-title').innerHTML = p.titulo;
    $('onb-text').textContent = p.texto;
    $('onb-dots').innerHTML = ONB_PASOS.map((_, i) => `<i class="${i === onbPaso ? 'on' : ''}"></i>`).join('');
  }

  function terminarOnboarding() {
    localStorage.setItem('despensa_inteligente_v1::onboarded', '1');
    $('onboarding').hidden = true;
    $('shell').hidden = false;
    arrancarApp();
  }

  $('onb-next').addEventListener('click', () => {
    if (onbPaso < ONB_PASOS.length - 1) { onbPaso++; pintarOnboarding(); }
    else terminarOnboarding();
  });
  $('onb-skip').addEventListener('click', terminarOnboarding);

  $('splash-logo').innerHTML = Ilustraciones.marca(92);

  $('splash-start').addEventListener('click', () => {
    $('splash').classList.add('hide');
    const yaVio = localStorage.getItem('despensa_inteligente_v1::onboarded');
    setTimeout(() => {
      $('splash').style.display = 'none';
      if (yaVio) { $('shell').hidden = false; arrancarApp(); }
      else { $('onboarding').hidden = false; pintarOnboarding(); }
    }, 400);
  });

  /* =========================================================================
     3. DASHBOARD
     ========================================================================= */
  function renderDashboard() {
    const perfil = DB.get('profile', {});
    $('greet-name').innerHTML = perfil.name
      ? `¡Hola, ${escapeHtml(perfil.name)}! 👋`
      : '¡Hola! 👋';

    const enriquecidos = AgenteVencimientos.analyze();
    const riesgo = AgenteVencimientos.enRiesgo(enriquecidos);
    const prefs = DB.get('preferences', {});
    const umbral = (prefs.alertThresholds && prefs.alertThresholds.default && prefs.alertThresholds.default.yellow) || 3;

    $('fc-vencer-n').textContent = `${riesgo.length} producto${riesgo.length === 1 ? '' : 's'}`;
    $('fc-vencer-dias').textContent = umbral;

    const recetas = AgenteCocinero.suggestRecipes(enriquecidos);
    $('fc-recetas-n').textContent = `${recetas.length} receta${recetas.length === 1 ? '' : 's'}`;

    // Ilustraciones de las tarjetas
    $('fc-vencer-art').innerHTML = `<svg viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <path d="M18 8h24M18 52h24" stroke="var(--amarillo)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M21 8v7c0 6 9 11 9 15s-9 9-9 15v7h18v-7c0-6-9-11-9-15s9-9 9-15V8" stroke="var(--amarillo)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M25 44c1-4 5-6 5-6s4 2 5 6h-10Z" fill="var(--amarillo)"/>
      <circle cx="30" cy="20" r="3" fill="var(--amarillo)" opacity="0.6"/>
    </svg>`;
    $('fc-recetas-art').innerHTML = `<svg viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <path d="M8 30a22 22 0 0 0 44 0H8Z" fill="var(--verde)" opacity="0.25"/>
      <path d="M8 30a22 22 0 0 0 44 0" stroke="var(--verde)" stroke-width="3" stroke-linecap="round"/>
      <path d="M6 30h48" stroke="var(--verde)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="22" cy="22" r="5" fill="var(--verde)" opacity="0.8"/>
      <circle cx="36" cy="20" r="4" fill="var(--accent)" opacity="0.8"/>
      <circle cx="30" cy="26" r="3.5" fill="var(--amarillo)" opacity="0.9"/>
    </svg>`;

    // Resumen por categoría
    const porCat = {};
    enriquecidos.forEach((p) => { porCat[p.category] = (porCat[p.category] || 0) + 1; });
    const cont = $('cat-summary');
    const cats = Object.keys(porCat);
    cont.innerHTML = cats.length === 0
      ? `<div class="empty-state" style="width:100%">Tu despensa está vacía. Tocá + para cargar el primer producto.</div>`
      : cats.map((c) => `
          <button class="cat-tile" data-cat="${c}">
            ${Ilustraciones.iconoCategoria(c, 20)}
            <span class="ct-count">${porCat[c]}</span>
            <span class="ct-name">${NOMBRE_CATEGORIA[c] || c}</span>
          </button>`).join('');

    cont.querySelectorAll('[data-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        filtroCategoria = b.dataset.cat;
        historial.length = 0;
        ir('sc-productos', { push: false });
      });
    });

    // Actividad del ciclo agéntico (evidencia de la orquestación)
    const log = DB.get('systemLog', []).slice(-4).reverse();
    $('cycle-mini').innerHTML = log.length === 0
      ? `<div class="empty-state">El ciclo todavía no se ejecutó.</div>`
      : log.map((e) => `<div class="cm-row"><span class="cm-step">${escapeHtml(e.paso)}</span><span class="cm-txt">${escapeHtml(e.detalle)}</span></div>`).join('');

    // Badge de la campana
    const criticos = riesgo.filter((p) => p.urgencia === 'rojo' || p.urgencia === 'vencido').length;
    const badge = $('hdr-badge');
    badge.hidden = criticos === 0;
    badge.textContent = criticos;
  }

  /* =========================================================================
     4. MIS PRODUCTOS
     ========================================================================= */
  let filtroCategoria = 'todos';
  let textoBusqueda = '';

  $('hdr-search').addEventListener('click', () => {
    const sb = $('searchbar');
    sb.hidden = !sb.hidden;
    if (!sb.hidden) $('prod-search').focus();
    else { textoBusqueda = ''; $('prod-search').value = ''; renderProductos(); }
  });

  $('prod-search').addEventListener('input', (e) => {
    textoBusqueda = e.target.value.trim().toLowerCase();
    renderProductos();
  });

  function renderProductos() {
    const enriquecidos = AgenteVencimientos.analyze();

    // Chips de filtro: sólo las categorías que existen en la despensa
    const cats = [...new Set(enriquecidos.map((p) => p.category))];
    $('prod-filters').innerHTML =
      `<button class="chip ${filtroCategoria === 'todos' ? 'active' : ''}" data-f="todos">Todos</button>` +
      cats.map((c) => `<button class="chip ${filtroCategoria === c ? 'active' : ''}" data-f="${c}">${NOMBRE_CATEGORIA[c] || c}</button>`).join('');

    $('prod-filters').querySelectorAll('[data-f]').forEach((b) => {
      b.addEventListener('click', () => { filtroCategoria = b.dataset.f; renderProductos(); });
    });

    const lista = enriquecidos.filter((p) =>
      (filtroCategoria === 'todos' || p.category === filtroCategoria) &&
      (!textoBusqueda || p.name.toLowerCase().includes(textoBusqueda)));

    const cont = $('productos-list');
    if (lista.length === 0) {
      cont.innerHTML = `<div class="empty-state"><span class="emoji">🗄️</span>${
        enriquecidos.length === 0
          ? 'Tu despensa está vacía. Tocá + para agregar tu primer producto.'
          : 'No hay productos que coincidan con este filtro.'}</div>`;
      return;
    }

    cont.innerHTML = lista.map((p) => `
      <div class="prod-row" data-edit="${p.id}" role="button" tabindex="0">
        ${Ilustraciones.producto(p.category, 44)}
        <div class="prod-info">
          <div class="prod-name">${escapeHtml(p.name)}</div>
          <div class="prod-meta">Vence ${fechaLarga(p.expiryDate)} · ${escapeHtml(p.location || 'Heladera')}${p.quantity > 1 ? ` · x${p.quantity}` : ''}</div>
        </div>
        <span class="days-badge ${p.urgencia}">${textoDias(p)}</span>
      </div>`).join('');

    cont.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', () => abrirAgregar(row.dataset.edit));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirAgregar(row.dataset.edit); }
      });
    });
  }

  /* =========================================================================
     5. AGREGAR / EDITAR PRODUCTO
     ========================================================================= */
  let editandoId = null;

  function abrirAgregar(id = null) {
    editandoId = id;
    const esEdicion = Boolean(id);

    // Reset de paneles de captura (defensivo: nada acá debe impedir que la
    // pantalla se abra; agregar un producto es la acción más importante).
    try {
      stopCameras();
      set('panel-scan', 'hidden', true);
      set('panel-photo', 'hidden', true);
      set('panel-auto', 'hidden', true);
      document.querySelectorAll('.capture-btn').forEach((b) => b.classList.remove('active'));
      set('s-origen', 'textContent', '');
      set('p-ocr-status', 'textContent', '');
      set('auto-status', 'textContent', '');
      pasoEstado('step-codigo', '', 'buscando…');
      pasoEstado('step-nombre', '', 'en espera');
      pasoEstado('step-fecha', '', 'en espera');
      anunciar('Paso 1 de 2', 'Apuntá al código de barras');
    } catch (e) {
      console.warn('[Despensa] No se pudo reiniciar la cámara:', e);
    }

    if (esEdicion) {
      const p = AgenteInventario.getById(id);
      if (!p) return;
      set('f-name', 'value', p.name);
      set('f-category', 'value', p.category || 'otros');
      set('f-expiry', 'value', p.expiryDate);
      set('f-quantity', 'value', p.quantity);
      set('f-location', 'value', p.location || 'Heladera');
      set('f-consume-qty', 'value', p.quantity);
      set('f-consume-qty', 'max', p.quantity);
    } else {
      set('f-name', 'value', '');
      set('f-category', 'value', '');
      set('f-expiry', 'value', '');
      set('f-quantity', 'value', 1);
      set('f-location', 'value', 'Heladera');
      set('s-barcode', 'value', '');
    }

    set('f-save', 'textContent', esEdicion ? 'Guardar cambios' : 'Guardar producto');
    set('f-delete', 'hidden', !esEdicion);
    set('f-delete-note', 'hidden', !esEdicion);
    set('f-consume-row', 'hidden', !esEdicion);

    ir('sc-agregar');
    set('hdr-title', 'textContent', esEdicion ? 'Editar producto' : 'Agregar producto');
  }

  document.querySelectorAll('.capture-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const metodo = btn.dataset.method;
      const yaActivo = btn.classList.contains('active');
      stopCameras();
      document.querySelectorAll('.capture-btn').forEach((b) => b.classList.remove('active'));
      $('panel-scan').hidden = true;
      $('panel-photo').hidden = true;
      $('panel-auto').hidden = true;
      if (yaActivo) return;
      btn.classList.add('active');
      if (metodo === 'auto') $('panel-auto').hidden = false;
      if (metodo === 'scan') $('panel-scan').hidden = false;
      if (metodo === 'photo') $('panel-photo').hidden = false;
    });
  });

  $('f-estimar').addEventListener('click', () => {
    const cat = $('f-category').value;
    if (!cat) { toast('Elegí primero una categoría para poder estimar.'); return; }
    const { fecha, dias } = AgenteCaptura.estimarVencimiento(cat);
    $('f-expiry').value = fecha;
    toast(`Fecha estimada: ${dias} días para ${NOMBRE_CATEGORIA[cat] || cat}. Ajustala si conocés la real.`);
  });

  $('f-save').addEventListener('click', () => {
    const datos = {
      name: $('f-name').value,
      category: $('f-category').value || 'otros',
      expiryDate: $('f-expiry').value,
      quantity: $('f-quantity').value,
      location: $('f-location').value
    };
    try {
      if (editandoId) {
        AgenteInventario.edit(editandoId, datos);
        toast('Producto actualizado. El inventario vuelve a reflejar la realidad.');
      } else {
        const codigo = $('s-barcode').value.trim();
        if (codigo) {
          // Vía escaneo: el nombre/categoría corregidos se memorizan en el cache
          AgenteCaptura.procesarEscaneo(codigo, datos)
            .then(() => { toast('Producto agregado. El código queda memorizado.'); volverDeAgregar(); })
            .catch((e) => toast(e.message));
          return;
        }
        AgenteCaptura.procesarManual(datos);
        toast(`"${datos.name}" agregado al inventario.`);
      }
      volverDeAgregar();
    } catch (e) {
      toast(e.message);
    }
  });

  function volverDeAgregar() {
    stopCameras();
    editandoId = null;
    const previa = historial.pop();
    ir(previa || 'sc-productos', { push: false });
  }

  $('f-consume').addEventListener('click', () => {
    if (!editandoId) return;
    const p = AgenteInventario.getById(editandoId);
    if (!p) return;
    const n = Math.max(1, Math.min(Number($('f-consume-qty').value) || 1, p.quantity));
    const res = AgenteEvaluador.consumirUnidades(editandoId, n);
    if (res && res.parcial) {
      toast(`Anotado: consumiste ${n}. Quedan ${res.restante} ${p.name}.`);
    } else {
      toast(`"${p.name}" consumido por completo. ¡Suma a tu impacto!`);
    }
    volverDeAgregar();
  });

  $('f-delete').addEventListener('click', () => {
    if (!editandoId) return;
    const p = AgenteInventario.getById(editandoId);
    if (!p) return;
    if (!confirm(`¿Eliminar "${p.name}"? Se usa para cargas por error: no cuenta como desperdicio.`)) return;
    AgenteInventario.remove(editandoId);
    toast('Producto eliminado del inventario.');
    volverDeAgregar();
  });

  /* =========================================================================
     MODO ESCÁNER: código de barras + fecha en una sola pasada
     -------------------------------------------------------------------------
     Un único stream de cámara alimenta las dos lecturas: el lector de códigos
     dibuja su propio <video>, y el OCR toma frames de ESE mismo elemento. Así
     no se abren dos cámaras (algo que los celulares no permiten) y el usuario
     sólo tiene que apuntar.
     ========================================================================= */
  let autoScanner = null;
  let codigoYaLeido = false;

  function pasoEstado(id, estado, valor) {
    const el = find(id);
    if (!el) return;
    el.classList.remove('buscando', 'listo');
    if (estado) el.classList.add(estado);
    const val = el.querySelector('.ss-val');
    if (val) val.textContent = valor;
  }

  /**
   * Cartel grande de etapa. El escáner falla sobre todo por no saber a qué
   * apuntar: si el usuario no ve que el código YA se leyó, sigue insistiendo
   * con el código mientras el agente espera la fecha.
   */
  function anunciar(paso, accion, listo = false) {
    set('auto-paso', 'textContent', paso);
    set('auto-accion', 'textContent', accion);
    const b = find('auto-banner');
    if (b) b.classList.toggle('listo', listo);
  }

  function vibrar(patron) {
    try { navigator.vibrate && navigator.vibrate(patron); } catch (e) { /* sin soporte */ }
  }

  function encuadreFecha(activo) {
    const stage = document.querySelector('.scan-stage');
    if (stage) stage.classList.toggle('paso-fecha', activo);
  }

  async function iniciarEscanerAuto() {
    if (typeof Html5Qrcode === 'undefined') {
      toast('No se pudo cargar el lector (¿sin conexión?). Usá "Sólo código" o carga manual.');
      return;
    }
    if (autoScanner) return;
    if (!find('auto-reader')) { toast('El modo escáner no está disponible en esta versión.'); return; }

    set('auto-start', 'hidden', true);
    set('auto-stop', 'hidden', false);

    // La linterna se ofrece recién cuando la cámara arrancó y sólo si el
    // dispositivo la expone: mostrar un botón que no hace nada es peor que
    // no mostrarlo. Se consulta con un margen, porque el track tarda un
    // instante en publicar sus capacidades.
    setTimeout(async () => {
      const stream = streamDelLector('auto-reader');
      const track = stream && stream.getVideoTracks()[0];
      let tieneLinterna = false;
      try { tieneLinterna = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch (e) { /* no soportado */ }
      set('auto-torch', 'hidden', !tieneLinterna);
      if (tieneLinterna) set('auto-torch', 'textContent', 'Linterna');
    }, 900);
    pasoEstado('step-codigo', 'buscando', 'buscando…');
    pasoEstado('step-nombre', 'buscando', 'buscando…');
    pasoEstado('step-fecha', 'buscando', 'buscando…');
    encuadreFecha(false);
    anunciar('Mostrame el producto', 'Código, nombre o fecha: leo lo que encuentre');
    set('auto-status', 'textContent', 'Cámara activa. Movelo despacio: no hay un orden obligatorio, voy completando lo que vaya reconociendo.');

    // La config de formatos va acá, en el constructor: pasarla en start() no
    // tiene efecto (la librería la lee una sola vez, al construir el shim).
    autoScanner = new Html5Qrcode('auto-reader', configLector());

    try {
      await autoScanner.start(
        { facingMode: 'environment' },
        // `videoConstraints` tiene prioridad sobre el primer argumento y es
        // la única vía para pedirle resolución y foco a html5-qrcode. Importa
        // acá tanto o más que en el modo foto: el <video> de ESTE lector es
        // el que después alimenta el OCR continuo de la fecha, así que si el
        // stream abre en 640×480 la fecha no se lee nunca.
        {
          // Con 4 formatos en vez de 17 y sin el pase espejado, cada cuadro
          // cuesta bastante menos: se puede muestrear más seguido, que es
          // lo que hace que "encuentre" el código mientras uno lo mueve.
          fps: 15,
          qrbox: recuadroCodigo,
          disableFlip: true,
          videoConstraints: VIDEO_CONSTRAINTS
        },
        async (codigo) => {
          if (codigoYaLeido) return;
          codigoYaLeido = true;

          // El lector sigue vivo a propósito: el OCR reutiliza SU elemento
          // <video> como fuente de frames. Abrir una segunda cámara no es
          // posible en un celular.
          vibrar(60);
          pasoEstado('step-codigo', 'listo', codigo);
          set('s-barcode', 'value', codigo);
          anunciar('Código leído', 'Seguí mostrándome el envase: falta la fecha', true);

          const info = await AgenteCaptura.resolverGTIN(codigo);
          if (info.name) {
            // El dato del código PISA al del OCR a propósito, aunque el OCR
            // haya llegado antes: un EAN-13 trae verificación y devuelve el
            // nombre oficial del producto, mientras que el OCR puede leer mal
            // sin que nadie se entere. Entre los dos, gana el verificable.
            set('f-name', 'value', info.name);
            pasoEstado('step-codigo', 'listo', info.name);
            pasoEstado('step-nombre', 'listo', 'desde el código');
          }
          if (info.category) set('f-category', 'value', info.category);

          arrancarOCRContinuo();
        },
        () => {} // frames sin código: silencioso
      );

      /* Lectura EN PARALELO, no en secuencia.
         -----------------------------------------------------------------
         Antes esto esperaba SEIS segundos antes de intentar leer el envase.
         Durante ese rato, si el usuario mostraba el frente del producto en
         vez del código, la pantalla no hacía nada — y el cartel decía
         "Paso 1 de 2", que enseñaba un orden obligatorio que no existe.

         El código de barras nunca fue obligatorio: es preferible cuando
         aparece, porque es verificable, pero el envase alcanza. Así que el
         OCR arranca casi enseguida y los dos lectores conviven sobre el
         mismo <video> (no se puede abrir dos cámaras en un teléfono).

         Los dos segundos de ventaja no son un capricho: Tesseract es pesado
         y compite por CPU con el decodificador. Si el código está a la
         vista, en ese tiempo ya se leyó y el OCR arranca sin estorbar. Si
         no está, la espera es corta y no se siente como una pausa muerta. */
      setTimeout(() => {
        if (!autoScanner || AgenteCaptura.estaEscaneando()) return;
        if (!codigoYaLeido) {
          // El lector de códigos NO se detiene: si el código aparece más
          // tarde, se engancha igual y corrige el nombre leído por OCR.
          pasoEstado('step-codigo', 'buscando', 'sigo buscándolo');
        }
        arrancarOCRContinuo();
      }, 2000);

    } catch (err) {
      toast('No se pudo activar la cámara: ' + err);
      detenerEscanerAuto();
    }
  }

  function arrancarOCRContinuo() {
    const video = document.querySelector('#auto-reader video');
    if (!video) return;
    if (AgenteCaptura.estaEscaneando()) return;

    const campoNombre = find('f-name');
    const faltaNombre = !campoNombre || !campoNombre.value.trim();

    encuadreFecha(true);
    pasoEstado('step-fecha', 'buscando', 'leyendo…');
    if (faltaNombre) pasoEstado('step-nombre', 'buscando', 'leyendo…');
    set('auto-status', 'textContent', 'Preparando el lector de texto…');

    // Al pasar de código de barras a fecha cambia la distancia de trabajo: el
    // código se lee de lejos, la fecha casi pegada. Se fuerza un reenfoque en
    // ese momento, si no la cámara queda fijada en la distancia anterior.
    // No se espera el resultado: el escaneo es continuo y reintenta solo.
    ajustarCamara(video.srcObject).then((info) => {
      if (info && info.ancho && info.ancho < 1280) {
        set('auto-status', 'textContent',
          `Atención: la cámara abrió en ${info.ancho}×${info.alto}. A esa resolución la fecha puede no leerse.`);
      }
      return reenfocar(video.srcObject);
    }).catch(() => { /* la cámara no expone control de foco */ });

    AgenteCaptura.iniciarEscaneoContinuo(video, {
      buscarNombre: faltaNombre,

      onProgreso: (i, max) => {
        set('auto-status', 'textContent',
          `Leyendo el envase… (intento ${i} de ${max}). Acercá la cámara al texto, quieta y con buena luz.`);
      },

      // El nombre se lee del frente del envase: es el texto más grande.
      onNombre: (texto) => {
        const campo = find('f-name');
        if (!campo || campo.value.trim()) return;
        campo.value = texto;
        pasoEstado('step-nombre', 'listo', texto);
        vibrar(40);
      },

      onFecha: (iso, confianza, motivo) => {
        if (motivo === 'sin_motor') {
          pasoEstado('step-fecha', '', 'sin conexión');
          set('auto-status', 'textContent', 'No se pudo cargar el lector de texto (necesita conexión la primera vez). Cargá la fecha a mano abajo.');
          return;
        }
        if (!iso) {
          pasoEstado('step-fecha', '', 'no se pudo leer');
          anunciar('Sin lectura', 'Cargá la fecha a mano abajo');
          set('auto-status', 'textContent', 'No encontré la fecha. Suele estar en la tapa o el borde; probá más cerca y con más luz, o usá "No la sé — estimar por categoría".');
          return;
        }
        set('f-expiry', 'value', iso);
        pasoEstado('step-fecha', 'listo', fmtFecha(iso));
        vibrar([60, 40, 60]);

        const detalle = motivo === 'confirmada'
          ? 'La leí dos veces igual, así que es confiable.'
          : motivo === 'alta_confianza'
            ? `Leída con ${Math.round(confianza * 100)}% de certeza.`
            : `Lectura con poca certeza (${Math.round(confianza * 100)}%): revisala antes de guardar.`;
        anunciar('Listo', `Vence el ${fmtFecha(iso)}`, true);
        set('auto-status', 'textContent', `${detalle} Revisá los datos abajo y guardá.`);

        detenerEscanerAuto();
        toast('Producto leído. Revisá y guardá.');
      }
    });
  }

  function detenerEscanerAuto() {
    AgenteCaptura.detenerEscaneo();

    // La linterna se apaga ANTES de soltar la cámara: si el track muere con
    // el torch prendido, en varios Android el LED queda encendido hasta que
    // otra app toma la cámara. Es un bug molesto y fácil de evitar.
    if (linternaEncendida) {
      alternarLinterna(streamDelLector('auto-reader'), false).catch(() => {});
      linternaEncendida = false;
      set('auto-torch', 'textContent', 'Linterna');
    }
    set('auto-torch', 'hidden', true);

    if (autoScanner) {
      autoScanner.stop().catch(() => {});
      autoScanner = null;
    }
    codigoYaLeido = false;
    encuadreFecha(false);
    set('auto-start', 'hidden', false);
    set('auto-stop', 'hidden', true);
  }

  on('auto-start', 'click', iniciarEscanerAuto);
  on('auto-stop', 'click', () => {
    detenerEscanerAuto();
    set('auto-status', 'textContent', 'Escáner detenido.');
  });

  // --- Escaneo de código de barras ---
  let qrScanner = null;

  $('s-start-camera').addEventListener('click', () => {
    if (qrScanner) return;
    if (typeof Html5Qrcode === 'undefined') {
      toast('No se pudo cargar el lector (¿sin conexión?). Ingresá el código a mano.');
      return;
    }
    const video = find('camera-preview');
    if (!video) { toast('No se encontró el visor de cámara. Recargá con Ctrl+Shift+R.'); return; }
    video.style.display = 'none';
    // Ojo: acá hay que usar find(), no $(). El contenedor se crea al vuelo la
    // primera vez, y $() devuelve un nodo suelto en lugar de null, con lo cual
    // el `if (!cont)` nunca se cumpliría y el div nunca se insertaría al DOM.
    let cont = find('qr-reader-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'qr-reader-container';
      video.parentNode.insertBefore(cont, video);
    }
    qrScanner = new Html5Qrcode('qr-reader-container', configLector());
    Html5Qrcode.getCameras().then((cams) => {
      if (!cams || !cams.length) { toast('No se detectó cámara.'); return; }
      qrScanner.start({ facingMode: 'environment' },
        { fps: 15, qrbox: recuadroCodigo, disableFlip: true, videoConstraints: VIDEO_CONSTRAINTS },
        (texto) => {
          $('s-barcode').value = texto;
          toast(`Código detectado: ${texto}`);
          qrScanner.stop().catch(() => {});
        }, () => {}
      ).catch((err) => toast('No se pudo activar la cámara: ' + err));
    }).catch(() => toast('No se pudo acceder a la cámara.'));
  });

  $('s-lookup').addEventListener('click', async () => {
    const codigo = $('s-barcode').value.trim();
    if (!codigo) { toast('Ingresá o escaneá un código de barras.'); return; }
    toast('Consultando base de productos...');
    const info = await AgenteCaptura.resolverGTIN(codigo);
    if (info.name) $('f-name').value = info.name;
    if (info.category) $('f-category').value = info.category;

    const msg = {
      cache: '✓ Reconocido desde tu historial de escaneos (funciona sin conexión).',
      online: '✓ Identificado en la base de productos. Queda guardado para la próxima.',
      offline: 'Sin conexión y sin registro previo: escribí el nombre y lo guardo para futuros escaneos.',
      no_encontrado: 'El código no está en la base: escribí el nombre y lo guardo para futuros escaneos.'
    };
    $('s-origen').textContent = msg[info.origen] || '';
  });

  /* ===== Cámara: resolución y enfoque ==================================
     El OCR fallaba sobre fechas troqueladas aunque el usuario apuntara
     bien. La causa no era el parser sino el frame de origen:

     1) RESOLUCIÓN. `getUserMedia({video:{facingMode:'environment'}})` sin
        width/height deja que el navegador elija, y el default habitual en
        celular es 640×480. Una fecha en matriz de puntos ocupa ahí unos
        pocos píxeles de alto; el preprocesado la agranda a 1400 px, pero
        agrandar no agrega detalle, sólo amplía el borrón. Se piden 4K como
        `ideal` (nunca `exact`: si la cámara no lo soporta, el navegador
        entrega lo mejor que tenga en vez de fallar la llamada entera).
     2) ENFOQUE. No se pedía foco. Al acercar el envase para llenar la
        pantalla, el teléfono no reenfoca y el texto grande sobrevive al
        desenfoque pero el troquelado fino no. `focusMode: 'continuous'`
        va en `advanced` —no es estándar en todos los navegadores y ahí se
        ignora en silencio en lugar de romper— y además se reintenta con
        `applyConstraints()` sobre el track ya abierto, que es donde
        Android efectivamente lo aplica.
     ===================================================================== */
  const VIDEO_CONSTRAINTS = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    advanced: [
      { focusMode: 'continuous' },
      { focusDistance: { ideal: 0 } }   // sesgo hacia macro: el envase está cerca
    ]
  };

  /* ===== Configuración del lector de códigos ============================
     Dos ajustes que explican por qué antes había que "buscarle la posición"
     al producto. Los dos se verificaron leyendo el código de html5-qrcode
     2.3.8, que es la versión que carga el index.

     1) FORMATOS. `formatsToSupport` se pasa al CONSTRUCTOR y, si no se pasa
        nada, la librería habilita LOS 17 formatos que conoce: QR, Aztec,
        Codabar, Code 39/93/128, Data Matrix, MaxiCode, ITF, PDF417, RSS...
        Un producto de almacén sólo puede tener EAN-13, EAN-8, UPC-A o
        UPC-E. Estábamos pagando el costo de buscar trece simbologías que
        es imposible que aparezcan.

     2) FLIP. `disableFlip` viene en false. En el código, cada vez que un
        cuadro NO decodifica, la librería espeja el canvas y lo decodifica
        DE NUEVO (html5-qrcode.js:579). O sea: mientras el usuario busca la
        posición —cuando todos los cuadros fallan— cada cuadro cuesta el
        doble. Y el espejado sólo sirve para códigos vistos en un espejo,
        que no es el caso de un envase.

     Lo que NO hacía falta tocar: `useBarCodeDetectorIfSupported` ya viene
     en true por defecto, así que el detector nativo del navegador (mucho
     más rápido que ZXing) ya se estaba usando donde existe.
     ===================================================================== */
  function formatosDeProducto() {
    if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
    return [
      Html5QrcodeSupportedFormats.EAN_13,   // el estándar en góndola
      Html5QrcodeSupportedFormats.EAN_8,    // envases chicos
      Html5QrcodeSupportedFormats.UPC_A,    // importados de EE.UU.
      Html5QrcodeSupportedFormats.UPC_E
    ];
  }

  function configLector() {
    const formatos = formatosDeProducto();
    return formatos ? { formatsToSupport: formatos, useBarCodeDetectorIfSupported: true } : undefined;
  }

  /* Recuadro de lectura. Antes era fijo en píxeles (260×160), que en un
     teléfono angosto queda enorme y en uno ancho, chico. Como función se
     adapta al visor y mantiene la proporción apaisada que tiene un código
     de barras: ancho y bajo. Recortar también acelera, porque la librería
     decodifica sólo ese rectángulo. */
  function recuadroCodigo(anchoVisor, altoVisor) {
    const ancho = Math.floor(Math.min(anchoVisor * 0.85, 420));
    const alto = Math.floor(Math.min(altoVisor * 0.45, ancho * 0.55));
    return { width: Math.max(120, ancho), height: Math.max(80, alto) };
  }

  /** Linterna: en góndola y en alacena la falta de luz es la causa #1 de
      que un código no lea. Sólo se ofrece si la cámara la expone. */
  async function alternarLinterna(stream, encender) {
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return false;
    let caps = {};
    try { caps = track.getCapabilities(); } catch (e) { return false; }
    if (!caps.torch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: !!encender }] });
      return true;
    } catch (e) { return false; }
  }

  function streamDelLector(contenedorId) {
    const v = document.querySelector(`#${contenedorId} video`);
    return v && v.srcObject ? v.srcObject : null;
  }

  let linternaEncendida = false;
  const btnTorch = find('auto-torch');
  if (btnTorch) {
    btnTorch.addEventListener('click', async () => {
      const stream = streamDelLector('auto-reader');
      const ok = await alternarLinterna(stream, !linternaEncendida);
      if (!ok) { toast('Esta cámara no permite controlar la linterna.'); return; }
      linternaEncendida = !linternaEncendida;
      btnTorch.textContent = linternaEncendida ? 'Apagar linterna' : 'Linterna';
    });
  }

  /**
   * Pide foco continuo sobre un stream ya abierto. Se hace aparte del
   * getUserMedia porque varios navegadores ignoran `advanced` en la
   * apertura pero sí respetan applyConstraints después.
   * Devuelve la resolución real conseguida, para poder mostrarla.
   */
  async function ajustarCamara(stream) {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return null;

    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* no soportado */ }

    const avanzadas = [];
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      avanzadas.push({ focusMode: 'continuous' });
    }
    // Un poco de zoom óptico/digital ayuda a que la fecha ocupe más píxeles
    // reales del sensor, pero pasarse recorta y pixela: tope en 2x.
    if (caps.zoom && caps.zoom.max > 1) {
      avanzadas.push({ zoom: Math.min(2, caps.zoom.max) });
    }
    if (avanzadas.length) {
      try { await track.applyConstraints({ advanced: avanzadas }); } catch (e) { /* best effort */ }
    }

    const s = track.getSettings ? track.getSettings() : {};
    return { ancho: s.width || 0, alto: s.height || 0, foco: s.focusMode || 'desconocido', track };
  }

  /** Reintenta el enfoque: en foco continuo el teléfono a veces queda fijado. */
  async function reenfocar(stream) {
    const track = stream && stream.getVideoTracks()[0];
    if (!track || !track.applyConstraints) return;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
      await new Promise((r) => setTimeout(r, 120));
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) { /* la cámara no expone control de foco */ }
  }

  // --- Foto + OCR ---
  let photoStream = null;

  $('p-start-camera').addEventListener('click', async () => {
    try {
      photoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      $('camera-preview-photo').srcObject = photoStream;

      const info = await ajustarCamara(photoStream);
      $('p-capture').disabled = false;

      if (info) {
        const mp = ((info.ancho * info.alto) / 1e6).toFixed(1);
        set('p-ocr-status', 'textContent',
          `Cámara lista: ${info.ancho}×${info.alto} (${mp} MP), foco "${info.foco}". ` +
          (info.ancho < 1280
            ? 'Ojo: es baja resolución, la fecha puede no leerse.'
            : 'Acercá hasta que la fecha llene el recuadro y esperá a que enfoque.'));
      }
    } catch (e) {
      toast('No se pudo acceder a la cámara: ' + e.message);
    }
  });

  $('p-capture').addEventListener('click', async () => {
    const video = $('camera-preview-photo');
    const canvas = $('photo-canvas');

    // Se le da al autofoco un instante para asentarse: disparar en el mismo
    // gesto del toque suele capturar justo el frame borroso del reenfoque.
    set('p-ocr-status', 'textContent', 'Enfocando…');
    await reenfocar(photoStream);
    await new Promise((r) => setTimeout(r, 400));

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    // Se pasa el canvas directo en vez de canvas.toDataURL(): procesarFoto
    // acepta cualquier fuente dibujable, y serializar un frame 4K a PNG en
    // base64 son ~15 MB de string y varios segundos de bloqueo del hilo.
    await procesarImagenOCR(canvas, `${canvas.width}×${canvas.height}`);
  });

  $('p-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => procesarImagenOCR(reader.result);
    reader.readAsDataURL(file);
  });

  async function procesarImagenOCR(fuente, resolucion) {
    const status = $('p-ocr-status');
    status.textContent = 'Leyendo el envase… (la primera vez tarda unos segundos)';
    try {
      const prefs = DB.get('preferences', {});
      const res = await AgenteCaptura.procesarFoto(fuente, prefs.ocrMinConfidence);

      if (res.fechaDetectada) set('f-expiry', 'value', res.fechaDetectada);

      // La foto del FRENTE del envase también sirve: de ahí sale el nombre.
      // Antes esta vía sólo miraba la fecha, así que fotografiar la cara del
      // producto no aportaba nada y el formulario seguía vacío.
      const campoNombre = find('f-name');
      let avisoNombre = '';
      if (res.nombreDetectado && campoNombre && !campoNombre.value.trim()) {
        campoNombre.value = res.nombreDetectado.texto;
        avisoNombre = ` Nombre leído: "${res.nombreDetectado.texto}".`;

        // Si el agente reconoció QUÉ alimento es (no sólo qué letras leyó),
        // también sabe a qué categoría pertenece: se completa sola. Nunca
        // pisa una categoría que el usuario ya haya elegido.
        const campoCat = find('f-category');
        if (res.nombreDetectado.categoria && campoCat && !campoCat.value) {
          campoCat.value = res.nombreDetectado.categoria;
          avisoNombre += ` Categoría: ${res.nombreDetectado.categoria}.`;
        }
      }

      // Cada situación necesita un mensaje distinto: antes todo caía en
      // "confianza baja", incluso cuando el problema era que no había fecha.
      const pct = Math.round(res.confianza * 100);
      const mensajes = {
        ok: `Fecha detectada: ${fmtFecha(res.fechaDetectada)} (certeza ${pct}%). Verificá que sea correcta.`,
        baja_confianza: `Leí "${fmtFecha(res.fechaDetectada)}" pero con poca certeza (${pct}%). Confirmá o corregí abajo.`,
        sin_fecha: 'Encontré texto pero ninguna fecha. Sacá la foto sólo de la fecha, llenando la pantalla, o usá "No la sé — estimar por categoría".',
        sin_texto: 'No se distinguió texto en la foto. Necesita más luz, más cerca y sin movimiento.'
      };
      // La resolución real del frame es el dato que más rápido explica un
      // fallo: si dice 640×480, el problema es la cámara, no el envase.
      const detalle = resolucion ? ` [foto: ${resolucion}]` : '';
      status.textContent = (mensajes[res.estado] || mensajes.sin_texto) + avisoNombre + detalle;

      // Diagnóstico: ver el texto crudo es la única forma de entender por qué
      // una fecha no se leyó (suele ser que el OCR devolvió otra cosa).
      mostrarTextoCrudo(res.textoDetectado);
    } catch (e) {
      status.textContent = 'No se pudo leer automáticamente: ' + (e.message || e) + ' Cargá los datos a mano.';
    }
  }

  function mostrarTextoCrudo(texto) {
    const cont = find('p-ocr-raw');
    if (!cont) return;
    if (!texto) { cont.hidden = true; return; }
    cont.hidden = false;
    cont.innerHTML = '';
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'Ver el texto que leyó la cámara';
    const pre = document.createElement('pre');
    pre.textContent = texto;
    det.appendChild(sum);
    det.appendChild(pre);
    cont.appendChild(det);
  }

  function stopCameras() {
    if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; }
    if (photoStream) { photoStream.getTracks().forEach((t) => t.stop()); photoStream = null; }
    detenerEscanerAuto();
  }

  /* =========================================================================
     6. ALERTAS
     ========================================================================= */
  let tabAlerta = 'proximos';

  document.querySelectorAll('[data-alert-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabAlerta = btn.dataset.alertTab;
      document.querySelectorAll('[data-alert-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      renderAlertas();
    });
  });

  $('tip-close').addEventListener('click', () => { $('tip-card').hidden = true; });

  function renderAlertas() {
    const enriquecidos = AgenteVencimientos.analyze();
    const vencidos = enriquecidos.filter((p) => p.urgencia === 'vencido');
    const proximos = enriquecidos.filter((p) => p.urgencia === 'rojo' || p.urgencia === 'amarillo');
    const lista = tabAlerta === 'vencidos' ? vencidos : proximos;

    const cont = $('alertas-list');
    if (lista.length === 0) {
      cont.innerHTML = `<div class="empty-state"><span class="emoji">${tabAlerta === 'vencidos' ? '🎉' : '✅'}</span>${
        tabAlerta === 'vencidos'
          ? 'No tenés productos vencidos. ¡Buen trabajo!'
          : 'No hay productos próximos a vencer.'}</div>`;
    } else {
      cont.innerHTML = lista.map((p) => `
        <div class="alert-row ${p.urgencia}">
          ${Ilustraciones.producto(p.category, 42)}
          <div class="prod-info">
            <div class="prod-name">${escapeHtml(p.name)}</div>
            <div class="prod-meta">Vence ${fechaLarga(p.expiryDate)} · ${escapeHtml(p.location || 'Heladera')}</div>
            <div class="alert-actions">
              <button class="btn btn-sm btn-secondary" data-out="cocinado" data-id="${p.id}">Consumido</button>
              <button class="btn btn-sm btn-danger" data-out="descartado" data-id="${p.id}">Descartado</button>
            </div>
          </div>
          <span class="days-badge ${p.urgencia}">${textoDias(p)}</span>
        </div>`).join('');

      cont.querySelectorAll('[data-out]').forEach((btn) => {
        btn.addEventListener('click', () => {
          AgenteEvaluador.registrarDesenlace({ productId: btn.dataset.id, outcome: btn.dataset.out });
          toast(btn.dataset.out === 'cocinado'
            ? '¡Rescatado! Suma a tu impacto.'
            : 'Registrado como descartado.');
          renderAlertas();
        });
      });
    }

    // Consejo contextual: siempre honesto respecto de los datos disponibles
    const tip = $('tip-text');
    if (vencidos.length > 0 && tabAlerta === 'vencidos') {
      tip.textContent = 'Los productos vencidos nunca se ofrecen para cocinar: la seguridad alimentaria está por encima de aprovechar. Descartalos para que dejen de contarse.';
    } else if (proximos.length > 0) {
      const primero = proximos[0];
      tip.textContent = `Consumí primero ${primero.name.toLowerCase()}: es lo más urgente. Mirá en Recetas qué podés cocinar con eso.`;
    } else {
      tip.textContent = 'Consumí primero los productos que están por vencer para evitar desperdicios.';
    }
  }

  /* =========================================================================
     7. RECETAS  y  8. DETALLE
     ========================================================================= */
  let recetasCache = [];

  function renderRecetas() {
    const enriquecidos = AgenteVencimientos.analyze();
    const riesgo = AgenteVencimientos.enRiesgo(enriquecidos);
    recetasCache = AgenteCocinero.suggestRecipes(enriquecidos);

    const banner = $('recetas-banner');
    if (riesgo.length === 0) banner.hidden = true;
    else {
      banner.hidden = false;
      $('recetas-banner-text').textContent =
        `⚠ ${riesgo.length} producto${riesgo.length === 1 ? '' : 's'} está${riesgo.length === 1 ? '' : 'n'} por vencer`;
    }

    const destacadaCont = $('recetas-destacada');
    const otrasCont = $('recetas-otras');

    if (recetasCache.length === 0) {
      const hayDescartadas = AgenteCocinero.listarDescartadas().length > 0;
      destacadaCont.innerHTML = `<div class="empty-state"><span class="emoji">🍳</span>${
        hayDescartadas
          ? 'Descartaste todas las recetas posibles con lo que tenés. Restauralas desde Perfil → Preferencias.'
          : 'Agregá productos para que el agente cocinero proponga recetas.'}</div>`;
      otrasCont.innerHTML = '';
      return;
    }

    const [primera, ...resto] = recetasCache;
    destacadaCont.innerHTML = `
      <div class="recipe-big" data-receta="0">
        ${Ilustraciones.receta(primera.receta.id, '148px')}
        <div class="rb-body">
          ${primera.rescataPrioritario ? `<div class="priority-flag">Rescata lo más urgente: ${escapeHtml(primera.productoPrioritario.name)}</div>` : ''}
          <h4>${escapeHtml(primera.receta.name)}</h4>
          <div class="rb-uses">${primera.ingredientesUsados.map(escapeHtml).join(', ')}</div>
          <div class="rb-meta">
            <span>⏱ ${primera.receta.cookTimeMin} min</span>
            <span>🍽 ${primera.receta.servings} porción${primera.receta.servings === 1 ? '' : 'es'}</span>
          </div>
        </div>
      </div>`;

    otrasCont.innerHTML = resto.length === 0
      ? `<div class="empty-state">No hay más ideas con lo que tenés ahora mismo.</div>`
      : resto.map((c, i) => `
          <div class="recipe-mini" data-receta="${i + 1}">
            <div class="rm-thumb">${Ilustraciones.receta(c.receta.id, '56px')}</div>
            <div class="prod-info">
              <h5>${escapeHtml(c.receta.name)}</h5>
              <p>${c.receta.cookTimeMin} min · ${c.ingredientesUsados.length} de tu despensa</p>
            </div>
          </div>`).join('');

    document.querySelectorAll('[data-receta]').forEach((el) => {
      el.addEventListener('click', () => abrirReceta(Number(el.dataset.receta)));
    });
  }

  let recetaAbierta = null;

  function abrirReceta(indice) {
    const c = recetasCache[indice];
    if (!c) return;
    recetaAbierta = c;

    $('rd-hero').innerHTML = Ilustraciones.receta(c.receta.id, '210px');
    $('rd-name').textContent = c.receta.name;
    $('rd-meta').innerHTML = `
      <span>⏱ ${c.receta.cookTimeMin} min</span>
      <span>🍽 ${c.receta.servings} porción${c.receta.servings === 1 ? '' : 'es'}</span>
      <span>${c.receta.tags.length ? c.receta.tags.map((t) => t.replace('_', ' ')).join(' · ') : 'sin restricciones'}</span>`;

    const rescate = $('rd-rescue');
    if (c.rescataPrioritario) {
      rescate.hidden = false;
      const p = c.productoPrioritario;
      rescate.textContent = `Rescata ${p.name} — ${p.daysRemaining <= 0 ? 'vence hoy' : `vence en ${p.daysRemaining} día(s)`}`;
    } else rescate.hidden = true;

    // Advertencias del hogar: para quién no sirve o qué cuidar.
    // Los bloqueos no aparecen acá porque esas recetas ni se sugieren.
    const avisos = (c.hogar && c.hogar.advertencias) || [];
    $('rd-avisos').innerHTML = avisos.length === 0 ? '' :
      avisos.map((a) => `<div class="aviso">⚠ ${escapeHtml(a)}</div>`).join('');

    // Ingredientes con cantidad, marcando los que no tenés
    const faltantesNorm = c.faltantes.map(normalizeName);
    $('rd-ingredientes').innerHTML = ingredientesConCantidad(c.receta).map((ing) => {
      const falta = faltantesNorm.includes(normalizeName(ing.nombre.replace(/ /g, '_'))) ||
                    faltantesNorm.includes(normalizeName(ing.nombre));
      return `<div class="ing-row ${falta ? 'falta' : ''}">
        <span class="ing-name"><i class="ing-dot"></i>${escapeHtml(ing.nombre)}</span>
        <span class="ing-qty">${escapeHtml(ing.cantidad)}</span>
      </div>`;
    }).join('');

    $('rd-preparacion').innerHTML = c.receta.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    // Links externos. YouTube busca el video de la receta; elGourmet no admite
    // búsquedas por URL (su filtro es sólo JavaScript), así que se llega vía
    // búsqueda de Google acotada a su sección de recetas, priorizando el
    // ingrediente más urgente para que las ideas rescaten lo que está por vencer.
    $('rd-youtube').href = 'https://www.youtube.com/results?search_query=' +
      encodeURIComponent(`receta ${c.receta.name}`);

    const ingredienteUrgente = c.productoPrioritario
      ? c.productoPrioritario.name
      : (c.ingredientesUrgentes[0] || c.receta.name);
    $('rd-elgourmet').href = 'https://www.google.com/search?q=' +
      encodeURIComponent(`site:elgourmet.com/recetas ${ingredienteUrgente}`);
    $('rd-elgourmet-txt').textContent = c.productoPrioritario || c.ingredientesUrgentes.length
      ? `Recetas con ${ingredienteUrgente.toLowerCase()} en elGourmet`
      : 'Más recetas en elGourmet';

    // Reset de tabs
    document.querySelectorAll('[data-rd-tab]').forEach((b) => b.classList.toggle('active', b.dataset.rdTab === 'ingredientes'));
    $('rd-ingredientes').hidden = false;
    $('rd-preparacion').hidden = true;

    ir('sc-receta');
    $('hdr-title').textContent = c.receta.name;
  }

  document.querySelectorAll('[data-rd-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const esIng = btn.dataset.rdTab === 'ingredientes';
      document.querySelectorAll('[data-rd-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      $('rd-ingredientes').hidden = !esIng;
      $('rd-preparacion').hidden = esIng;
    });
  });

  $('rd-cook').addEventListener('click', () => {
    if (!recetaAbierta) return;
    AgenteEvaluador.registrarDesenlace({ productId: null, recipeId: recetaAbierta.receta.id, outcome: 'cocinado' });
    toast('¡Buen provecho! Registrado como cocinado.');
    historial.pop();
    ir('sc-recetas', { push: false });
  });

  $('rd-dismiss').addEventListener('click', () => {
    if (!recetaAbierta) return;
    const descartada = recetaAbierta.receta;
    AgenteEvaluador.registrarDesenlace({ productId: null, recipeId: descartada.id, outcome: 'descartado' });

    // Descartar no es rendirse: el producto que motivó la sugerencia sigue en
    // la despensa y sigue por vencer. Antes el mensaje cerraba el tema ("no te
    // la vuelvo a sugerir") y la siguiente sugerencia podía ser de un producto
    // completamente distinto, así que rechazar un arroz con leche parecía
    // dejarte sin opciones para el arroz. Ahora se ofrece la salida concreta.
    let mensaje = 'Listo, no te la vuelvo a sugerir.';
    try {
      const alternativas = AgenteCocinero.alternativasA(descartada.id, AgenteVencimientos.analyze());
      if (alternativas.length) {
        mensaje = `Listo. Con lo mismo podés hacer: ${alternativas.map((a) => a.receta.name).join(' o ')}.`;
      }
    } catch (e) {
      console.warn('No se pudieron calcular alternativas', e);
    }

    toast(mensaje);
    historial.pop();
    ir('sc-recetas', { push: false });
  });

  /* =========================================================================
     9. CALENDARIO
     ========================================================================= */
  let calFecha = new Date();

  $('cal-prev').addEventListener('click', () => { calFecha.setMonth(calFecha.getMonth() - 1); renderCalendario(); });
  $('cal-next').addEventListener('click', () => { calFecha.setMonth(calFecha.getMonth() + 1); renderCalendario(); });

  function renderCalendario() {
    const anio = calFecha.getFullYear();
    const mes = calFecha.getMonth();
    $('cal-title').textContent = calFecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    const enriquecidos = AgenteVencimientos.analyze();
    // Mapa fecha -> urgencia más crítica de ese día
    const porFecha = {};
    enriquecidos.forEach((p) => {
      const prio = { vencido: 4, rojo: 3, amarillo: 2, verde: 1 };
      if (!porFecha[p.expiryDate] || prio[p.urgencia] > prio[porFecha[p.expiryDate]]) {
        porFecha[p.expiryDate] = p.urgencia;
      }
    });

    const primero = new Date(anio, mes, 1);
    // getDay(): 0=domingo. Convertimos a semana que arranca en lunes.
    const offset = (primero.getDay() + 6) % 7;
    const diasMes = new Date(anio, mes + 1, 0).getDate();
    const hoyISO = new Date();
    const hoyStr = `${hoyISO.getFullYear()}-${String(hoyISO.getMonth() + 1).padStart(2, '0')}-${String(hoyISO.getDate()).padStart(2, '0')}`;

    let celdas = '';
    for (let i = 0; i < offset; i++) celdas += `<div class="cal-cell otro"></div>`;
    for (let d = 1; d <= diasMes; d++) {
      const iso = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const urg = porFecha[iso];
      const esHoy = iso === hoyStr;
      celdas += `<div class="cal-cell ${esHoy ? 'hoy' : ''}">
        ${d}
        ${urg ? `<i class="cal-dot" style="background:var(--${urg === 'vencido' ? 'vencido' : urg})"></i>` : ''}
      </div>`;
    }
    $('cal-grid').innerHTML = celdas;

    // Próximos vencimientos (siempre desde hoy, sin importar el mes que se mire)
    const proximos = enriquecidos.filter((p) => p.daysRemaining >= 0).slice(0, 8);
    $('cal-list').innerHTML = proximos.length === 0
      ? `<div class="empty-state">No hay vencimientos próximos cargados.</div>`
      : proximos.map((p) => `
          <div class="prod-row" data-edit-cal="${p.id}">
            ${Ilustraciones.producto(p.category, 40)}
            <div class="prod-info">
              <div class="prod-name">${escapeHtml(p.name)}</div>
              <div class="prod-meta">${fechaLarga(p.expiryDate)}</div>
            </div>
            <span class="days-badge ${p.urgencia}">${textoDias(p)}</span>
          </div>`).join('');

    $('cal-list').querySelectorAll('[data-edit-cal]').forEach((row) => {
      row.addEventListener('click', () => abrirAgregar(row.dataset.editCal));
    });
  }

  /* =========================================================================
     10. ESTADÍSTICAS
     ========================================================================= */
  let rangoStat = 'mes';

  document.querySelectorAll('[data-stat-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rangoStat = btn.dataset.statRange;
      document.querySelectorAll('[data-stat-range]').forEach((b) => b.classList.toggle('active', b === btn));
      renderEstadisticas();
    });
  });

  function renderEstadisticas() {
    const m = MetricasImpacto.calcular();
    const dias = rangoStat === 'mes' ? 30 : 365;
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);

    // Desenlaces dentro del rango elegido
    const historialDesenlaces = DB.get('history', []).filter((h) => new Date(h.timestamp) >= desde);
    const rescatadosRango = historialDesenlaces.filter((h) => h.outcome === 'cocinado' && h.productId).length;
    const ahorroRango = rescatadosRango * m.valorReferencia;

    $('stat-ahorro').textContent = `$${ahorroRango.toLocaleString('es-AR')}`;
    $('stat-ahorro-sub').textContent = rangoStat === 'mes' ? 'Últimos 30 días' : 'Últimos 12 meses';
    $('stat-rescatados').textContent = rescatadosRango;
    $('stat-rescatados-sub').textContent = `${m.desperdiciados} desperdiciado(s) en total`;

    $('stat-bar').style.width = `${m.tasaAprovechamiento || 0}%`;
    $('stat-resumen').textContent = MetricasImpacto.resumen(m);

    // Sparkline: rescates acumulados por tramo del período
    const tramos = rangoStat === 'mes' ? 6 : 12;
    const largoTramo = dias / tramos;
    const serie = [];
    for (let i = tramos - 1; i >= 0; i--) {
      const fin = new Date(); fin.setDate(fin.getDate() - i * largoTramo);
      const ini = new Date(fin); ini.setDate(ini.getDate() - largoTramo);
      serie.push(historialDesenlaces.filter((h) => {
        const t = new Date(h.timestamp);
        return h.outcome === 'cocinado' && t > ini && t <= fin;
      }).length);
    }
    $('stat-spark').innerHTML = sparkline(serie);

    // Donut de categorías más usadas (sobre lo que salió de la despensa)
    const productos = AgenteInventario.getAll().filter((p) => p.status !== 'activo');
    const porCat = {};
    productos.forEach((p) => { porCat[p.category] = (porCat[p.category] || 0) + 1; });
    const total = Object.values(porCat).reduce((a, b) => a + b, 0);

    if (total === 0) {
      $('stat-donut').innerHTML = '';
      $('stat-legend').innerHTML = `<div class="empty-state" style="padding:10px">Todavía no hay datos suficientes. Marcá productos como consumidos o descartados.</div>`;
      return;
    }

    const orden = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let acumulado = 0;
    const radio = 38, circ = 2 * Math.PI * radio;
    const arcos = orden.map(([cat, n]) => {
      const frac = n / total;
      const color = Ilustraciones.colorDe(cat).trazo;
      const seg = `<circle cx="48" cy="48" r="${radio}" fill="none" stroke="${color}" stroke-width="14"
        stroke-dasharray="${(frac * circ).toFixed(2)} ${circ.toFixed(2)}"
        stroke-dashoffset="${(-acumulado * circ).toFixed(2)}" transform="rotate(-90 48 48)"/>`;
      acumulado += frac;
      return seg;
    }).join('');

    $('stat-donut').innerHTML = `<svg viewBox="0 0 96 96">${arcos}</svg>`;
    $('stat-legend').innerHTML = orden.map(([cat, n]) => `
      <div class="dl-row">
        <span class="dl-dot" style="background:${Ilustraciones.colorDe(cat).trazo}"></span>
        <span class="dl-name">${NOMBRE_CATEGORIA[cat] || cat}</span>
        <span class="dl-pct">${Math.round((n / total) * 100)}%</span>
      </div>`).join('');
  }

  function sparkline(serie) {
    const max = Math.max(...serie, 1);
    const ancho = 100, alto = 40;
    const paso = ancho / Math.max(serie.length - 1, 1);
    const puntos = serie.map((v, i) => `${(i * paso).toFixed(1)},${(alto - (v / max) * (alto - 6) - 3).toFixed(1)}`);
    return `<svg viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none">
      <polyline points="${puntos.join(' ')}" fill="none" stroke="var(--verde)" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round"/>
      <polygon points="0,${alto} ${puntos.join(' ')} ${ancho},${alto}" fill="var(--verde)" opacity="0.14"/>
    </svg>`;
  }

  /* =========================================================================
     HOGAR · quiénes comen acá
     ========================================================================= */
  function renderHogar() {
    const gente = AgenteHogar.comensales();
    const cont = $('hogar-lista');

    if (gente.length === 0) {
      cont.innerHTML = `<div class="empty-state"><span class="emoji">🍽️</span>
        Todavía no cargaste a nadie. Sin conocer a los comensales, el agente sólo puede usar tus preferencias generales.</div>`;
      return;
    }

    cont.innerHTML = gente.map((c) => {
      const tags = [
        ...c.alergias.map((a) => `<span class="tag alergia">alergia: ${escapeHtml(a)}</span>`),
        ...(c.condiciones || []).map((k) => `<span class="tag medica">${escapeHtml(AgenteHogar.CONDICIONES[k] ? AgenteHogar.CONDICIONES[k].etiqueta : k)}</span>`),
        ...(c.dietas || []).map((d) => `<span class="tag dieta">${escapeHtml(AgenteHogar.DIETAS[d] || d)}</span>`),
        ...c.gusta.slice(0, 3).map((g) => `<span class="tag gusto">♥ ${escapeHtml(g)}</span>`),
        ...c.noGusta.slice(0, 3).map((g) => `<span class="tag">✕ ${escapeHtml(g)}</span>`)
      ].join('');

      return `<div class="comensal-card" data-comensal="${c.id}" role="button" tabindex="0">
        <div class="cm-avatar">${escapeHtml(c.nombre.charAt(0).toUpperCase())}</div>
        <div class="cm-info">
          <div class="cm-nombre">${escapeHtml(c.nombre)}</div>
          <div class="cm-tags">${tags || '<span class="tag">sin restricciones</span>'}</div>
          ${c.notas ? `<div class="cm-notas">${escapeHtml(c.notas)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    cont.querySelectorAll('[data-comensal]').forEach((el) => {
      el.addEventListener('click', () => abrirComensal(el.dataset.comensal));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirComensal(el.dataset.comensal); }
      });
    });
  }

  function pintarOpcionesComensal() {
    $('cm-condiciones').innerHTML = Object.entries(AgenteHogar.CONDICIONES)
      .map(([k, v]) => `<label><input type="checkbox" data-cond="${k}" /> ${v.etiqueta}</label>`).join('');
    $('cm-dietas').innerHTML = Object.entries(AgenteHogar.DIETAS)
      .map(([k, v]) => `<label><input type="checkbox" data-dieta="${k}" /> ${v}</label>`).join('');
  }

  let comensalEditando = null;

  function abrirComensal(id = null) {
    comensalEditando = id;
    pintarOpcionesComensal();

    const c = id ? AgenteHogar.comensales().find((x) => x.id === id) : null;
    $('cm-id').value = id || '';
    $('cm-nombre').value = c ? c.nombre : '';
    $('cm-alergias').value = c ? c.alergias.join(', ') : '';
    $('cm-gusta').value = c ? c.gusta.join(', ') : '';
    $('cm-nogusta').value = c ? c.noGusta.join(', ') : '';
    $('cm-notas').value = c ? (c.notas || '') : '';
    document.querySelectorAll('[data-cond]').forEach((i) => {
      i.checked = !!(c && (c.condiciones || []).includes(i.dataset.cond));
    });
    document.querySelectorAll('[data-dieta]').forEach((i) => {
      i.checked = !!(c && (c.dietas || []).includes(i.dataset.dieta));
    });
    $('cm-delete').hidden = !id;

    ir('sc-comensal');
    $('hdr-title').textContent = c ? c.nombre : 'Nuevo comensal';
  }

  $('hogar-nuevo').addEventListener('click', () => abrirComensal());

  $('cm-save').addEventListener('click', () => {
    const datos = {
      nombre: $('cm-nombre').value,
      alergias: $('cm-alergias').value,
      gusta: $('cm-gusta').value,
      noGusta: $('cm-nogusta').value,
      notas: $('cm-notas').value,
      condiciones: [...document.querySelectorAll('[data-cond]')].filter((i) => i.checked).map((i) => i.dataset.cond),
      dietas: [...document.querySelectorAll('[data-dieta]')].filter((i) => i.checked).map((i) => i.dataset.dieta)
    };
    try {
      if (comensalEditando) {
        AgenteHogar.editar(comensalEditando, datos);
        toast('Comensal actualizado. Las sugerencias se ajustan desde ahora.');
      } else {
        AgenteHogar.agregar(datos);
        toast(`${datos.nombre} sumado al hogar. El cocinero ya lo tiene en cuenta.`);
      }
      const previa = historial.pop();
      ir(previa || 'sc-hogar', { push: false });
    } catch (e) {
      toast(e.message);
    }
  });

  $('cm-delete').addEventListener('click', () => {
    if (!comensalEditando) return;
    const c = AgenteHogar.comensales().find((x) => x.id === comensalEditando);
    if (!c || !confirm(`¿Eliminar a ${c.nombre} del hogar?`)) return;
    AgenteHogar.eliminar(comensalEditando);
    toast('Comensal eliminado.');
    const previa = historial.pop();
    ir(previa || 'sc-hogar', { push: false });
  });

  /* =========================================================================
     LISTA DE COMPRAS
     ========================================================================= */
  function renderCompras() {
    const enriquecidos = AgenteVencimientos.analyze();
    const comprar = AgenteCompras.queComprar(enriquecidos);
    const noComprar = AgenteCompras.queNoComprar(enriquecidos);

    const c1 = $('compras-comprar');
    c1.innerHTML = comprar.length === 0
      ? `<div class="empty-state">Nada urgente por comprar: con lo que tenés alcanza, o no hay productos en riesgo.</div>`
      : comprar.map((s) => `
          <div class="compra-item">
            <div class="compra-nombre">${escapeHtml(s.ingrediente)}</div>
            <div class="compra-motivo">${escapeHtml(s.motivo)}</div>
            ${s.rescata.length ? `<span class="compra-rescata">Rescata: ${s.rescata.map(escapeHtml).join(', ')}</span>` : ''}
            <div class="compra-acciones">
              <button class="btn btn-sm btn-secondary" data-comprado="${escapeHtml(s.ingrediente)}">Ya lo compré</button>
              <button class="btn btn-sm btn-outline" data-ignorar="${escapeHtml(s.ingrediente)}">No me interesa</button>
            </div>
          </div>`).join('');

    c1.querySelectorAll('[data-comprado]').forEach((b) => {
      b.addEventListener('click', () => {
        AgenteCompras.marcarComprado(b.dataset.comprado);
        toast(`Cargá "${b.dataset.comprado}" en tu despensa para que el sistema lo tenga en cuenta.`);
        $('f-name').value = b.dataset.comprado;
        abrirAgregar();
      });
    });
    c1.querySelectorAll('[data-ignorar]').forEach((b) => {
      b.addEventListener('click', () => {
        AgenteCompras.ignorar(b.dataset.ignorar);
        toast('Listo, no te lo sugiero más.');
        renderCompras();
      });
    });

    const c2 = $('compras-nocomprar');
    c2.innerHTML = noComprar.length === 0
      ? `<div class="empty-state">Sin advertencias por ahora.</div>`
      : noComprar.map((a) => `
          <div class="compra-item no">
            <div class="compra-nombre">${escapeHtml(a.ingrediente)}</div>
            <div class="compra-motivo">${escapeHtml(a.motivo)}</div>
          </div>`).join('');
  }

  /* =========================================================================
     11. PERFIL / MI INFORMACIÓN
     ========================================================================= */
  function renderPerfil() {
    const p = DB.get('profile', {});
    $('profile-name').textContent = p.name || 'Invitado';
    $('profile-email').textContent = p.email || 'Sin correo configurado';
    $('profile-avatar').textContent = (p.name || 'D').trim().charAt(0).toUpperCase();
  }

  function cargarPerfilForm() {
    const p = DB.get('profile', {});
    $('pf-name').value = p.name || '';
    $('pf-email').value = p.email || '';
  }

  $('pf-save').addEventListener('click', () => {
    DB.set('profile', { name: $('pf-name').value.trim(), email: $('pf-email').value.trim() });
    toast('Datos guardados en este dispositivo.');
    renderPerfil();
    const previa = historial.pop();
    ir(previa || 'sc-perfil', { push: false });
  });

  /* =========================================================================
     12. CONFIGURACIÓN
     ========================================================================= */
  function cargarConfigForm() {
    const prefs = DB.get('preferences', {});
    $('cfg-alerts').checked = prefs.notificaciones !== false;
    const umbral = (prefs.alertThresholds && prefs.alertThresholds.default && prefs.alertThresholds.default.yellow) || 3;
    $('cfg-days').value = [1, 2, 3, 5, 7, 10].includes(umbral) ? umbral : 3;
    $('cfg-maxsug').value = prefs.maxSuggestions || 3;
    aplicarTema(prefTema);
    renderEstadoNotificaciones();
  }

  // Explica con claridad cuándo va a llegar la próxima alerta: una app que
  // notifica sin que se entienda por qué termina siendo silenciada.
  function renderEstadoNotificaciones() {
    const prefs = DB.get('preferences', {});
    const estado = DB.get('notificationState', {});
    const el = $('cfg-notif-estado');

    if (prefs.notificaciones === false) {
      el.textContent = 'Las alertas están desactivadas. La app igual sigue analizando tu despensa y podés verlo en la pestaña Alertas.';
      return;
    }
    if (typeof Notification === 'undefined') {
      el.textContent = 'Este navegador no admite notificaciones. Las alertas se ven igual dentro de la app.';
      return;
    }
    if (Notification.permission === 'denied') {
      el.textContent = 'Bloqueaste las notificaciones en el navegador. Habilitalas desde la configuración del sitio si querés recibirlas.';
      return;
    }
    if (Notification.permission !== 'granted') {
      el.textContent = 'Todavía no diste permiso para notificaciones. Tocá el interruptor para pedirlo.';
      return;
    }
    el.textContent = estado.ultimaFecha === Orquestador.hoyISO()
      ? 'Ya te avisamos hoy. Se envía una sola alerta por día para no saturarte; la próxima será mañana.'
      : 'Se envía como máximo una alerta por día, cuando haya productos críticos.';
  }

  $('cfg-test-notif').addEventListener('click', () => {
    const r = Orquestador.forzarNotificacionDePrueba();
    if (!r.ok) toast('Primero activá las alertas y aceptá el permiso del navegador.');
    else toast('Alerta de prueba enviada. No cuenta para el límite diario.');
  });

  $('cfg-alerts').addEventListener('change', (e) => {
    const prefs = DB.get('preferences', {});
    DB.set('preferences', { ...prefs, notificaciones: e.target.checked });
    if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(renderEstadoNotificaciones);
    }
    toast(e.target.checked ? 'Alertas activadas: una por día como máximo.' : 'Alertas desactivadas.');
    renderEstadoNotificaciones();
  });

  $('cfg-days').addEventListener('change', (e) => {
    const prefs = DB.get('preferences', {});
    const yellow = Number(e.target.value);
    // lockedByUser: el Agente de Aprendizaje respeta lo que el usuario fijó
    DB.set('preferences', {
      ...prefs,
      alertThresholds: { ...(prefs.alertThresholds || {}), default: { yellow, red: 1, lockedByUser: true } }
    });
    toast(`Te aviso ${yellow} día(s) antes. El aprendizaje ya no pisa este valor.`);
    Orquestador.runCycle('umbral configurado');
  });

  $('cfg-maxsug').addEventListener('change', (e) => {
    const prefs = DB.get('preferences', {});
    DB.set('preferences', { ...prefs, maxSuggestions: Number(e.target.value) });
    toast('Cantidad de sugerencias actualizada.');
    Orquestador.runCycle('preferencias actualizadas');
  });

  // --- Copia de seguridad ---
  $('data-export').addEventListener('click', () => {
    const blob = new Blob([DB.exportAll()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `despensa-inteligente-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Copia exportada. Guardala en un lugar seguro.');
  });

  $('data-import').addEventListener('click', () => $('data-import-file').click());

  $('data-import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (!confirm('Importar reemplaza todo el inventario e historial actual. ¿Continuar?')) return;
        const res = DB.importAll(reader.result);
        toast(`Importados ${res.productos} producto(s) y ${res.desenlaces} desenlace(s).`);
        Orquestador.runCycle('datos importados');
        renderPerfil();
      } catch (err) {
        toast(err.message);
      } finally { e.target.value = ''; }
    };
    reader.readAsText(file);
  });

  /* =========================================================================
     PREFERENCIAS / HISTORIAL / SISTEMA
     ========================================================================= */
  function renderPreferencias() {
    const prefs = DB.get('preferences', {});
    $('pref-allergies').value = (prefs.allergies || []).join(', ');
    $('pref-vegetariano').checked = (prefs.dietary || []).includes('vegetariano');
    $('pref-vegano').checked = (prefs.dietary || []).includes('vegano');
    $('pref-sintacc').checked = (prefs.dietary || []).includes('sin_tacc');

    // Umbrales: muestra cuáles fijó el usuario y cuáles aprendió el sistema
    const th = prefs.alertThresholds || {};
    const def = th.default || { yellow: 3 };
    const porCat = Object.entries(th).filter(([c]) => c !== 'default');
    $('pref-thresholds').innerHTML = `
      <div class="list-row">
        <div class="lr-info">
          <div class="lr-title">General (por defecto)</div>
          <div class="lr-sub">avisa ${def.yellow} día(s) antes</div>
        </div>
        <span class="badge ${def.lockedByUser ? 'verde' : 'amarillo'}">${def.lockedByUser ? 'fijado por vos' : 'automático'}</span>
      </div>` +
      (porCat.length === 0
        ? `<div class="empty-state" style="padding:14px">Todavía no hay umbrales por categoría. Se crean cuando el sistema detecta tu ritmo de consumo.</div>`
        : porCat.map(([cat, v]) => `
            <div class="list-row">
              <div class="lr-info">
                <div class="lr-title">${NOMBRE_CATEGORIA[cat] || escapeHtml(cat)}</div>
                <div class="lr-sub">avisa ${v.yellow} día(s) antes</div>
              </div>
              <span class="badge ${v.lockedByUser ? 'verde' : 'amarillo'}">${v.lockedByUser ? 'fijado por vos' : 'aprendido'}</span>
            </div>`).join(''));

    renderRecetasDescartadas();
    renderEstiloPreferido();
    renderEstiloAprendido();
    renderGeneradorConfig();

    const avoided = Object.entries(prefs.avoidedIngredients || {}).filter(([, n]) => n > 0);
    $('pref-avoided').innerHTML = avoided.length === 0
      ? `<div class="empty-state">Todavía no hay ingredientes evitados. Se completa cuando descartás recetas repetidamente.</div>`
      : avoided.map(([ing, n]) => `
          <div class="list-row">
            <div class="lr-info"><div class="lr-title" style="text-transform:capitalize">${escapeHtml(ing)}</div></div>
            <span class="badge rojo">rechazado x${n}</span>
          </div>`).join('');
  }

  function renderRecetasDescartadas() {
    const descartadas = AgenteCocinero.listarDescartadas();
    const cont = $('pref-dismissed');
    cont.innerHTML = descartadas.length === 0
      ? `<div class="empty-state">No descartaste ninguna receta.</div>`
      : descartadas.map((d) => `
          <div class="list-row">
            <div class="lr-info">
              <div class="lr-title">${escapeHtml(d.receta.name)}</div>
              <div class="lr-sub">descartada el ${new Date(d.timestamp).toLocaleDateString('es-AR')}</div>
            </div>
            <button class="btn btn-sm btn-secondary" data-restore="${d.recipeId}">Restaurar</button>
          </div>`).join('');

    cont.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', () => {
        DB.set('dismissedRecipes', DB.get('dismissedRecipes', []).filter((d) => d.recipeId !== btn.dataset.restore));
        toast('Receta restaurada.');
        Orquestador.runCycle('receta restaurada');
        renderRecetasDescartadas();
      });
    });
  }

  /* ---- Estilo de cocina: preferencia declarada + lo aprendido ----------
     Las dos fuentes conviven a propósito. La declarada resuelve el arranque
     en frío (el agente todavía no vio cocinar nada); la aprendida corrige,
     porque lo que la gente declara y lo que efectivamente cocina no siempre
     coinciden. Mostrar las dos por separado le deja claro al usuario qué
     dedujo el sistema por su cuenta, en vez de que el orden cambie solo sin
     explicación.
     -------------------------------------------------------------------- */
  const ETIQUETAS_COCINA = {
    italiana: 'Italiana', criolla: 'Criolla', espanola: 'Española',
    asiatica: 'Asiática', mediterranea: 'Mediterránea', internacional: 'Sin filiación'
  };
  const ETIQUETAS_ESTILO = {
    express: 'Rápido (hasta 10 min)', casera: 'Casero (15 a 30 min)', elaborada: 'Elaborado (40 min o más)'
  };

  function renderEstiloPreferido() {
    const prefs = DB.get('preferences', {});
    const elegidos = prefs.estilosPreferidos || {};
    const pinta = (contId, etiquetas, dim) => {
      const cont = find(contId);
      if (!cont) return;
      cont.innerHTML = Object.entries(etiquetas).map(([valor, texto]) => {
        const marcado = (elegidos[dim] || []).includes(valor) ? ' checked' : '';
        return `<label><input type="checkbox" data-estilo-dim="${dim}" value="${valor}"${marcado} /> ${texto}</label>`;
      }).join('');
    };
    pinta('pref-cocinas', ETIQUETAS_COCINA, 'cocina');
    pinta('pref-estilos', ETIQUETAS_ESTILO, 'estilo');
  }

  function renderEstiloAprendido() {
    const cont = find('pref-estilo-aprendido');
    if (!cont) return;
    const perfil = DB.get('stylePreferences', null);
    const etiquetas = { ...ETIQUETAS_COCINA, ...ETIQUETAS_ESTILO,
      principal: 'Plato principal', entrada: 'Entrada', postre: 'Postre',
      desayuno: 'Desayuno', guarnicion: 'Guarnición' };

    const filas = [];
    ['cocina', 'estilo', 'tipo'].forEach((dim) => {
      Object.entries((perfil && perfil[dim]) || {})
        .filter(([, n]) => n !== 0)
        .sort((a, b) => b[1] - a[1])
        .forEach(([valor, n]) => filas.push({ valor, n }));
    });

    if (!filas.length) {
      cont.innerHTML = `<div class="empty-state">Todavía no cocinaste ni descartaste lo suficiente como para que el agente deduzca un gusto.</div>`;
      return;
    }
    cont.innerHTML = filas.map(({ valor, n }) => `
      <div class="list-row">
        <div class="lr-info"><div class="lr-title">${escapeHtml(etiquetas[valor] || valor)}</div></div>
        <span class="badge ${n > 0 ? 'verde' : 'rojo'}">${n > 0 ? '+' : ''}${n}</span>
      </div>`).join('');
  }

  const btnEstilo = find('pref-save-estilo');
  if (btnEstilo) {
    btnEstilo.addEventListener('click', () => {
      const elegidos = { cocina: [], estilo: [] };
      document.querySelectorAll('[data-estilo-dim]').forEach((chk) => {
        if (chk.checked) elegidos[chk.dataset.estiloDim].push(chk.value);
      });
      DB.set('preferences', { ...DB.get('preferences', {}), estilosPreferidos: elegidos });
      AgenteAprendizaje.actualizarEstiloPreferido();
      toast('Estilo guardado. Lo uso para ordenar, nunca para tapar lo que vence.');
      renderEstiloAprendido();
      Orquestador.runCycle('estilo actualizado');
    });
  }

  /* ---- Generación de recetas con modelo -------------------------------
     La app NO depende de esto: si el motor está desactivado o no responde,
     el recetario local sigue funcionando igual. Por eso todo acá está detrás
     de un botón explícito y nunca se llama solo durante el ciclo.
     -------------------------------------------------------------------- */
  function renderGeneradorConfig() {
    const c = AgenteGenerador.leerConfig();
    if (find('gen-motor')) $('gen-motor').value = c.motor;
    if (find('gen-url')) $('gen-url').value = c.url;
    if (find('gen-modelo')) $('gen-modelo').value = c.modelo;
  }

  const btnGenGuardar = find('gen-guardar');
  if (btnGenGuardar) {
    btnGenGuardar.addEventListener('click', () => {
      AgenteGenerador.configurar({
        motor: $('gen-motor').value,
        url: $('gen-url').value.trim() || 'http://localhost:11434',
        modelo: $('gen-modelo').value.trim() || 'llama3.2'
      });
      toast('Configuración guardada.');
    });
  }

  const btnGenCrear = find('gen-crear');
  if (btnGenCrear) {
    btnGenCrear.addEventListener('click', async () => {
      const estado = $('gen-estado');
      const salida = $('gen-resultado');
      salida.innerHTML = '';

      if (!AgenteGenerador.disponible()) {
        estado.innerHTML = `<div class="empty-state">La generación está desactivada. Activala en Preferencias → Generación de recetas con IA.</div>`;
        return;
      }

      estado.innerHTML = `<div class="empty-state">Pensando una receta con lo que tenés…</div>`;
      try {
        const res = await AgenteGenerador.generar(AgenteVencimientos.analyze());

        if (!res.recetas.length) {
          // Se muestra POR QUÉ se rechazó, no un "no se pudo" opaco: que el
          // filtro haya actuado es información útil, no un error a esconder.
          const motivos = (res.rechazadas || []).map((r) => r.motivo).filter(Boolean);
          estado.innerHTML = `<div class="empty-state">No salió ninguna receta que pase los controles.${
            motivos.length ? ` Motivo: ${escapeHtml(motivos[0])}.` : ''}</div>`;
          return;
        }

        estado.innerHTML = '';
        salida.innerHTML = res.recetas.map((r) => `
          <div class="list-row" style="align-items:flex-start">
            <div class="lr-info">
              <div class="lr-title">${escapeHtml(r.name)}</div>
              <div class="lr-sub">${r.cookTimeMin} min · ${r.servings} porciones · usa ${escapeHtml(r.ingredients.join(', '))}</div>
            </div>
            <span class="badge verde">inventada</span>
          </div>
          <ol class="recipe-steps">${r.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        `).join('');

        if (res.rechazadas && res.rechazadas.length) {
          const m = res.rechazadas.map((r) => escapeHtml(r.motivo)).join('; ');
          salida.innerHTML += `<p class="hint-text" style="text-align:left">Se descartaron ${res.rechazadas.length} propuesta(s) del modelo: ${m}.</p>`;
        }
      } catch (e) {
        // Mixed content es el fallo más probable: una página servida por HTTPS
        // no puede llamar a http://localhost. Conviene decirlo en criollo.
        estado.innerHTML = `<div class="empty-state">No se pudo hablar con el modelo (${escapeHtml(e.message || String(e))}). Si la app está abierta por HTTPS, el navegador bloquea las llamadas a localhost: probala desde localhost.</div>`;
      }
    });
  }

  $('pref-save').addEventListener('click', () => {
    const prefs = DB.get('preferences', {});
    const dietary = [];
    if ($('pref-vegetariano').checked) dietary.push('vegetariano');
    if ($('pref-vegano').checked) dietary.push('vegano');
    if ($('pref-sintacc').checked) dietary.push('sin_tacc');
    DB.set('preferences', {
      ...prefs,
      allergies: $('pref-allergies').value.split(',').map((s) => s.trim()).filter(Boolean),
      dietary
    });
    toast('Preferencias guardadas. Se aplican desde el próximo ciclo.');
    Orquestador.runCycle('preferencias actualizadas');
    renderPreferencias();
  });

  $('pref-restore-recipes').addEventListener('click', () => {
    AgenteCocinero.restaurarDescartadas();
    toast('Todas las recetas vuelven a estar disponibles.');
    Orquestador.runCycle('recetas restauradas');
    renderRecetasDescartadas();
  });

  function renderHistorial() {
    const patrones = DB.get('consumptionPatterns', {});
    const entradas = Object.entries(patrones);
    $('patrones-consumo').innerHTML = entradas.length === 0
      ? `<div class="empty-state">Aún no hay datos de consumo. Marcá productos como consumidos para que el sistema aprenda tu ritmo.</div>`
      : entradas.map(([cat, info]) => `
          <div class="list-row">
            <div class="lr-info">
              <div class="lr-title">${NOMBRE_CATEGORIA[cat] || escapeHtml(cat)}</div>
              <div class="lr-sub">${info.muestras} muestra(s)</div>
            </div>
            <span class="badge verde">${info.promedioDias} días prom.</span>
          </div>`).join('');

    const hist = DB.get('history', []).slice().reverse().slice(0, 30);
    $('historial-list').innerHTML = hist.length === 0
      ? `<div class="empty-state">Todavía no se registraron desenlaces.</div>`
      : hist.map((h) => {
          const receta = h.recipeId ? RECIPES.find((r) => r.id === h.recipeId) : null;
          const producto = h.productId ? AgenteInventario.getById(h.productId) : null;
          const nombre = producto ? producto.name : (receta ? receta.name : 'Item');
          return `<div class="list-row">
            <div class="lr-info">
              <div class="lr-title">${h.outcome === 'cocinado' ? '✅' : '❌'} ${escapeHtml(nombre)}</div>
              <div class="lr-sub">${new Date(h.timestamp).toLocaleString('es-AR')}</div>
            </div>
            <span class="badge ${h.outcome === 'cocinado' ? 'verde' : 'rojo'}">${h.outcome}</span>
          </div>`;
        }).join('');
  }

  function renderSystemLog() {
    const log = DB.get('systemLog', []).slice().reverse().slice(0, 60);
    $('system-log').innerHTML = log.length === 0
      ? `<div class="empty-state">El ciclo aún no se ejecutó.</div>`
      : log.map((e) => `
          <div class="log-entry">
            <span class="paso">${escapeHtml(e.paso)}</span> — ${escapeHtml(e.detalle)}
            <div class="ts">${new Date(e.timestamp).toLocaleTimeString('es-AR')}</div>
          </div>`).join('');
  }

  /* =========================================================================
     CHATBOT (Agente Conversacional)
     ========================================================================= */
  const chatDrawer = $('chat-drawer-overlay');
  const chatWindow = $('chat-window');

  function appendMsg(texto, quien) {
    const div = document.createElement('div');
    div.className = `msg ${quien}`;
    div.textContent = texto;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  $('chat-fab').addEventListener('click', () => {
    chatDrawer.classList.add('open');
    setTimeout(() => $('chat-input').focus(), 250);
  });
  $('chat-drawer-close').addEventListener('click', () => chatDrawer.classList.remove('open'));
  chatDrawer.addEventListener('click', (e) => { if (e.target === chatDrawer) chatDrawer.classList.remove('open'); });

  $('chat-send').addEventListener('click', enviarChat);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarChat(); });

  function enviarChat() {
    const input = $('chat-input');
    const texto = input.value.trim();
    if (!texto) return;
    appendMsg(texto, 'user');
    input.value = '';

    const r = AgenteConversacional.interpretar(texto);
    if (r.tipo === 'consulta') appendMsg(r.respuesta, 'bot');
    else if (r.tipo === 'carga') {
      try {
        const p = AgenteCaptura.procesarManual({ ...r.producto });
        appendMsg(`Listo, agregué "${p.name}" (vence ${fmtFecha(p.expiryDate)}) al inventario.`, 'bot');
      } catch (e) {
        appendMsg(`No pude cargarlo: ${e.message}`, 'bot');
      }
    } else appendMsg(r.mensaje, 'bot');
  }

  /* =========================================================================
     ARRANQUE
     ========================================================================= */
  // Tras cada ciclo del orquestador se refresca la pantalla visible.
  Orquestador.onCycleComplete(() => {
    if (pantallaActual === 'sc-inicio') renderDashboard();
    if (pantallaActual === 'sc-productos') renderProductos();
    if (pantallaActual === 'sc-alertas') renderAlertas();
    if (pantallaActual === 'sc-recetas') renderRecetas();
    if (pantallaActual === 'sc-calendario') renderCalendario();
    if (pantallaActual === 'sc-estadisticas') renderEstadisticas();
    if (pantallaActual === 'sc-sistema') renderSystemLog();
    if (pantallaActual === 'sc-historial') renderHistorial();
  });

  function arrancarApp() {
    const ciclo = Orquestador.runCycle('carga de la app');

    // Accesos directos del sistema operativo (mantener presionado el ícono
    // de la app). Vienen como ?accion=… desde el manifest.
    let accion = null;
    try {
      accion = new URLSearchParams(window.location.search).get('accion');
    } catch (e) { /* entorno sin location: se ignora y abre el inicio */ }
    const destinos = { agregar: 'sc-agregar', alertas: 'sc-alertas', recetas: 'sc-recetas' };
    if (accion === 'agregar') abrirAgregar();
    else if (destinos[accion]) ir(destinos[accion], { push: false });
    else ir('sc-inicio', { push: false });

    // El permiso de notificaciones se pide en contexto: sólo cuando realmente
    // hay algo urgente que avisar, no apenas abre la app. Pedirlo "en frío"
    // hace que la mayoría lo rechace y después la alerta nunca llega.
    const prefs = DB.get('preferences', {});
    const criticos = ciclo.riesgo.filter((p) => p.urgencia === 'rojo' || p.urgencia === 'vencido');
    if (prefs.notificaciones !== false && criticos.length > 0 &&
        typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(() => Orquestador.runCycle('permiso de notificaciones'));
    }

    // El ciclo sigue corriendo cada minuto para mantener el análisis al día.
    // Eso NO implica notificar: la notificación tiene su propio límite diario.
    setInterval(() => Orquestador.runCycle('chequeo periódico'), 60000);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
