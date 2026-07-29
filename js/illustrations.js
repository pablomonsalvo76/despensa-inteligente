/**
 * illustrations.js — Sistema visual de ilustraciones
 * -----------------------------------------------------------------------
 * La app debe funcionar sin conexión (Sección 8: la fricción de carga es el
 * principal freno). Por eso NO se usan fotos remotas: todas las imágenes son
 * SVG en línea, generadas acá. Pesan poco, se adaptan al tema claro/oscuro
 * mediante currentColor y nunca fallan por falta de red.
 */

const Ilustraciones = (() => {
  // Paleta por categoría: da identidad visual a cada tipo de alimento.
  const COLORES_CATEGORIA = {
    lacteos:   { fondo: '#eef4ff', trazo: '#3f7fd4' },
    verduras:  { fondo: '#e8f6e9', trazo: '#3d8f4e' },
    frutas:    { fondo: '#fff1e3', trazo: '#e2792f' },
    carnes:    { fondo: '#fdeaea', trazo: '#c74a4a' },
    cereales:  { fondo: '#fbf3e0', trazo: '#b98a2e' },
    huevos:    { fondo: '#fff8e2', trazo: '#c9a227' },
    conservas: { fondo: '#f0eefb', trazo: '#6b5bbd' },
    bebidas:   { fondo: '#e6f5f7', trazo: '#2f8f9e' },
    otros:     { fondo: '#eef1ee', trazo: '#6b7a6e' }
  };

  // Íconos vectoriales por categoría, dibujados a mano sobre un viewBox 32x32.
  const FORMAS = {
    // Botella de leche
    lacteos: '<path d="M13 4h6v3l2 4v17a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V11l2-4V4Z"/><path d="M11 15h10"/>',
    // Zanahoria con hojas
    verduras: '<path d="M16 12c4 0 7 3 7 6l-6 11a1 1 0 0 1-2 0L9 18c0-3 3-6 7-6Z"/><path d="M16 12V7"/><path d="M16 8c-2-3-5-3-6-2 1 2 4 3 6 2Z"/><path d="M16 8c2-3 5-3 6-2-1 2-4 3-6 2Z"/>',
    // Manzana con hoja
    frutas: '<path d="M16 11c-5-3-11 1-11 8s5 12 8 12c1.5 0 2-.7 3-.7s1.5.7 3 .7c3 0 8-5 8-12s-6-11-11-8Z"/><path d="M16 11V6"/><path d="M16 7c2-2 5-2 6-1-1 2-4 3-6 1Z"/>',
    // Corte de carne
    carnes: '<path d="M7 14c0-5 5-9 11-9s10 3 10 8-4 8-9 8c-3 0-4 3-7 3s-5-2-5-5 0-3 0-5Z"/><circle cx="11" cy="19" r="2.5"/>',
    // Espiga de trigo
    cereales: '<path d="M16 29V11"/><path d="M16 11c-3-1-5-3-5-6 3 0 5 2 5 6Z"/><path d="M16 11c3-1 5-3 5-6-3 0-5 2-5 6Z"/><path d="M16 17c-3-1-5-3-5-6 3 0 5 2 5 6Z"/><path d="M16 17c3-1 5-3 5-6-3 0-5 2-5 6Z"/><path d="M16 23c-3-1-5-3-5-6 3 0 5 2 5 6Z"/><path d="M16 23c3-1 5-3 5-6-3 0-5 2-5 6Z"/>',
    // Huevo
    huevos: '<path d="M16 4c5 0 9 8 9 14a9 9 0 0 1-18 0c0-6 4-14 9-14Z"/>',
    // Lata de conserva
    conservas: '<rect x="8" y="7" width="16" height="21" rx="2"/><path d="M8 12h16"/><path d="M8 23h16"/><path d="M13 16h6"/>',
    // Vaso con bebida
    bebidas: '<path d="M9 6h14l-2 22a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2L9 6Z"/><path d="M10 14h12"/>',
    // Bolsa genérica
    otros: '<path d="M8 11h16l-1.5 18a2 2 0 0 1-2 2H11.5a2 2 0 0 1-2-2L8 11Z"/><path d="M12 11V8a4 4 0 0 1 8 0v3"/>'
  };

  function colorDe(categoria) {
    return COLORES_CATEGORIA[categoria] || COLORES_CATEGORIA.otros;
  }

  /**
   * Miniatura de producto: cuadrado redondeado con el ícono de su categoría.
   * @param {string} categoria
   * @param {number} tamano  px del lado
   */
  function producto(categoria, tamano = 44) {
    const c = colorDe(categoria);
    const forma = FORMAS[categoria] || FORMAS.otros;
    return `<svg class="ilu-producto" width="${tamano}" height="${tamano}" viewBox="0 0 32 32"
      style="background:${c.fondo};border-radius:${Math.round(tamano * 0.28)}px"
      fill="none" stroke="${c.trazo}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">${forma}</svg>`;
  }

  // Sólo el trazo del ícono, para usar dentro de chips y filtros.
  function iconoCategoria(categoria, tamano = 18) {
    const c = colorDe(categoria);
    const forma = FORMAS[categoria] || FORMAS.otros;
    return `<svg width="${tamano}" height="${tamano}" viewBox="0 0 32 32" fill="none"
      stroke="${c.trazo}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">${forma}</svg>`;
  }

  /**
   * Ilustración de receta: un "plato" generado a partir del id de la receta,
   * de modo que cada receta tenga siempre la misma imagen (determinista) pero
   * el conjunto se vea variado.
   */
  const PALETAS_PLATO = [
    ['#f5b53d', '#e2792f', '#fdf0da'],
    ['#7cb342', '#3d8f4e', '#eaf5e4'],
    ['#e0543f', '#b8392c', '#fbe6e2'],
    ['#e8b84b', '#c98f2b', '#fcf3df'],
    ['#69a9c7', '#3f7fd4', '#e7f1fb'],
    ['#a97fd4', '#6b5bbd', '#f0eafb']
  ];

  function paletaDe(id) {
    let suma = 0;
    for (let i = 0; i < id.length; i++) suma += id.charCodeAt(i);
    return PALETAS_PLATO[suma % PALETAS_PLATO.length];
  }

  /**
   * Hero de receta: plato visto desde arriba, con ingredientes esparcidos.
   * @param {string} id     id de la receta (define la paleta)
   * @param {string} alto   alto CSS del contenedor
   */
  function receta(id, alto = '150px') {
    const [claro, oscuro, fondo] = paletaDe(id);
    // Posiciones deterministas de los "ingredientes" sobre el plato
    let semilla = 0;
    for (let i = 0; i < id.length; i++) semilla += id.charCodeAt(i) * (i + 3);
    const puntos = [];
    for (let i = 0; i < 7; i++) {
      const ang = ((semilla * (i + 1)) % 360) * (Math.PI / 180);
      const rad = 12 + ((semilla * (i + 2)) % 16);
      puntos.push({
        x: 60 + Math.cos(ang) * rad,
        y: 42 + Math.sin(ang) * rad * 0.62,
        r: 3 + ((semilla + i * 5) % 4)
      });
    }

    return `<svg class="ilu-receta" viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice"
      style="height:${alto};width:100%;background:${fondo}" aria-hidden="true">
      <circle cx="60" cy="42" r="34" fill="#ffffff" opacity="0.85"/>
      <circle cx="60" cy="42" r="27" fill="${claro}" opacity="0.35"/>
      ${puntos.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r}" fill="${oscuro}" opacity="0.7"/>`).join('')}
      <circle cx="60" cy="42" r="34" fill="none" stroke="${oscuro}" stroke-width="1.5" opacity="0.5"/>
      <path d="M14 74c14-6 28-8 46-8s32 2 46 8" fill="none" stroke="${oscuro}" stroke-width="1.2" opacity="0.25"/>
    </svg>`;
  }

  // Ilustración del splash / onboarding: frasco de despensa con hoja.
  function marca(tamano = 96) {
    return `<svg width="${tamano}" height="${tamano}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="18" y="8" width="28" height="8" rx="3" stroke="currentColor" stroke-width="3"/>
      <path d="M20 16h24v36a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V16Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <path d="M32 46V33" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <path d="M32 34c0-6 4-10 9-10 0 6-4 10-9 10Z" fill="currentColor" opacity="0.85"/>
      <path d="M32 38c0-5-3-8-7-8 0 5 3 8 7 8Z" fill="currentColor" opacity="0.55"/>
    </svg>`;
  }

  // Ilustración del onboarding: bolsa con alimentos y alertas.
  function onboarding(paso) {
    if (paso === 0) {
      return `<svg viewBox="0 0 120 110" width="200" height="184" fill="none" aria-hidden="true">
        <path d="M30 42h60l-6 56a8 8 0 0 1-8 7H44a8 8 0 0 1-8-7l-6-56Z" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="3" stroke-linejoin="round"/>
        <path d="M45 42V30a15 15 0 0 1 30 0v12" stroke="var(--primary)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="50" cy="66" r="9" fill="var(--accent)" opacity="0.9"/>
        <path d="M70 58c6 0 10 4 10 9l-8 14-8-14c0-5 4-9 6-9Z" fill="var(--verde)" opacity="0.85"/>
        <circle cx="26" cy="24" r="11" fill="var(--amarillo-bg)" stroke="var(--amarillo)" stroke-width="2.5"/>
        <path d="M22 24a4 4 0 0 1 8 0c0 3 1 4 1.5 4.5h-11c.5-.5 1.5-1.5 1.5-4.5Z" fill="var(--amarillo)"/>
        <circle cx="96" cy="30" r="12" fill="var(--verde-bg)" stroke="var(--verde)" stroke-width="2.5"/>
        <path d="M96 36c0-6 4-9 9-9 0 6-4 9-9 9Z" fill="var(--verde)"/>
      </svg>`;
    }
    if (paso === 1) {
      return `<svg viewBox="0 0 120 110" width="200" height="184" fill="none" aria-hidden="true">
        <rect x="18" y="18" width="84" height="74" rx="12" fill="var(--surface-alt)" stroke="var(--primary)" stroke-width="3"/>
        <path d="M18 38h84" stroke="var(--primary)" stroke-width="3"/>
        <circle cx="30" cy="28" r="3" fill="var(--rojo)"/>
        <circle cx="41" cy="28" r="3" fill="var(--amarillo)"/>
        <circle cx="52" cy="28" r="3" fill="var(--verde)"/>
        <rect x="30" y="50" width="34" height="6" rx="3" fill="var(--rojo)" opacity="0.75"/>
        <rect x="30" y="64" width="52" height="6" rx="3" fill="var(--amarillo)" opacity="0.75"/>
        <rect x="30" y="78" width="26" height="6" rx="3" fill="var(--verde)" opacity="0.75"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 120 110" width="200" height="184" fill="none" aria-hidden="true">
      <circle cx="60" cy="56" r="34" fill="var(--surface-alt)" stroke="var(--primary)" stroke-width="3"/>
      <circle cx="60" cy="56" r="22" fill="var(--primary-soft)"/>
      <circle cx="52" cy="50" r="5" fill="var(--accent)"/>
      <circle cx="68" cy="58" r="6" fill="var(--verde)"/>
      <circle cx="58" cy="66" r="4" fill="var(--amarillo)"/>
      <path d="M96 26l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" fill="var(--accent)"/>
      <path d="M20 76l3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z" fill="var(--primary)" opacity="0.7"/>
    </svg>`;
  }

  return { producto, iconoCategoria, receta, marca, onboarding, colorDe, COLORES_CATEGORIA };
})();
