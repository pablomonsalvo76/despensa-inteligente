# Propuesta — Un solo motor de IA para Cocinero y Capturador

> Informe técnico, 2026-07-31. Responde a la pregunta: ¿conviene una IA
> integrada que sirva tanto al Agente Cocinero como al Agente de Captura, y
> qué cambia eso en la arquitectura y en la Parte 2 del TP?
>
> **Estado: implementado el 2026-08-06.** El plan de la sección 6 se
> ejecutó completo (`AIProvider`, `leerConVisionIA`, `generarParaVencer`,
> UI y tests). Falta únicamente que el usuario cree el proyecto Firebase y
> pegue su configuración — ver `docs/CONTEXTO.md`, sección 7.

---

## 1. El problema que la desencadena

En esta sesión aparecieron dos límites reales, en dos agentes distintos, que
al principio se discutieron como si fueran independientes:

1. **`AgenteCocinero`** está acotado al catálogo fijo de 27 recetas
   (`js/recipes.js`), que en conjunto usan sólo 35 ingredientes. Con una
   despensa real, la mayoría de los productos no calzan con nada del
   catálogo. `AgenteGenerador` ya existe para levantar ese techo, pero
   depende de **Ollama corriendo en `localhost`** — inutilizable desde el
   celular, que es el dispositivo principal de la app.
2. **`AgenteCaptura`** (OCR de fecha de vencimiento) falla en fechas
   troqueladas sin tinta incluso con buena luz y linterna. Es un límite real
   de un OCR clásico (PP-OCR/Tesseract): segmenta carácter por carácter y
   necesita bordes definidos. Un modelo de visión que razone sobre la
   imagen completa lee esos casos mucho mejor.

**El punto en común, una vez que se los mira juntos:** los dos problemas se
resuelven con lo mismo — un modelo capaz, con acceso más allá del
dispositivo, usado como *respaldo* cuando la vía local/gratuita no alcanza.
Construir esto dos veces (una integración de texto para el cocinero, otra
de visión para la captura) es duplicar código y decisiones de seguridad que
deberían tomarse una sola vez.

---

## 2. Recomendación: un motor de IA compartido, no dos

**Un único módulo de acceso a IA en la nube**, usado por ambos agentes a
través de la misma interfaz que ya existe en `generador.js`
(`invocar(prompt)` / `invocarOllama(prompt)`). Concretamente:

- Se generaliza `invocar()` para aceptar un motor más: **`gemini`**, además
  de `ollama` y `ninguno`. Mismo patrón, misma config (`generadorConfig` en
  `db.js`, ya arreglado el export/import esta semana).
- Se agrega **`js/agents/visionNube.js`**, que reutiliza la **misma
  configuración y la misma API key** de Gemini para mandar una imagen (la
  foto de la fecha) en vez de sólo texto. Gemini soporta ambos modos con la
  misma cuenta y el mismo `fetch`, a diferencia de Ollama con modelos de
  texto puro como `llama3.2`.
- Los dos puntos de entrada — `AgenteGenerador.generar()` (recetas) y una
  nueva `AgenteCaptura.leerFechaConVision()` (fecha difícil) — llaman al
  mismo cliente de Gemini, con la misma key, el mismo manejo de error de
  red y el mismo lugar de configuración en Preferencias.

**Por qué Gemini y no mantener sólo Ollama:** Ollama también soporta
modelos de visión locales (`llama3.2-vision`, `llava`), así que en teoría
*podría* unificar ambos casos sin salir del dispositivo. Pero esos modelos
pesan 4–8 GB, sólo corren en una compu con GPU razonable, y en la práctica
leen peor un troquelado tenue que un modelo de frontera en la nube — que es
exactamente el caso que te está fallando hoy. Insistir en "todo local"
para resolver el problema que reportaste sería elegir la privacidad por
sobre que la función *funcione*, y ya vimos que eso te resulta inaceptable
("la aplicación no tiene sentido" si hay que estar moviendo el envase).

**Por qué no reemplazar Ollama del todo:** para el caso hogareño simple,
generar una receta con lo que hay en la heladera no necesita mandar nada a
ningún lado si el usuario tiene Ollama en su compu — y ya está construido,
probado (40 tests) y funcionando. Sacarlo sería tirar trabajo real sin
necesidad. La propuesta no es "cambiar a la nube", es **agregar la nube
como una opción más, al lado de la que ya existe**, con el usuario
eligiendo motor por preferencia (ver tabla).

### Cómo queda la matriz de decisión para el usuario

| | Motor local (Ollama) | Motor nube (Gemini) | Ninguno |
|---|---|---|---|
| **Recetas nuevas** (Cocinero) | Privado, gratis, requiere compu con Ollama corriendo | Funciona desde el celular, requiere internet y una API key propia | Catálogo fijo de 27 recetas (siempre disponible, sin IA) |
| **Fecha difícil de leer** (Captura) | No soportado hoy (modelo de visión local es demasiado pesado/pobre para esto) | Único camino que de verdad resuelve el troquelado tenue | Carga manual de la fecha (siempre disponible) |

