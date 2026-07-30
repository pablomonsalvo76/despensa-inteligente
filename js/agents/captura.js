/**
 * Agente de Captura (Sección 3 y 4)
 * -----------------------------------------------------------------------
 * "Procesa las formas de ingreso directas (escaneo, foto e ingreso
 *  manual) y recibe del agente conversacional los productos interpretados
 *  desde lenguaje natural. Frente a un escaneo, resuelve la identidad del
 *  producto; frente a una foto, ejecuta el OCR de la fecha y el lote;
 *  frente a una carga manual, valida los datos. Normaliza todo a un
 *  formato común y se lo entrega al inventario."
 *
 * Nota de diseño (documento, Sección 3): el código de barras (EAN-13/UPC)
 * sólo identifica el producto (GTIN); la fecha de vencimiento se obtiene
 * por OCR o ingreso manual. Por eso el flujo de escaneo, tras resolver el
 * producto, siempre pide la fecha (por foto+OCR o manualmente).
 */

const AgenteCaptura = (() => {
  // ---- Vida útil estimada por categoría (arranque en frío, Sección 6) ----
  // "Al inicio, sin historial suficiente, el sistema opera con valores por
  //  defecto —vencimientos estimados según la categoría del producto—".
  // Permite proponer una fecha tentativa cuando el usuario no la sabe.
  const VIDA_UTIL_DIAS = {
    lacteos: 7, verduras: 7, frutas: 7, carnes: 3,
    cereales: 180, huevos: 21, otros: 30
  };

  function estimarVencimiento(categoria) {
    const dias = VIDA_UTIL_DIAS[categoria] ?? VIDA_UTIL_DIAS.otros;
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return { fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dias };
  }

  // ---- Cache local de productos resueltos (fallback sin conexión) ----
  // Un escaneo que falla por falta de red es fricción de carga, y la carga
  // incompleta del inventario es el principal freno del sistema (Sección 8).
  // Por eso todo GTIN resuelto se guarda para futuras lecturas offline.
  function leerCacheGTIN() {
    return DB.get('gtinCache', {});
  }

  function guardarEnCacheGTIN(gtin, info) {
    const cache = leerCacheGTIN();
    cache[gtin] = { name: info.name, category: info.category };
    DB.set('gtinCache', cache);
  }

  // ---- Ingreso manual ----
  function procesarManual({ name, category, quantity, expiryDate, perishable, value, location }) {
    if (!name || !expiryDate) throw new Error('Nombre y fecha de vencimiento son obligatorios.');
    const producto = validarYNormalizar({ name, category, quantity, expiryDate, perishable, value, location, source: 'manual' });
    return AgenteInventario.add(producto);
  }

  // ---- Escaneo de código de barras: resuelve GTIN contra Open Food Facts ----
  // (API pública y gratuita, sin necesidad de API key: world.openfoodfacts.org)
  async function resolverGTIN(codigoBarras) {
    // 1) Cache local: si ya lo escaneamos antes, funciona sin conexión.
    const cache = leerCacheGTIN();
    if (cache[codigoBarras]) {
      return { ...cache[codigoBarras], found: true, origen: 'cache' };
    }

    // 2) Base de productos online (Open Food Facts)
    try {
      const resp = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigoBarras}.json`);
      const data = await resp.json();
      if (data.status === 1 && data.product) {
        const info = {
          name: data.product.product_name || data.product.generic_name || `Producto ${codigoBarras}`,
          category: inferirCategoria(data.product.categories_tags),
          found: true,
          origen: 'online'
        };
        guardarEnCacheGTIN(codigoBarras, info);
        return info;
      }
    } catch (e) {
      console.warn('No se pudo consultar Open Food Facts (¿sin conexión?)', e);
      // 3) Sin red y sin cache: se devuelve un registro editable para que la
      //    carga no se interrumpa; el usuario completa el nombre a mano.
      return { name: '', category: 'otros', found: false, origen: 'offline' };
    }
    return { name: '', category: 'otros', found: false, origen: 'no_encontrado' };
  }

  function inferirCategoria(categoriesTags = []) {
    const texto = (categoriesTags || []).join(' ').toLowerCase();
    if (/dairy|lacteo|leche|yogur|queso/.test(texto)) return 'lacteos';
    if (/vegetable|verdura/.test(texto)) return 'verduras';
    if (/fruit|fruta/.test(texto)) return 'frutas';
    if (/meat|carne|poultry|pollo/.test(texto)) return 'carnes';
    if (/cereal|pasta|arroz|rice/.test(texto)) return 'cereales';
    return 'otros';
  }

  // El escaneo entrega identidad + cantidad, pero la fecha se completa
  // aparte (foto/OCR o manual) — se resuelve en dos pasos desde la UI.
  // Si el usuario corrige o completa el nombre (porque no había red o el
  // código no estaba en la base), ese aprendizaje se guarda en el cache
  // local: el mismo código se reconoce solo la próxima vez, sin internet.
  async function procesarEscaneo(codigoBarras, { expiryDate, quantity, location, name, category } = {}) {
    const info = await resolverGTIN(codigoBarras);
    const nombreFinal = (name && name.trim()) || info.name;
    const categoriaFinal = category || info.category;

    if (!nombreFinal) throw new Error('Escribí el nombre del producto para poder cargarlo.');

    const producto = validarYNormalizar({
      name: nombreFinal,
      category: categoriaFinal,
      quantity: quantity || 1,
      expiryDate,
      location,
      source: 'scan',
      gtin: codigoBarras
    });

    guardarEnCacheGTIN(codigoBarras, { name: nombreFinal, category: categoriaFinal });
    return AgenteInventario.add(producto);
  }

  /* ======================================================================
     OCR (Tesseract.js) — lectura de fecha y nombre del envase
     ======================================================================
     Nota sobre la CONFIANZA: Tesseract devuelve dos cosas distintas.
       · `data.confidence`  = promedio de TODO el texto de la foto.
       · `data.words[].confidence` = certeza de cada palabra leída.
     Usar el promedio global es engañoso: el envase tiene logos, listas de
     ingredientes y tipografías raras que bajan el promedio aunque la fecha
     se haya leído perfecto. Por eso acá se mide la confianza de las
     PALABRAS QUE FORMAN LA FECHA, que es lo único que importa.
     ====================================================================== */

  /* ---- Worker persistente ---------------------------------------------
     `Tesseract.recognize()` crea un worker, descarga el modelo de idioma,
     reconoce y lo destruye. Llamarlo en cada vuelta del escáner continuo
     significaba recargar el modelo entero 25 veces seguidas: cada intento
     tardaba tanto que la lectura de la fecha nunca llegaba a completarse
     (por eso el código de barras andaba y la fecha no). Un único worker
     reutilizado deja cada intento en menos de un segundo.
     -------------------------------------------------------------------- */
  let workerPromesa = null;

  async function obtenerWorker() {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Motor OCR no disponible (sin conexión para cargar Tesseract.js).');
    }
    if (!workerPromesa) {
      workerPromesa = (async () => {
        const w = await Tesseract.createWorker('eng');
        // PSM 6 = bloque de texto uniforme. Es el que mejor funciona sobre
        // un recorte chico del envase, donde hay pocas líneas sueltas.
        try { await w.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) { /* opcional */ }
        return w;
      })().catch((e) => { workerPromesa = null; throw e; });
    }
    return workerPromesa;
  }

  async function liberarOCR() {
    if (!workerPromesa) return;
    try { (await workerPromesa).terminate(); } catch (e) { /* ya cerrado */ }
    workerPromesa = null;
  }

  /* ---- Preprocesado ---------------------------------------------------
     Tres cambios respecto de la versión anterior, y los tres importan:

     1) RECORTE (roi). Antes se le daba a Tesseract el frame completo: 3,7
        millones de píxeles con logos, lista de ingredientes y tabla
        nutricional. La fecha era una porción diminuta de ese ruido. Ahora
        se lee sólo el rectángulo que el usuario ve en pantalla.
     2) UMBRAL DE OTSU en vez de "promedio × 0,88". El promedio global falla
        cuando conviven una etiqueta blanca y una zona oscura; Otsu busca el
        corte que mejor separa las dos poblaciones de píxeles.
     3) AUTOINVERSIÓN. Muchas fechas van impresas en blanco sobre plástico
        oscuro, y Tesseract espera texto oscuro sobre fondo claro.
     -------------------------------------------------------------------- */
  const ROI_COMPLETA = { x: 0, y: 0, w: 1, h: 1 };

  function umbralOtsu(hist, total) {
    let suma = 0;
    for (let i = 0; i < 256; i++) suma += i * hist[i];
    let sumaB = 0, pesoB = 0, maxVar = -1, umbral = 128;
    for (let i = 0; i < 256; i++) {
      pesoB += hist[i];
      if (!pesoB) continue;
      const pesoF = total - pesoB;
      if (!pesoF) break;
      sumaB += i * hist[i];
      const mediaB = sumaB / pesoB;
      const mediaF = (suma - sumaB) / pesoF;
      const entre = pesoB * pesoF * (mediaB - mediaF) * (mediaB - mediaF);
      if (entre > maxVar) { maxVar = entre; umbral = i; }
    }
    return umbral;
  }

  function preprocesar(fuente, { roi = ROI_COMPLETA, anchoObjetivo = 900, binarizar = true, local = false } = {}) {
    const w = fuente.videoWidth || fuente.naturalWidth || fuente.width;
    const h = fuente.videoHeight || fuente.naturalHeight || fuente.height;
    if (!w || !h) return null;

    const sx = Math.round(w * roi.x);
    const sy = Math.round(h * roi.y);
    const sw = Math.max(1, Math.round(w * roi.w));
    const sh = Math.max(1, Math.round(h * roi.h));

    // Se agranda el recorte hasta ~900 px de ancho: el OCR necesita que los
    // caracteres tengan cierto tamaño, pero pasarse sólo cuesta tiempo.
    const escala = Math.min(3, Math.max(1, anchoObjetivo / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * escala);
    canvas.height = Math.round(sh * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuente, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    if (!binarizar) return canvas;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    let hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const gris = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = gris;
      hist[gris]++;
    }
    const total = d.length / 4;

    // Estirar el contraste ANTES de binarizar. Sin esto, un troquelado gris
    // claro sobre etiqueta blanca se pierde entero (ver estirarContraste).
    hist = estirarContraste(d, hist, total);

    if (local) {
      umbralLocalAdaptativo(d, canvas.width, canvas.height);
      ctx.putImageData(img, 0, 0);
      return canvas;
    }

    const umbral = umbralOtsu(hist, total);

    // `<=` y no `<`: Otsu devuelve el umbral como ÚLTIMO nivel de la clase
    // oscura, así que los píxeles que caen justo en él son texto. Con `<`
    // se perdía el borde del trazo — en una fecha troquelada, donde el
    // trazo tiene dos o tres píxeles de ancho, eso es una parte apreciable
    // del carácter.
    let oscuros = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] <= umbral) oscuros++;
    const invertir = oscuros > total * 0.55; // texto claro sobre fondo oscuro

    for (let i = 0; i < d.length; i += 4) {
      let v = d[i] <= umbral ? 0 : 255;
      if (invertir) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* ---- Estiramiento de contraste ---------------------------------------
     Normaliza el rango real de grises a 0–255, tomando percentiles (no el
     mínimo y máximo absolutos, porque una sola mota o un brillo alcanzarían
     para arruinar la escala).

     ALCANCE REAL, medido y no supuesto: esto NO mejora el camino
     binarizado. Se verificó con tres escenarios de bajo contraste y la
     cantidad de píxeles de texto conservados fue idéntica con y sin
     estiramiento. El motivo es matemático: la transformación es LINEAL y el
     umbral de Otsu es invariante a escala — se corre proporcionalmente y
     termina clasificando exactamente los mismos píxeles.

     Dónde sí sirve: en la estrategia que pasa la imagen SIN binarizar
     (`binarizar: false`), donde Tesseract recibe los grises directamente y
     aplica su propio análisis. Ahí un histograma que ocupa todo el rango
     es mejor entrada que uno apretado entre 208 y 250.

     Para el problema de fondo —texto tenue con iluminación despareja— lo
     que sirve es el umbral LOCAL de más abajo, no éste.
     -------------------------------------------------------------------- */
  function estirarContraste(d, hist, total) {
    /* El percentil tiene que ser CHICO. En la foto de una fecha, el
       troquelado ocupa apenas entre el 1 y el 3% de los píxeles del recorte:
       con un recorte del 2% —que suena conservador— el propio texto que se
       quiere rescatar cae dentro de lo descartado. Con 0,5% sigue alcanzando
       para que una mota o un brillo aislado no definan la escala, que es lo
       único que este recorte tiene que evitar. */
    const recorte = Math.max(1, Math.floor(total * 0.005));

    let bajo = 0, acum = 0;
    for (let i = 0; i < 256; i++) { acum += hist[i]; if (acum > recorte) { bajo = i; break; } }
    let alto = 255; acum = 0;
    for (let i = 255; i >= 0; i--) { acum += hist[i]; if (acum > recorte) { alto = i; break; } }

    // Si el rango ya es amplio, o es tan angosto que estirarlo sólo
    // amplificaría ruido, se deja la imagen como está.
    const rango = alto - bajo;
    if (rango >= 200 || rango < 12) return hist;

    const escala = 255 / rango;
    const nuevo = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      let v = Math.round((d[i] - bajo) * escala);
      if (v < 0) v = 0; else if (v > 255) v = 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      nuevo[v]++;
    }
    return nuevo;
  }

  /* ---- Umbral local (adaptativo) ---------------------------------------
     Otsu usa UN umbral para toda la imagen. Alcanza cuando la iluminación
     es pareja, y falla cuando el envase tiene un brillo de un lado y sombra
     del otro —muy común fotografiando una tapa curva o un frasco—. Ahí, el
     mismo corte que rescata la zona oscura satura la clara.

     Este umbral se calcula por vecindad: cada píxel se compara con el
     promedio de su entorno menos un margen. Se implementa con imagen
     integral para que sea una sola pasada y no dependa del tamaño de la
     ventana, si no en un celular sería inusable.
     -------------------------------------------------------------------- */
  function umbralLocalAdaptativo(d, w, h, ventana, margen = 10) {
    const radio = Math.max(4, Math.floor((ventana || Math.max(w, h) / 16) / 2));
    const integral = new Float64Array((w + 1) * (h + 1));

    for (let y = 0; y < h; y++) {
      let fila = 0;
      for (let x = 0; x < w; x++) {
        fila += d[(y * w + x) * 4];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + fila;
      }
    }

    const suma = (x0, y0, x1, y1) =>
      integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1]
      - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];

    let oscuros = 0;
    const salida = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radio), y1 = Math.min(h, y + radio + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radio), x1 = Math.min(w, x + radio + 1);
        const n = (x1 - x0) * (y1 - y0);
        const media = suma(x0, y0, x1, y1) / n;
        const v = d[(y * w + x) * 4];
        const esTexto = v < media - margen;
        if (esTexto) oscuros++;
        salida[y * w + x] = esTexto ? 0 : 255;
      }
    }

    // Misma autoinversión que en el camino de Otsu: Tesseract espera texto
    // oscuro sobre fondo claro.
    const invertir = oscuros > w * h * 0.55;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = invertir ? 255 - salida[p] : salida[p];
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }

  /* ---- Aplanado de resultados ------------------------------------------
     Tesseract.js v4 devuelve `data.words` y `data.lines` planos; v5 los
     anidó dentro de `data.blocks`. Se soportan los dos para que una
     actualización del CDN no rompa la lectura en silencio.
     -------------------------------------------------------------------- */
  function aplanarLineas(data) {
    if (Array.isArray(data.lines) && data.lines.length) return data.lines;
    const out = [];
    (data.blocks || []).forEach((b) =>
      (b.paragraphs || []).forEach((p) =>
        (p.lines || []).forEach((l) => out.push(l))));
    return out;
  }

  function aplanarPalabras(data) {
    if (Array.isArray(data.words) && data.words.length) return data.words;
    const out = [];
    aplanarLineas(data).forEach((l) => (l.words || []).forEach((w) => out.push(w)));
    return out;
  }

  /* ---- Estrategias de lectura -----------------------------------------
     No existe una configuración de OCR que sirva para todos los envases: la
     fecha troquelada en una tapa necesita lo contrario que un nombre impreso
     en el frente. En vez de apostar a una sola, el agente prueba varias y se
     queda con la primera que devuelve una fecha válida.
       · psm 11 = texto disperso (sirve para encontrar la fecha suelta)
       · psm 7  = una sola línea (cuando la foto es sólo de la fecha)
       · psm 6  = bloque uniforme (frente del envase, para el nombre)
     Sin binarizar funciona mejor sobre impresión láser clara; binarizado,
     sobre matriz de puntos. Por eso están las dos variantes.
     -------------------------------------------------------------------- */
  const ESTRATEGIAS = [
    { psm: '11', binarizar: false, ancho: 1400 },
    { psm: '7',  binarizar: true,  ancho: 1400 },
    // Umbral local: para tapas curvas y frascos, donde hay brillo de un lado
    // y sombra del otro y un umbral global no puede servir a los dos.
    { psm: '7',  binarizar: true,  ancho: 1400, local: true },
    { psm: '6',  binarizar: true,  ancho: 1100 },
    { psm: '11', binarizar: true,  ancho: 1800, local: true }
  ];

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
      img.src = src;
    });
  }

  async function ocrCrudo(imagen, { roi, psm, binarizar, ancho, local }) {
    const worker = await obtenerWorker();
    const entrada = preprocesar(imagen, { roi, anchoObjetivo: ancho, binarizar, local }) || imagen;
    try { await worker.setParameters({ tessedit_pageseg_mode: psm }); } catch (e) { /* opcional */ }
    // Se piden `blocks` explícitamente: Tesseract.js v5 ya no devuelve
    // `lines`/`words` planos, y sin los bloques no hay forma de saber qué
    // línea es la más grande del envase (que es como se detecta el nombre).
    const { data } = await worker.recognize(entrada, {}, { text: true, blocks: true });
    return data;
  }

  /**
   * Ejecuta el OCR sobre una imagen o un frame de video y extrae la fecha de
   * vencimiento y el nombre del producto.
   *   estado: 'ok' | 'baja_confianza' | 'sin_fecha' | 'sin_texto'
   */
  async function procesarFoto(fuente, minConfidence = 0.6, { roi = ROI_COMPLETA, estrategias = ESTRATEGIAS } = {}) {
    // Las fotos llegan como dataURL. Antes se le pasaba esa cadena directo a
    // Tesseract, y como el preprocesado sólo corría para elementos de video,
    // la foto se leía SIN recorte, SIN binarizar y SIN aumentar: por eso el
    // modo foto no leía ninguna fecha. Ahora se materializa en un <img> y
    // pasa por el mismo tratamiento que un frame de la cámara.
    const imagen = typeof fuente === 'string' ? await cargarImagen(fuente) : fuente;

    let mejorTexto = '';
    let mejorNombre = null;
    let hallazgo = { fecha: null, confianza: 0 };

    for (const est of estrategias) {
      const data = await ocrCrudo(imagen, { roi, ...est });
      const texto = (data.text || '').trim();
      if (texto.length > mejorTexto.length) mejorTexto = texto;

      const nombre = extraerNombre(data);
      if (nombre && (!mejorNombre || nombre.confianza > mejorNombre.confianza)) mejorNombre = nombre;

      const h = extraerFechaConConfianza(texto, aplanarPalabras(data));
      if (h.fecha) { hallazgo = h; break; }
    }

    if (!mejorTexto) {
      return { estado: 'sin_texto', textoDetectado: '', fechaDetectada: null, nombreDetectado: null, confianza: 0, requiereConfirmacion: true };
    }
    if (!hallazgo.fecha) {
      return { estado: 'sin_fecha', textoDetectado: mejorTexto, fechaDetectada: null, nombreDetectado: mejorNombre, confianza: 0, requiereConfirmacion: true };
    }

    const confianza = hallazgo.confianza;
    return {
      estado: confianza >= minConfidence ? 'ok' : 'baja_confianza',
      textoDetectado: mejorTexto,
      fechaDetectada: hallazgo.fecha,
      nombreDetectado: mejorNombre,
      crudo: hallazgo.crudo,
      confianza,
      requiereConfirmacion: confianza < minConfidence
    };
  }

  const MESES_TXT = {
    ene: '01', jan: '01', feb: '02', mar: '03', abr: '04', apr: '04',
    may: '05', jun: '06', jul: '07', ago: '08', aug: '08',
    sep: '09', set: '09', oct: '10', nov: '11', dic: '12', dec: '12'
  };

  /**
   * Busca la fecha en el texto y calcula la confianza a partir de las
   * palabras del OCR que la contienen.
   */
  function extraerFechaConConfianza(texto, palabras = []) {
    const fecha = extraerFecha(texto);
    if (!fecha) return { fecha: null, confianza: 0 };

    // Confianza = promedio de las palabras que contienen dígitos de la fecha
    const conNumeros = palabras.filter((w) => /\d{2}/.test(w.text || ''));
    let confianza = 0;
    if (conNumeros.length) {
      confianza = conNumeros.reduce((a, w) => a + (w.confidence || 0), 0) / conNumeros.length / 100;
    }
    // Si el OCR no entregó detalle por palabra, se usa una estimación prudente
    if (!confianza) confianza = 0.5;

    return { fecha, confianza, crudo: (conNumeros[0] && conNumeros[0].text) || '' };
  }

  /* ---- Corrección de confusiones típicas del OCR -----------------------
     Las fechas de los envases se imprimen con matriz de puntos o láser
     sobre plástico curvo: es donde el OCR más se equivoca, y siempre con
     los mismos pares (O↔0, I/l↔1, S↔5, B↔8). Corregirlos SÓLO dentro de
     algo que ya tiene forma de fecha evita romper el resto del texto.
     -------------------------------------------------------------------- */
  const CONFUSIONES = {
    o: '0', q: '0', d: '0', u: '0',
    i: '1', l: '1', '|': '1', '!': '1',
    z: '2', e: '3', a: '4', s: '5', b: '8', t: '7',
    // G→6, no G→9: las fechas de los envases se imprimen en MAYÚSCULAS, y
    // ahí la confusión dominante es la G con el 6 (la g minúscula con el 9
    // aparece en texto corrido, no en un troquelado de vencimiento).
    g: '6'
  };
  const SOLO_CONFUNDIBLE = /^[0-9oqduil|!zeasbgt]+$/;

  function corregirDigitos(token) {
    return token.replace(/[oqduil|!zeasbgt]/g, (c) => CONFUSIONES[c] || c);
  }

  /**
   * Devuelve el texto original y, si aplica, una segunda versión con las
   * confusiones corregidas.
   *
   * La corrección se hace TOKEN POR TOKEN, no con un regex sobre el texto
   * entero. Un patrón suelto se comía letras de las palabras vecinas (en
   * "vto 3o/o7/26" enganchaba el "to" de "vto" y desarmaba la fecha), que
   * es exactamente el caso que tenía que resolver.
   */
  function variantesTexto(t) {
    const corregido = t.replace(/\S+/g, (token) => {
      if (!/\d/.test(token)) return token;        // sin ningún dígito real no es fecha
      const nucleo = token.replace(/[\/\-.:]/g, '');
      if (!SOLO_CONFUNDIBLE.test(nucleo)) return token;
      if (nucleo.length < 2 || nucleo.length > 8) return token;
      return corregirDigitos(token);
    });
    return corregido === t ? [t] : [t, corregido];
  }

  // Señales de contexto: "vto 30/07/26" es muchísimo más confiable que un
  // número suelto, y "elaborado 30/07/25" hay que descartarlo activamente.
  const CLAVE_VENCE = /(vto|vence|vencimiento|caduc|cons(?:umir)?[\s.:]*(?:pref|antes)?|exp|best\s*before|use\s*by|v[aá]lido\s*hasta)/g;
  const CLAVE_ELAB = /(elab|fabric|producido|envasad|prod\.)/g;

  function marcarZonas(t, re) {
    const zonas = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(t))) zonas.push(m.index);
    return zonas;
  }

  function cerca(pos, zonas, radio = 30) {
    return zonas.some((z) => pos >= z && pos - z <= radio);
  }

  /**
   * Extrae una fecha en los formatos habituales de envases.
   * Cubre separadores /, -, . y espacio; años de 2 y 4 dígitos; meses en
   * letras; el orden yyyy-mm-dd; y formatos sin año (dd/mm) o compactos
   * (ddmmyy) cuando aparecen junto a una palabra clave de vencimiento.
   * Descarta fechas implausibles (más de un año en el pasado o más de 10 en
   * el futuro), que suelen ser lecturas erróneas de lotes o códigos.
   */
  function extraerFecha(texto) {
    const base = ' ' + String(texto).toLowerCase().replace(/\s+/g, ' ') + ' ';

    // Las variantes se prueban EN ORDEN y gana la primera que dé resultado:
    // el texto corregido es un rescate para cuando el OCR se equivocó, no un
    // competidor del texto original. Mezclando candidatos de ambos y quedándose
    // con el más lejano, una lectura inventada del texto crudo podía ganarle a
    // la fecha correcta del texto corregido.
    for (const t of variantesTexto(base)) {
      const iso = buscarEn(t);
      if (iso) return iso;
    }
    return null;
  }

  function buscarEn(t) {
    const candidatas = [];
    {
      const zonasVto = marcarZonas(t, CLAVE_VENCE);
      const zonasElab = marcarZonas(t, CLAVE_ELAB);
      const agregar = (iso, pos) => {
        if (!iso) return;
        if (cerca(pos, zonasElab) && !cerca(pos, zonasVto)) return; // es elaboración
        candidatas.push({ iso, prioritaria: cerca(pos, zonasVto) });
      };

      let re, m;

      // Separadores: una sola clase de caracteres con repetición acotada.
      // Antes era `\s*[\/\-. ]\s*`, donde el espacio pertenecía a las dos
      // partes: sobre un texto con espacios seguidos eso genera backtracking
      // exponencial y el escaneo se cuelga. `[\s\/\-.]{1,3}` es equivalente
      // para el caso real y no tiene ambigüedad.

      // dd/mm/yyyy · dd-mm-yy · dd.mm.yyyy · dd mm yyyy
      re = /(\d{1,2})[\s\/\-.]{1,3}(\d{1,2})[\s\/\-.]{1,3}(\d{2,4})/g;
      while ((m = re.exec(t))) agregar(armarISO(m[3], m[2], m[1]), m.index);

      // yyyy-mm-dd
      re = /(20\d{2})[\s\/\-.]{1,3}(\d{1,2})[\s\/\-.]{1,3}(\d{1,2})/g;
      while ((m = re.exec(t))) agregar(armarISO(m[1], m[2], m[3]), m.index);

      // dd MMM yyyy  (20 AGO 2026 / 20 ago 26)
      re = /(\d{1,2})[\s\/\-.]{0,3}([a-z]{3})[a-z]*[\s\/\-.]{0,3}(\d{2,4})/g;
      while ((m = re.exec(t))) {
        const mes = MESES_TXT[m[2]];
        if (mes) agregar(armarISO(m[3], mes, m[1]), m.index);
      }

      // MMM yyyy (sin día: se asume fin de mes, criterio conservador).
      // Si justo antes del mes hay un día ("20 ago 2026"), no corresponde:
      // ya lo capturó el patrón anterior con el día exacto, y asumir fin de
      // mes daría una fecha POSTERIOR a la real, que es el error peligroso.
      re = /\b([a-z]{3})[a-z]*[\s\/\-.]{0,3}(20\d{2})\b/g;
      while ((m = re.exec(t))) {
        const mes = MESES_TXT[m[1]];
        if (!mes) continue;
        if (/\d[\s\/\-.]{0,3}$/.test(t.slice(Math.max(0, m.index - 5), m.index))) continue;
        const ultimoDia = new Date(Number(m[2]), Number(mes), 0).getDate();
        agregar(armarISO(m[2], mes, String(ultimoDia)), m.index);
      }

      /* MM/AA y MM/AAAA — "03/27", "12/2026"
         -------------------------------------------------------------------
         Es de los formatos más usados en despensa (fideos, conservas, café)
         y no estaba contemplado en ningún patrón. Peor: el patrón dd/mm de
         más abajo leía "03/27" como día 3 del mes 27, lo descartaba por mes
         inválido, y la fecha se perdía en silencio.

         DESAMBIGUACIÓN: el problema es que "03/12" puede ser el 3 de
         diciembre o marzo de 2012. La regla que lo resuelve sin adivinar es
         mirar el SEGUNDO número: si es mayor que 12, no puede ser un mes, así
         que es un año. Si es de 4 dígitos, tampoco hay duda. En esos casos
         gana mes/año. Cuando ambos son ≤ 12 queda genuinamente ambiguo y se
         deja pasar al patrón dd/mm, que ya exige una palabra clave cerca.

         DÍA: se asume el ÚLTIMO del mes, igual que en "MMM yyyy". Es la
         convención de envase —un producto marcado 03/27 se puede consumir
         durante todo marzo— y evita alertar un mes antes de tiempo, que en
         una app contra el desperdicio significaría tirar comida buena.

         CUIDADO CON EL SOLAPAMIENTO: la primera versión de este patrón
         matcheaba el "01/27" de adentro de "23/01/27" y generaba una fecha
         competidora (fin de enero) que le ganaba a la real por ser posterior.
         Por eso el carácter previo excluye también los separadores: si antes
         del mes hay "/", "-" o ".", lo que estamos mirando es la cola de una
         fecha completa y no un mes/año. Se resuelve con un grupo capturado y
         no con lookbehind, que Safari viejo no soporta.

         Y el carácter previo tiene que ser espacio o puntuación, NO una
         letra: sobre el texto crudo del OCR —antes de corregir O↔0— en
         "vto 3o/o7/27" la letra "o" servía de separador y el patrón leía
         "7/27" como julio de 2027, devolviendo fin de julio y cortando la
         búsqueda antes de llegar a la variante corregida, que traía la
         fecha real (el 30). */
      re = /(^|[\s:;,()])(\d{1,2})[\s\/\-.]{1,2}(\d{2}|\d{4})(?![\d\/\-.])/g;
      while ((m = re.exec(t))) {
        const mes = Number(m[2]);
        const anioCrudo = m[3];
        const anioNum = Number(anioCrudo);
        if (mes < 1 || mes > 12) continue;
        // Sólo cuando el año es inequívoco: 4 dígitos, o 2 dígitos > 12.
        if (anioCrudo.length !== 4 && anioNum <= 12) continue;
        const anio = anioCrudo.length === 4 ? anioNum : 2000 + anioNum;
        const ultimoDia = new Date(anio, mes, 0).getDate();
        agregar(armarISO(anio, mes, ultimoDia), m.index);
      }

      // Compacto ddmmyy / ddmmyyyy. Sólo junto a una palabra clave: seis
      // dígitos sueltos son casi siempre un número de lote.
      re = /\b(\d{2})(\d{2})(\d{2}|\d{4})\b/g;
      while ((m = re.exec(t))) {
        if (!cerca(m.index, zonasVto, 20)) continue;
        agregar(armarISO(m[3], m[2], m[1]), m.index);
      }

      // dd/mm sin año, típico de lácteos. Se asume la próxima vez que ocurre
      // esa combinación día/mes a partir de hoy.
      re = /(?:^|[^\d\/])(\d{1,2})[\s\/\-]{1,3}(\d{1,2})(?![\d\/\-. ]{0,3}\d)/g;
      while ((m = re.exec(t))) {
        if (!cerca(m.index, zonasVto, 20)) continue;
        const hoy = new Date();
        let anio = hoy.getFullYear();
        let iso = armarISO(anio, m[2], m[1]);
        if (iso && new Date(iso + 'T00:00:00') < hoy) iso = armarISO(anio + 1, m[2], m[1]);
        agregar(iso, m.index);
      }
    }

    if (!candidatas.length) return null;

    // Una fecha junto a "vto"/"consumir antes de" gana siempre. Entre pares,
    // se toma la más lejana: en un envase conviven elaboración y vencimiento,
    // y la que importa es la segunda.
    const prioritarias = candidatas.filter((c) => c.prioritaria);
    const pool = prioritarias.length ? prioritarias : candidatas;
    return pool.map((c) => c.iso).sort().pop();
  }

  /* ---- Nombre del producto desde el frente del envase ------------------
     El nombre no se busca por patrón sino por TAMAÑO: en cualquier envase,
     el texto más grande de la cara frontal es la marca o el producto. Se
     descartan las líneas de la letra chica legal y nutricional, que son
     numerosas pero pequeñas.
     -------------------------------------------------------------------- */
  const RUIDO_NOMBRE = /(ingredient|informaci|nutricion|contenido neto|peso neto|industria|argentin|conservar|mantener|refriger|una vez abierto|lote|vto|vence|consumir|antes de|elaborad|envasad|valor energ|prote|grasa|sodio|az[uú]car|carbohidrat|porci|www|http|\.com|\.ar|sin tacc|libre de gluten|apto para|rnpa|rne|c[oó]d|barra|kcal|gramos)/i;

  /* Ruido específico de la ZONA DE LA FECHA -----------------------------
     Cuando el usuario fotografía el vencimiento, el OCR arrastra el texto
     que rodea a la fecha: "CONS. PREF.", "FAB.", el número de lote, la
     hora de envasado. Esas líneas competían como candidatas a nombre y a
     veces ganaban, así que el producto terminaba llamándose con un pedazo
     del troquelado.

     `RUIDO_NOMBRE` no las agarraba porque busca palabras completas como
     "consumir" y en el envase suelen venir abreviadas.
     -------------------------------------------------------------------- */
  const RUIDO_FECHA = /(cons\.?\s*pref|c\.?\s*prefer|f\.?\s*venc|f\.?\s*elab|fab\.?\b|env\.?\b|exp\.?\b|best\s*before|use\s*by|caduc|\bl\s*[-:]?\s*\d|\blote\b|\bl\.?\s*n|\bh\b\s*\d{1,2}[:.]\d{2})/i;

  /** ¿Esta línea es (o contiene) una fecha? Entonces no es el nombre. */
  function pareceFecha(texto) {
    if (extraerFecha(texto)) return true;
    // También descarta patrones con forma de fecha que no pasaron la
    // validación de plausibilidad: siguen sin ser un nombre de producto.
    return /\d{1,4}\s*[\/\-.]\s*\d{1,4}(\s*[\/\-.]\s*\d{1,4})?/.test(texto);
  }

  /* ---- Qué ES el producto, no qué palabra es más grande ----------------
     La versión anterior se quedaba con la línea de mayor altura del envase.
     Suena razonable y falla en el caso más común: en un frasco de mayonesa
     Hellmann's la palabra más grande es "CLÁSICA", que es el descriptor de
     variante. El sistema guardaba "Clásica" como nombre del producto.

     No es sólo un nombre feo. El Agente Cocinero matchea ingredientes por
     nombre, así que un producto llamado "Clásica" no entra en NINGUNA
     receta: queda inerte en la despensa, que es exactamente lo contrario
     de lo que la app promete.

     El criterio nuevo: buscar el SUSTANTIVO DEL ALIMENTO en todo el texto
     leído —no sólo en las líneas grandes— y usar el tamaño únicamente para
     desempatar la marca. Un envase puede tener la marca enorme y el tipo de
     producto en letra chica; lo que importa para esta app es el tipo.
     -------------------------------------------------------------------- */

  // Sustantivos de alimento con su categoría. Incluye a propósito los 35
  // ingredientes que conoce el recetario: si el escaneo devuelve uno de
  // ellos, el producto entra directo en el motor de recetas.
  const TIPOS_PRODUCTO = {
    // Lácteos
    leche: 'lacteos', yogur: 'lacteos', queso: 'lacteos', manteca: 'lacteos',
    crema: 'lacteos', ricota: 'lacteos', dulce_de_leche: 'lacteos',
    // Cereales y secos
    arroz: 'cereales', fideos: 'cereales', pasta: 'cereales', harina: 'cereales',
    avena: 'cereales', pan: 'cereales', galletitas: 'cereales', polenta: 'cereales',
    lentejas: 'cereales', garbanzos: 'cereales', porotos: 'cereales',
    pan_rallado: 'cereales', granola: 'cereales', cereal: 'cereales',
    // Carnes
    carne: 'carnes', pollo: 'carnes', pescado: 'carnes', atun: 'carnes',
    jamon: 'carnes', chorizo: 'carnes', milanesa: 'carnes', salchicha: 'carnes',
    // Verduras y frutas
    papa: 'verduras', cebolla: 'verduras', tomate: 'verduras', zanahoria: 'verduras',
    zapallito: 'verduras', zapallo: 'verduras', lechuga: 'verduras', ajo: 'verduras',
    apio: 'verduras', banana: 'frutas', manzana: 'frutas', naranja: 'frutas',
    uva: 'frutas', limon: 'frutas',
    // Huevos
    huevo: 'huevos', huevos: 'huevos',
    // Conservas y condimentos
    mayonesa: 'conservas', ketchup: 'conservas', mostaza: 'conservas',
    salsa: 'conservas', pure: 'conservas', mermelada: 'conservas',
    aceite: 'conservas', vinagre: 'conservas', sal: 'conservas',
    azucar: 'conservas', caldo: 'conservas', canela: 'conservas',
    // Bebidas
    agua: 'bebidas', gaseosa: 'bebidas', jugo: 'bebidas', vino: 'bebidas',
    cerveza: 'bebidas', cafe: 'bebidas', te: 'bebidas', yerba: 'bebidas'
  };

  // Adjetivos de variante. Nunca son el producto, por grandes que estén
  // impresos. Esta lista es la que resuelve el caso "CLÁSICA".
  const DESCRIPTORES = new Set([
    'clasica', 'clasico', 'original', 'tradicional', 'light', 'diet', 'zero',
    'cero', 'suave', 'intenso', 'premium', 'extra', 'super', 'especial',
    'natural', 'casero', 'casera', 'artesanal', 'selecto', 'selecta',
    'entera', 'entero', 'descremada', 'descremado', 'semi', 'fresco', 'fresca',
    'nuevo', 'nueva', 'grande', 'chico', 'familiar', 'individual', 'pack',
    'sabor', 'con', 'sin', 'de', 'la', 'el', 'los', 'las', 'y', 'en'
  ]);

  const normalizarPalabra = (s) => String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca tildes
    .replace(/[^a-z]/g, '');

  /** Busca un sustantivo de alimento en el texto completo del envase. */
  function detectarTipo(textoCompleto) {
    const palabras = String(textoCompleto).split(/\s+/).map(normalizarPalabra).filter(Boolean);
    for (const p of palabras) {
      if (TIPOS_PRODUCTO[p]) return { tipo: p, categoria: TIPOS_PRODUCTO[p] };
      // Plurales simples: "fideos" ya está, pero "quesos" o "huevos" no.
      const sing = p.replace(/e?s$/, '');
      if (sing.length >= 3 && TIPOS_PRODUCTO[sing]) return { tipo: sing, categoria: TIPOS_PRODUCTO[sing] };
    }
    return null;
  }

  function limpiarNombre(s) {
    return s
      .replace(/[^0-9a-zA-ZáéíóúüñÁÉÍÓÚÜÑ %.\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titular(s) {
    return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }

  function extraerNombre(data) {
    const lineas = aplanarLineas(data)
      .map((l) => ({
        texto: limpiarNombre(String(l.text || '')),
        conf: l.confidence || 0,
        alto: l.bbox ? (l.bbox.y1 - l.bbox.y0) : 0
      }))
      .filter((l) => l.texto.length >= 3 && l.texto.length <= 40)
      .filter((l) => l.conf >= 65)
      .filter((l) => /[a-záéíóúñ]{3,}/i.test(l.texto))          // tiene palabras reales
      .filter((l) => l.texto.replace(/[^0-9]/g, '').length / l.texto.length < 0.3)
      .filter((l) => !RUIDO_NOMBRE.test(l.texto))
      // Nada que venga de la zona del troquelado puede ser el nombre.
      .filter((l) => !RUIDO_FECHA.test(l.texto))
      .filter((l) => !pareceFecha(l.texto));

    if (!lineas.length) return null;

    // 1) ¿Qué alimento es? Se busca en TODO el texto, no sólo en lo grande:
    //    muchos envases traen la marca enorme y el tipo en letra chica.
    const hallazgo = detectarTipo(lineas.map((l) => l.texto).join(' '));

    // 2) La marca sí se elige por tamaño, pero descartando descriptores de
    //    variante y la línea que contiene al propio tipo de producto.
    const candidatasMarca = lineas
      .filter((l) => {
        const palabras = l.texto.split(/\s+/).map(normalizarPalabra).filter(Boolean);
        if (!palabras.length) return false;
        if (palabras.every((p) => DESCRIPTORES.has(p))) return false;      // "Clásica"
        if (hallazgo && palabras.some((p) => p === hallazgo.tipo)) return false; // ya es el tipo
        return true;
      })
      .sort((a, b) => (b.alto - a.alto) || (b.conf - a.conf));

    const marca = candidatasMarca[0];

    if (hallazgo) {
      // "Mayonesa Hellmanns" — el sustantivo primero, que es lo que después
      // usa el Cocinero para matchear, y la marca como calificador.
      const texto = marca ? `${hallazgo.tipo} ${marca.texto}` : hallazgo.tipo;
      return {
        texto: titular(texto),
        tipo: hallazgo.tipo,
        categoria: hallazgo.categoria,
        confianza: marca ? Math.max(0.75, marca.conf / 100) : 0.75
      };
    }

    // 3) Sin tipo reconocido se cae al criterio viejo —la línea más grande—
    //    pero al menos ya no puede devolver un descriptor suelto.
    if (!marca || !marca.alto) return null;
    return { texto: titular(marca.texto), confianza: marca.conf / 100 };
  }

  function armarISO(anio, mes, dia) {
    let a = String(anio).padStart(2, '0');
    if (a.length === 2) a = '20' + a;
    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    if (Number(mm) < 1 || Number(mm) > 12) return null;
    if (Number(dd) < 1 || Number(dd) > 31) return null;

    const iso = `${a}-${mm}-${dd}`;
    const fecha = new Date(iso + 'T00:00:00');
    if (isNaN(fecha.getTime())) return null;

    // Plausibilidad: descarta lecturas que casi seguro son lotes o códigos
    const hoy = new Date();
    const haceUnAnio = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate());
    const enDiezAnios = new Date(hoy.getFullYear() + 10, hoy.getMonth(), hoy.getDate());
    if (fecha < haceUnAnio || fecha > enDiezAnios) return null;

    return iso;
  }

  // ---- Validación y normalización común (para todas las vías) ----
  function validarYNormalizar({ name, category, quantity, expiryDate, perishable, value, source, gtin, location }) {
    if (!expiryDate || isNaN(new Date(expiryDate).getTime())) {
      throw new Error('Fecha de vencimiento inválida o ausente.');
    }
    return {
      name: name.trim(),
      category: category || 'otros',
      quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      expiryDate,
      perishable: perishable ?? true,
      value: value ?? 1,
      source,
      gtin,
      location: location || 'Heladera'
    };
  }

  /* ======================================================================
     MODO ESCÁNER CONTINUO
     ======================================================================
     En vez de "sacar una foto y ver qué salió", la cámara queda mirando el
     producto y el agente intenta leer una y otra vez hasta lograrlo. Es la
     diferencia entre una herramienta que falla y una que insiste: reduce
     drásticamente la fricción de carga, que el documento identifica como el
     principal freno del sistema (Sección 8).

     Corre sobre el MISMO stream de video que usa el lector de códigos, así
     que puede leer el código de barras y la fecha en una sola pasada.
     ====================================================================== */
  let escaneoActivo = false;
  let cancelado = false;

  // Rectángulo que se lee dentro del frame. Coincide con el recuadro que la
  // interfaz dibuja sobre el video: el usuario lee lo mismo que lee el OCR.
  const ROI_ESCANER = { x: 0.08, y: 0.24, w: 0.84, h: 0.52 };
  // Encuadre angosto del paso de la fecha: coincide con `.scan-stage.paso-fecha
  // .scan-frame` en el CSS (inset 32% 12%). Cuanto menos envase entra, más
  // grande queda la fecha tras el aumento y mejor la lee el OCR.
  const ROI_FECHA = { x: 0.12, y: 0.32, w: 0.76, h: 0.36 };

  /**
   * Escáner continuo: la cámara queda mirando el envase y el agente insiste
   * hasta leerlo, en vez de "sacar una foto y ver qué salió". De cada frame
   * saca en una sola pasada la fecha y el nombre, que es lo que permite
   * autocompletar el producto apuntando al frente del paquete.
   *
   * @param {HTMLVideoElement} video  fuente de frames
   * @param {object} opciones
   *   buscarNombre         → true si el nombre todavía está vacío
   *   onProgreso(i, segsRestantes) → feedback en pantalla
   *   onTexto(crudo)       → lo que la cámara está leyendo, en vivo
   *   onNombre(txt, conf)  → se leyó un nombre plausible
   *   onFecha(iso, conf, motivo) → se resolvió (o se agotó) la búsqueda
   *   minConfianza         → umbral para dar una fecha por buena
   *   intervaloMs          → respiro entre intentos (el OCR ocupa la CPU)
   *   presupuestoMs        → techo de tiempo total del escaneo
   *   intentosConfirmacion → vueltas extra para confirmar una lectura
   */
  /* ---- Escaneo continuo de la fecha ------------------------------------
     REESCRITO tras una prueba real que dejó el problema a la vista: el
     usuario sostuvo el teléfono sobre un frasco durante el "intento 24 de
     32" sin que pasara nada. Las cuentas explican por qué:

       32 intentos × (OCR de ~2 s + 900 ms de espera) ≈ 90 segundos

     Y aunque leyera bien la fecha, no la entregaba: exigía que apareciera
     DOS VECES IDÉNTICA o con 85% de confianza. Un troquelado tenue casi
     nunca llega a ese número, así que seguía girando con la respuesta ya
     encontrada. Encima el texto crudo de cada vuelta se descartaba, así
     que el usuario no veía absolutamente nada.

     Tres cambios de criterio:

     1) SE ACOTA POR TIEMPO, no por intentos. "Intento 24 de 32" no le dice
        nada a nadie; diez segundos sí. Si en ese rato no salió, no va a
        salir: lo que corresponde es soltar al usuario, no insistir.
     2) LA FECHA SE OFRECE APENAS SE LEE. Antes se exigía confirmación y,
        si no llegaba, igual se terminaba ofreciendo la misma lectura 90
        segundos después. Se llega al mismo lugar, mucho antes. Queda una
        ventana corta buscando la confirmación, que si aparece sube la
        certeza; si no, se entrega igual para que el usuario la revise.
     3) SE EMITE EL TEXTO CRUDO en cada vuelta. Ver qué está leyendo la
        cámara es lo único que permite entender por qué falla — y le avisa
        al usuario que el sistema está haciendo algo.
     -------------------------------------------------------------------- */
  async function iniciarEscaneoContinuo(video, {
    buscarNombre = false,
    onProgreso = () => {}, onFecha = () => {}, onNombre = () => {},
    onTexto = () => {},
    minConfianza = 0.55, intervaloMs = 500,
    presupuestoMs = 10000,        // techo duro: pasado esto se corta
    intentosConfirmacion = 2,     // vueltas extra para confirmar una lectura
    roi = ROI_ESCANER, roiFecha = ROI_FECHA
  } = {}) {
    if (escaneoActivo) return;
    escaneoActivo = true;
    cancelado = false;

    const arranque = Date.now();
    let intento = 0;
    let mejor = null;          // mejor lectura de fecha hasta el momento
    let intentosDesdeHallazgo = 0;
    let nombreEntregado = !buscarNombre;

    // Se precarga el motor antes del primer intento para que el usuario vea
    // "preparando" en vez de una pantalla congelada varios segundos.
    try { await obtenerWorker(); } catch (e) {
      escaneoActivo = false;
      onFecha(null, 0, 'sin_motor');
      return;
    }

    while (escaneoActivo && (Date.now() - arranque) < presupuestoMs) {
      intento++;
      const restante = Math.max(0, presupuestoMs - (Date.now() - arranque));
      onProgreso(intento, Math.ceil(restante / 1000));

      try {
        if (video.videoWidth) {
          // Una estrategia por intento, rotando: en cinco o seis segundos el
          // agente probó todas las configuraciones sobre el envase, sin pagar
          // el costo de correrlas todas en cada frame.
          const est = ESTRATEGIAS[(intento - 1) % ESTRATEGIAS.length];
          // Mientras falte el nombre se mira el envase entero; una vez que ya
          // se tiene, se cierra el encuadre sobre la fecha para que quede más
          // grande al aumentar.
          const roiActual = nombreEntregado ? roiFecha : roi;
          const res = await procesarFoto(video, minConfianza, { roi: roiActual, estrategias: [est] });

          // Se emite SIEMPRE, aunque no haya fecha: es lo que le permite al
          // usuario ver que la cámara está leyendo algo, y lo que hace
          // diagnosticable un fallo.
          if (res.textoDetectado) onTexto(res.textoDetectado);

          if (!nombreEntregado && res.nombreDetectado && res.nombreDetectado.confianza >= 0.7) {
            nombreEntregado = true;
            onNombre(res.nombreDetectado.texto, res.nombreDetectado.confianza);
          }

          if (res.fechaDetectada) {
            // Repetir la lectura sigue siendo la mejor defensa contra un
            // dígito mal reconocido, así que si se confirma se corta ya.
            if (mejor && mejor.fecha === res.fechaDetectada) {
              escaneoActivo = false;
              onFecha(res.fechaDetectada, Math.max(mejor.confianza, res.confianza), 'confirmada');
              return;
            }
            if (res.confianza >= 0.85) {
              escaneoActivo = false;
              onFecha(res.fechaDetectada, res.confianza, 'alta_confianza');
              return;
            }
            if (!mejor) intentosDesdeHallazgo = 0;
            mejor = { fecha: res.fechaDetectada, confianza: res.confianza };
          }

          // Ya hay una lectura y la confirmación no llegó en un par de
          // vueltas: se entrega igual. Antes esto esperaba a agotar los 32
          // intentos para terminar ofreciendo exactamente lo mismo.
          if (mejor) {
            intentosDesdeHallazgo++;
            if (intentosDesdeHallazgo > intentosConfirmacion) {
              escaneoActivo = false;
              onFecha(mejor.fecha, mejor.confianza, 'sin_confirmar');
              return;
            }
          }
        }
      } catch (e) {
        console.warn('Error en el escaneo de fecha', e);
      }

      await new Promise((r) => setTimeout(r, intervaloMs));
    }

    escaneoActivo = false;
    if (cancelado) return; // lo detuvo el usuario: no corresponde reportar nada

    // Si se agotaron los intentos pero hubo una lectura, se ofrece igual
    // para que el usuario confirme en vez de obligarlo a empezar de cero.
    if (mejor) onFecha(mejor.fecha, mejor.confianza, 'sin_confirmar');
    else onFecha(null, 0, 'no_encontrada');
  }

  // Alias histórico (la UI vieja lo llamaba así).
  const iniciarEscaneoFecha = iniciarEscaneoContinuo;

  function detenerEscaneo() { cancelado = true; escaneoActivo = false; }
  function estaEscaneando() { return escaneoActivo; }

  return {
    procesarManual, procesarEscaneo, procesarFoto, resolverGTIN,
    extraerFecha, extraerNombre, validarYNormalizar, estimarVencimiento,
    VIDA_UTIL_DIAS, iniciarEscaneoContinuo, iniciarEscaneoFecha,
    estirarContraste, umbralOtsu, umbralLocalAdaptativo,
    detenerEscaneo, estaEscaneando, preprocesar, liberarOCR,
    ROI_ESCANER, ROI_FECHA, ROI_COMPLETA, ESTRATEGIAS
  };
})();
