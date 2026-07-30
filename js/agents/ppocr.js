/**
 * Motor de OCR PP-OCR (PaddleOCR) sobre ONNX Runtime Web
 * -----------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Tesseract nunca pudo leer una fecha troquelada. No fue falta de ajuste:
 * está diseñado para DOCUMENTOS ESCANEADOS —página plana, tipografía
 * impresa, trazos continuos— y una fecha de vencimiento es lo contrario:
 * matriz de puntos sobre plástico curvo, con brillos y bajo contraste.
 *
 * Medido sobre la foto real de un sachet de mayonesa:
 *
 *   Tesseract  · pipeline completo, todas las variantes  ->  0 aciertos
 *   PP-OCR     · el mismo recorte, sin preprocesar       ->  23/01/27
 *
 * PP-OCR está entrenado para TEXTO EN ESCENA: fotos de objetos reales.
 * Es exactamente nuestro caso. En la prueba leyó bien la fecha en todos
 * los encuadres, incluida la imagen entera sin recortar.
 *
 * DECISIÓN DE ARQUITECTURA: sólo se embarca el modelo de RECONOCIMIENTO
 * (11 MB), no el de detección (4,6 MB más). Se midió que el reconocedor
 * solo, sobre una franja horizontal, lee la fecha con 0,95 de confianza —
 * así que la detección se resuelve barriendo franjas, que es código propio
 * y no requiere portar el post-proceso de contornos del detector.
 *
 * Todo corre en el dispositivo: ni el modelo ni las imágenes salen de ahí.
 */

const MotorPPOCR = (() => {
  const RUTA_MODELO  = 'models/ppocr_rec.onnx';
  const RUTA_CHARSET = 'models/ppocr_charset.json';
  const ALTO_ENTRADA = 48;        // el modelo espera 48 px de alto
  const ANCHO_MAX    = 1200;      // techo para no disparar la memoria

  let sesion = null;
  let charset = null;
  let cargando = null;
  let disponible = null;          // null = sin averiguar

  function soportado() {
    return typeof ort !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  }

  /** Carga perezosa: el modelo son 11 MB, no se baja hasta que se usa. */
  async function preparar(onProgreso = () => {}) {
    if (sesion && charset) return true;
    if (cargando) return cargando;

    cargando = (async () => {
      if (typeof ort === 'undefined') throw new Error('ONNX Runtime no está cargado.');

      onProgreso('Descargando el modelo de lectura (11 MB, una sola vez)…');
      const [ses, cs] = await Promise.all([
        ort.InferenceSession.create(RUTA_MODELO, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        }),
        fetch(RUTA_CHARSET).then((r) => {
          if (!r.ok) throw new Error('No se pudo cargar el diccionario de caracteres.');
          return r.json();
        })
      ]);
      sesion = ses; charset = cs; disponible = true;
      onProgreso('');
      return true;
    })().catch((e) => {
      cargando = null; disponible = false;
      throw e;
    });

    return cargando;
  }

  /* ---- Preparación de la franja -----------------------------------------
     El modelo espera una imagen de 48 px de alto, ancho libre, en RGB
     normalizado a [-1, 1] y en orden CHW (canal, alto, ancho) — no el HWC
     que devuelve un canvas. Convertir mal ese orden es el error silencioso
     más común al portar un modelo: no falla, sólo devuelve basura.
     -------------------------------------------------------------------- */
  function aTensor(canvas) {
    const alto = ALTO_ENTRADA;
    let ancho = Math.round(canvas.width * alto / canvas.height);
    ancho = Math.max(16, Math.min(ANCHO_MAX, ancho));

    const off = new OffscreenCanvas(ancho, alto);
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, ancho, alto);

    const px = ctx.getImageData(0, 0, ancho, alto).data;
    const datos = new Float32Array(3 * alto * ancho);
    const plano = alto * ancho;

    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = (y * ancho + x) * 4;
        const p = y * ancho + x;
        datos[p]             = (px[i]     / 255 - 0.5) / 0.5;   // R
        datos[plano + p]     = (px[i + 1] / 255 - 0.5) / 0.5;   // G
        datos[2 * plano + p] = (px[i + 2] / 255 - 0.5) / 0.5;   // B
      }
    }
    return new ort.Tensor('float32', datos, [1, 3, alto, ancho]);
  }

  /* ---- Decodificación CTC ----------------------------------------------
     La salida es una secuencia de distribuciones sobre 6.625 clases. La
     regla de CTC: se recorre la secuencia, se ignora la clase 0 (el
     "blanco") y se colapsan las repeticiones consecutivas — sin eso, un
     carácter ancho aparecería tres o cuatro veces seguidas.
     -------------------------------------------------------------------- */
  function decodificar(salida, dims) {
    const [, pasos, clases] = dims;
    let texto = '';
    let sumaConf = 0, cuenta = 0, previo = -1;

    for (let t = 0; t < pasos; t++) {
      let mejor = 0, mejorVal = -Infinity;
      const base = t * clases;
      for (let c = 0; c < clases; c++) {
        const v = salida[base + c];
        if (v > mejorVal) { mejorVal = v; mejor = c; }
      }
      if (mejor !== previo && mejor > 0) {
        const ch = charset[mejor - 1];
        if (ch !== undefined) { texto += ch; sumaConf += mejorVal; cuenta++; }
      }
      previo = mejor;
    }
    return { texto, confianza: cuenta ? sumaConf / cuenta : 0 };
  }

  /** Reconoce el texto de UNA franja horizontal (un renglón). */
  async function leerFranja(canvas) {
    if (!sesion) throw new Error('El motor no está preparado.');
    const tensor = aTensor(canvas);
    const salida = await sesion.run({ [sesion.inputNames[0]]: tensor });
    const t = salida[sesion.outputNames[0]];
    return decodificar(t.data, t.dims);
  }

  return {
    soportado, preparar, leerFranja, aTensor, decodificar,
    estaListo: () => !!(sesion && charset),
    estaDisponible: () => disponible,
    ALTO_ENTRADA
  };
})();
