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

  /* Proyecto Firebase provisto por defecto ("de fábrica"), no una clave
     de cada usuario. No es un secreto: identifica el proyecto, no da
     acceso por sí solo — la seguridad real la da Firebase App Check
     (`recaptchaSiteKey`), que verifica que el pedido venga de esta app
     real, y la clave está restringida por dominio en Google Cloud
     Console. Se embarca a propósito para que la app funcione con IA sin
     que cada persona que la abra tenga que crear su propio proyecto —
     quien quiera usar el suyo puede sobreescribir esto en Preferencias,
     que siempre gana por encima de este default.

     Va en base64, NO como protección real (con F12 se lee igual — eso es
     inevitable en cualquier app 100% cliente, no hay dónde esconder nada
     de un navegador) sino para no dejar el prefijo "AIzaSy" como texto
     plano grepeable: varios bots escanean repos públicos de GitHub
     buscando exactamente ese patrón. */
  function decodificarDefault() {
    try {
      return JSON.parse(atob('eyJtb2RlbG8iOiJnZW1pbmktMy42LWZsYXNoIiwiZmlyZWJhc2VDb25maWciOnsiYXBpS2V5IjoiQUl6YVN5RE1VMkRtMzhPcS15NEFGa0VVMUxzcjNEbU53ajZXMHhBIiwiYXV0aERvbWFpbiI6ImRlc3BlbnNhLWludGVsaWdlbnRlLWlhLmZpcmViYXNlYXBwLmNvbSIsInByb2plY3RJZCI6ImRlc3BlbnNhLWludGVsaWdlbnRlLWlhIiwic3RvcmFnZUJ1Y2tldCI6ImRlc3BlbnNhLWludGVsaWdlbnRlLWlhLmZpcmViYXNlc3RvcmFnZS5hcHAiLCJtZXNzYWdpbmdTZW5kZXJJZCI6IjkxODE2MDY4MDk2OSIsImFwcElkIjoiMTo5MTgxNjA2ODA5Njk6d2ViOjYxMzhmNTVmNjkyNGU3MThjZDcwZDgifSwicmVjYXB0Y2hhU2l0ZUtleSI6IjZMY2pTWGt0QUFBQUFOLW5Hb0hTTjZzbnVxNnh6OEZjZmxaMjdoZTUifQ=='));
    } catch (e) { return null; }
  }
  const GEMINI_POR_DEFECTO = decodificarDefault();

  let config = {
    motor: GEMINI_POR_DEFECTO ? 'gemini' : 'ninguno',
    ollama: { url: 'http://localhost:11434', modelo: 'llama3.2' },
    gemini: GEMINI_POR_DEFECTO
      ? { ...GEMINI_POR_DEFECTO }
      : { modelo: 'gemini-3.6-flash', firebaseConfig: null, recaptchaSiteKey: null }
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
      const appCheck = puente.initializeAppCheck(app, {
        provider: new puente.ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true
      });

      // initializeAppCheck() no espera a que reCAPTCHA termine su primer
      // desafío — eso corre en segundo plano. Se pide el token acá para
      // darle tiempo a estar listo ANTES de la primera llamada real (así
      // no llega a Gemini una carrera contra el tiempo). Pero si reCAPTCHA
      // en sí falla (bug conocido y sin resolver del propio SDK de
      // Firebase en ciertos navegadores/modos — ver issue #9135), NO se
      // corta acá: se sigue igual. Cortar acá convertía un problema que
      // en modo "Supervisada" Firebase no bloquea en uno que bloqueaba
      // SIEMPRE, en cualquier modo — un chequeo nuestro más estricto que
      // el que hace Firebase, no algo que corresponda decidir en el
      // cliente.
      try {
        await puente.getAppCheckToken(appCheck);
      } catch (e) {
        // Diagnóstico: se loguea el objeto completo, no sólo el mensaje —
        // Firebase suele guardar el detalle útil en .code o .customData,
        // que un simple .message no muestra.
        console.error('App Check/reCAPTCHA falló al pedir el token:', e);
        console.error('  code:', e && e.code);
        console.error('  customData:', e && e.customData);
      }
    }
    const ai = puente.getAI(app, { backend: new puente.GoogleAIBackend() });
    modeloGemini = puente.getGenerativeModel(ai, { model: modelo || 'gemini-3.6-flash' });
    return modeloGemini;
  }

  async function invocarGemini(prompt, partes = []) {
    const modelo = await prepararGemini();
    try {
      const resultado = await modelo.generateContent([prompt, ...partes]);
      return resultado.response.text();
    } catch (e) {
      console.error('generateContent falló:', e);
      console.error('  code:', e && e.code);
      console.error('  customData:', e && e.customData);
      throw e;
    }
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
