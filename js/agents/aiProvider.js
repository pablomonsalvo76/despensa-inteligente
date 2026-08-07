/**
 * Proveedor de IA compartido
 * -----------------------------------------------------------------------
 * Punto único de acceso a un modelo externo (texto o visión). Lo usan tanto
 * el Agente Generador (recetas cuando el catálogo fijo no alcanza) como el
 * Agente de Captura (lectura de fecha/nombre cuando el OCR local no puede).
 * Ningún agente le habla a Ollama o a Gemini directo: todos pasan por acá,
 * así el motor se cambia en un solo lugar y la configuración, el manejo de
 * errores y el parseo de JSON son uno solo, no uno por agente.
 *
 * MOTORES SOPORTADOS
 *   'ninguno' -> generarTexto/generarConImagen rechazan. Los agentes que
 *                consumen esto ya saben resolver este caso (catálogo fijo,
 *                OCR local): la ausencia de motor nunca deja a la app sin
 *                respuesta, sólo sin la mejora.
 *   'ollama'  -> LLM local de texto (ej. llama3.2). Gratis, privado, no
 *                soporta imágenes, requiere Ollama corriendo en la misma
 *                máquina que abre la app (por eso es inviable en celular).
 *   'gemini'  -> Gemini vía Firebase AI Logic. Soporta texto e imágenes,
 *                funciona desde cualquier dispositivo con internet. La
 *                clave del proyecto NUNCA es un secreto que haya que
 *                esconder: la app se autentica con Firebase App Check
 *                (atestación de que el pedido viene de esta app real), no
 *                con una clave estática que alguien pueda copiar del
 *                código fuente.
 *
 * EL MODELO PROPONE, EL CÓDIGO VERIFICA
 *   Este módulo sólo habla con el modelo y devuelve texto crudo. Nunca
 *   valida alergias, ingredientes ni fechas — esa responsabilidad es de
 *   quien lo llama (`generador.js` con `validar()`, `captura.js` con
 *   `extraerFecha()`), que ya existían para el caso local y se reutilizan
 *   sin cambios para el caso con IA. Un modelo que alucina no debe poder
 *   saltarse un control que ya existía.
 */
const AIProvider = (() => {
  const CLAVE = 'aiProviderConfig';

  let config = {
    motor: 'ninguno',
    ollama: { url: 'http://localhost:11434', modelo: 'llama3.2' },
    gemini: { modelo: 'gemini-3.6-flash', firebaseConfig: null, recaptchaSiteKey: null }
  };

  function mezclar(base, nueva) {
    if (!nueva || typeof nueva !== 'object') return base;
    return {
      ...base, ...nueva,
      ollama: { ...base.ollama, ...(nueva.ollama || {}) },
      gemini: { ...base.gemini, ...(nueva.gemini || {}) }
    };
  }

  function configurar(nueva) {
    config = mezclar(config, nueva);
    DB.set(CLAVE, config);
    return config;
  }

  function leerConfig() {
    config = mezclar(config, DB.get(CLAVE, {}));
    return config;
  }

  function disponible() { return leerConfig().motor !== 'ninguno'; }
  function soportaImagenes() { return leerConfig().motor === 'gemini'; }

  /* ---- Motor Ollama (texto) --------------------------------------------
     Igual al que ya tenía generador.js antes de este módulo: no cambia
     comportamiento, sólo de lugar. */
  async function invocarOllama(prompt) {
    const { url, modelo } = leerConfig().ollama;
    const resp = await fetch(`${url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, prompt, stream: false, format: 'json' })
    });
    if (!resp.ok) throw new Error(`Ollama respondió ${resp.status}`);
    const data = await resp.json();
    return data.response;
  }

  /* ---- Motor Gemini (texto + visión), vía Firebase AI Logic ------------
     El SDK de Firebase AI Logic es un módulo ES (no expone un global
     clásico como los otros scripts CDN del proyecto). El puente está en
     index.html: un <script type="module"> mínimo que deja las funciones
     necesarias en `window.__firebaseAI`. Este archivo sigue siendo un
     script clásico como el resto de los agentes; sólo consume ese puente
     de forma perezosa, la primera vez que hace falta. */
  let modeloGemini = null;

  async function prepararGemini() {
    if (modeloGemini) return modeloGemini;

    const puente = window.__firebaseAI;
    if (!puente) {
      throw new Error('El SDK de Firebase todavía no cargó. Esperá un momento y probá de nuevo.');
    }

    const { firebaseConfig, recaptchaSiteKey, modelo } = leerConfig().gemini;
    if (!firebaseConfig) {
      throw new Error('Falta configurar Firebase (Preferencias → IA en la nube).');
    }

    const app = puente.initializeApp(firebaseConfig);
    if (recaptchaSiteKey) {
      puente.initializeAppCheck(app, {
        provider: new puente.ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true
      });
    }
    const ai = puente.getAI(app, { backend: new puente.GoogleAIBackend() });
    modeloGemini = puente.getGenerativeModel(ai, { model: modelo || 'gemini-3.6-flash' });
    return modeloGemini;
  }

  async function invocarGemini(prompt, partes = []) {
    const modelo = await prepararGemini();
    const resultado = await modelo.generateContent([prompt, ...partes]);
    return resultado.response.text();
  }

  // Motor de prueba: permite testear toda la cadena sin modelo ni red, con
  // el mismo patrón que ya usaba generador.js.
  let motorFalso = null;
  function usarMotorFalso(fn) { motorFalso = fn; }

  async function generarTexto(prompt) {
    if (motorFalso) return motorFalso({ tipo: 'texto', prompt });
    const { motor } = leerConfig();
    if (motor === 'ollama') return invocarOllama(prompt);
    if (motor === 'gemini') return invocarGemini(prompt);
    throw new Error(`Motor "${motor}" no disponible.`);
  }

  // imagenBase64: SIN el prefijo "data:image/...;base64,".
  async function generarConImagen(prompt, imagenBase64, mimeType = 'image/jpeg') {
    if (motorFalso) return motorFalso({ tipo: 'imagen', prompt, imagenBase64, mimeType });
    const { motor } = leerConfig();
    if (motor !== 'gemini') {
      throw new Error(`Motor "${motor}" no soporta imágenes. Configurá Gemini para esta función.`);
    }
    return invocarGemini(prompt, [{ inlineData: { data: imagenBase64, mimeType } }]);
  }

  // Igual al parser de generador.js: los modelos chicos envuelven el JSON
  // en explicaciones o en bloques ```json. Se comparte acá para que
  // cualquier consumidor (recetas, visión) lo use igual.
  function parsearJSON(texto) {
    if (typeof texto !== 'string') return null;
    const limpio = texto.replace(/```(?:json)?/gi, '');
    const desde = limpio.indexOf('{');
    const hasta = limpio.lastIndexOf('}');
    if (desde === -1 || hasta <= desde) return null;
    try { return JSON.parse(limpio.slice(desde, hasta + 1)); } catch (e) { return null; }
  }

  return {
    configurar, leerConfig, disponible, soportaImagenes,
    generarTexto, generarConImagen, parsearJSON, usarMotorFalso
  };
})();