La fila de "Ninguno" nunca desaparece: es la razón por la que esto sigue
siendo un respaldo y no una dependencia — igual que ya está documentado
para `AgenteGenerador` ("la app NO depende de esto").

---

## 3. Qué cambia en la Parte 2 del TP (y por qué es una mejora, no una contradicción)

`docs/PARTE_2_IA_LOCAL.md`, tal como está redactado hoy, argumenta con
fuerza a favor de mantener todo local por privacidad: *"si hubiéramos usado
una API en la nube, cada generación de receta habría enviado a un tercero
el inventario completo del hogar y las alergias declaradas"*. Sumar Gemini
como opción **no invalida ese argumento — lo vuelve más sofisticado**, y
eso es defendible frente a un profesor de posgrado:

- La postura pasa de ser *"todo local, sin excepción"* a *"local por
  default; la nube se habilita agente por agente, con consentimiento
  explícito, sólo donde el costo de no hacerlo (una función que no
  funciona) supera al costo de privacidad (una foto puntual, no el
  historial completo)"*.
- Es una distinción real: el prompt de recetas hoy incluye el inventario
  completo y referencias a alergias; el de visión para la fecha sólo manda
  **una foto recortada de la fecha**, sin nombre de producto, sin alergias,
  sin historial. El riesgo de privacidad no es el mismo en los dos casos, y
  el informe puede decirlo explícitamente.
- Fortalece la Sección 6 (Ciberseguridad) del TP: da pie a documentar el
  riesgo real de "clave de API en el cliente" con la mitigación real (key
  ingresada por el propio usuario, nunca en el repo; alcance de la key
  restringido en Google Cloud Console a esa sola API).

**Acción concreta:** agregar una sección corta a `PARTE_2_IA_LOCAL.md`
("Revisión: cuándo SÍ conviene la nube") en vez de reescribirlo — conserva
el trabajo ya hecho y lo actualiza con lo que se aprendió recién.

---

## 4. Qué mejora esto respecto del propósito original de la app

El propósito declarado en el README es reducir el desperdicio de alimentos
ayudando a saber **qué hay, qué vence y qué cocinar con eso**. Auditado
contra ese propósito, hoy hay tres puntos donde la app no lo cumple del
todo:

| Función | Estado hoy | Con esta propuesta |
|---|---|---|
| Leer la fecha de un envase difícil | Falla en troquelados tenues, sin salida | Respaldo de visión la lee cuando el OCR local no puede |
| Sugerir qué cocinar con productos poco comunes | Sólo 27 recetas fijas; fuera de esas, no hay sugerencia | El respaldo de Gemini genera una receta a medida, **y ahora funciona desde el celular**, no sólo desde una compu con Ollama |
| Usar la generación de recetas en el dispositivo real de uso (el celular) | Imposible hoy (mixed content + Ollama en localhost) | Resuelto: Gemini es HTTPS de punta a punta, sin el problema de *mixed content* que documentaron con Ollama |

El tercer punto es el más importante y hasta ahora nadie lo había señalado
así: **la función de generación de recetas, tal como está, nunca la va a
usar un usuario real desde el celular** — sólo ustedes, probándola en una
notebook. Agregar Gemini no es sólo "una IA mejor para casos difíciles":
es la diferencia entre una función de demostración y una función que el
público objetivo (definido en la Sección 1 del TP) puede usar de verdad.

---

## 5. Lo que falta decidir antes de programar

1. **Confirmar que se avanza** con esta arquitectura (motor compartido,
   Gemini + Ollama coexistiendo, nube como opción explícita no automática).
2. **Conseguir una API key de Gemini** (Google AI Studio, nivel gratuito
   alcanza para probar) para poder testear de punta a punta en esta sesión.
3. Decidir el **texto de consentimiento** exacto que ve el usuario antes de
   que una foto o el inventario salgan hacia Gemini (breve, en el momento,
   no enterrado en un términos y condiciones).

## 6. Plan de implementación (una vez confirmado)

1. `generador.js`: generalizar `invocar()` para soportar motor `gemini`
   (llamado `invocarGemini(prompt)`), mismo contrato que `invocarOllama`.
2. `js/agents/visionNube.js` (nuevo): `leerFecha(imagenDataURL)` usando la
   misma config/API key, prompt específico para fecha troquelada.
3. `AgenteCaptura`: exponer un punto donde, si PP-OCR y Tesseract no
   encontraron fecha, se ofrezca (botón explícito, no automático) probar
   con `visionNube.leerFecha()`.
4. UI en Preferencias: agregar `gemini` como opción de motor, con su propio
   campo de API key (nunca la del generador de Ollama, son cuentas
   distintas por naturaleza aunque las provea el mismo servicio).
5. Tests: mismo patrón que `generacion.test.js` — motor falso inyectable,
   sin llamadas de red reales en la suite.
6. Actualizar `docs/PARTE_2_IA_LOCAL.md` con la sección de revisión
   (punto 3 de este informe) y `docs/CONTEXTO.md` con el estado.
