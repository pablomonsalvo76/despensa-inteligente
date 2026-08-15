# Contexto de trabajo — Despensa Inteligente

> Registro vivo de qué se revisó, qué se arregló y hacia dónde va el proyecto.
> Última actualización: 2026-08-06.

## 1. Qué es el proyecto

PWA de gestión de despensa doméstica. Objetivo central: **reducir el
desperdicio de alimentos** combinando captura de bajo esfuerzo (cámara en vez
de tipeo), alertas de vencimiento y sugerencias de recetas/compras que se
ajustan con el tiempo al comportamiento real del usuario. Corre 100% en el
dispositivo: OCR local, datos en `localStorage` vía `js/db.js`, sin backend
propio salvo APIs públicas (Open Food Facts) y, opcionalmente, un LLM local
(Ollama) para la capa conversacional.

**Visión de negocio (2026-07-30):** además de uso doméstico, la app se puede
pensar para **hotel o restaurante** — más volumen de stock, más productos con
nombres repetidos por lote, y control más estricto de consumo.

### Arquitectura por agentes

Cada agente es un IIFE (`const AgenteX = (() => {...})()`) cargado como
`<script>` en `index.html` y coordinado por `js/agents/orquestador.js`:

| Agente | Rol |
|---|---|
| `captura.js` | Escaneo de código de barras, foto, OCR de fecha/nombre |
| `ppocr.js` | Motor OCR PP-OCR (PaddleOCR) sobre ONNX Runtime Web |
| `inventario.js` | CRUD de productos |
| `vencimientos.js` | Semáforo de urgencia por fecha de vencimiento |
| `cocinero.js` | Sugerencia de recetas priorizando lo próximo a vencer |
| `compras.js` | Lista de compras (qué falta reponer) |
| `evaluador.js` | Registra el desenlace de cada producto (cocinado/descartado/…) |
| `aprendizaje.js` | Aprende gustos/patrones de consumo a partir de los desenlaces |
| `impacto.js` | Métricas de impacto (comida salvada vs. desperdiciada) |
| `hogar.js` | Datos del hogar/familia (alergias, gustos, integrantes) |
| `conversacional.js` / `generador.js` | Capa conversacional en lenguaje natural, con integración a Ollama |

---

## 2. Escáner de producto, foto y código de barras

### Lector de código de barras
- Motor: `html5-qrcode@2.3.8` (CDN), restringido a EAN-13/EAN-8/UPC-A/UPC-E.
- Flujo: cámara → decodifica → `AgenteCaptura.resolverGTIN()`
  ([captura.js:57](../js/agents/captura.js#L57)) → caché local → Open Food
  Facts → fallback manual si no hay red.

### Foto de producto
- `ImageCapture`/`getUserMedia` en `js/main.js`, canvas pasado directo (sin
  `toDataURL()`) a `AgenteCaptura.procesarFoto()`.
- Preprocesamiento: recorte por ROI de la zona de fecha, umbral de Otsu,
  umbral local adaptativo, estiramiento de contraste, cierre morfológico
  para matrices de puntos (dot-matrix), detección de "cuadro sin contenido".

### OCR
- **Motor principal:** PP-OCR (PaddleOCR) sobre ONNX Runtime Web, 100%
  on-device (WASM). Modelo de reconocimiento (~11 MB) + charset, sin modelo
  de detección (se barre con franjas horizontales propias).
- **Respaldo:** Tesseract.js v5 — **según mediciones propias del equipo, 0
  aciertos leyendo fechas troqueladas reales**; sólo sirve como último
  recurso.
- Flujo: frame preprocesado → PP-OCR primero → si no hay fecha, Tesseract
  con varias estrategias → validación de forma/confianza → corrección de
  dígitos ambiguos → normalización a ISO.

### Bugs encontrados y corregidos (2026-07-30)

1. **El panel "Foto fecha" nunca precargaba PP-OCR.** Solo el modo
   "Escáner" llamaba a `MotorPPOCR.preparar()`, así que la vía dedicada de
   foto caía directo a Tesseract (0% de acierto en fechas troqueladas).
   → Fix: se agregó la precarga también en `p-start-camera` y `p-file`
   ([js/main.js](../js/main.js)).
2. **`leerConPPOCR` se rendía si el modelo no estaba listo**, en vez de
   esperar una preparación ya en curso. → Fix: ahora espera `preparar()` si
   está soportado pero no listo, en vez de saltar directo a Tesseract
   ([js/agents/captura.js:604](../js/agents/captura.js#L604)).
3. **El escáner continuo (`iniciarEscaneoContinuo`) abortaba TODO el
   escaneo si fallaba la carga de Tesseract**, aunque PP-OCR (el motor
   principal, que no depende de Tesseract) estuviera disponible. → Fix:
   sólo aborta si PP-OCR tampoco está disponible
   ([js/agents/captura.js:1420](../js/agents/captura.js#L1420)).

---

## 3. Inconsistencias detectadas entre agentes

Revisión de `inventario.js`, `vencimientos.js`, `cocinero.js`,
`evaluador.js`, `aprendizaje.js`, `impacto.js`, `hogar.js`, `compras.js`,
`conversacional.js`, `generador.js`, `orquestador.js`. No se encontraron
llamadas rotas (todo `AgenteX.metodo()` usado coincide con lo expuesto).

### Corregidas

- [x] **`stylePreferences` y `generadorConfig` no estaban en el sistema de
  export/import/clearAll de `db.js`.** Esto hacía que "Exportar mis datos"
  perdiera el gusto aprendido y la config de Ollama, y que "Borrar todo" no
  los limpiara. **Prioridad alta**: `AgenteAprendizaje` es literalmente el
  agente que "entiende al usuario" (ver sección 4). → **Corregido**:
  agregados a `STORES`, `exportAll()` e `importAll()` en
  [js/db.js](../js/db.js).

### Pendientes, ordenadas por prioridad (a la luz de la visión de producto)

1. **Pool de inventario "disponible" duplicado entre `cocinero.js` y
   `compras.js`, con desempate distinto ante productos con el mismo
   nombre.** `cocinero.js` ([:30-39](../js/agents/cocinero.js#L30)) se queda
   con el más urgente; `compras.js` ([:23-27](../js/agents/compras.js#L23))
   se queda con el que aparece último. `generador.js` ya reutiliza la
   función de `cocinero.js` "porque es la regla de seguridad más
   importante"; `compras.js` debería hacer lo mismo. **Riesgo real**: el
   cocinero y la lista de compras pueden operar sobre inventarios
   "disponibles" distintos al mismo tiempo. Se agrava con volumen tipo
   hotel/restaurante (muchos productos con nombres repetidos por lote).

2. **`evaluador.js` documenta un desenlace `'ignorado'`
   ([:59](../js/agents/evaluador.js#L59)) que nunca se implementó.** Hoy
   sólo existen `'cocinado'` y `'descartado'`. Esto bloquea directamente la
   funcionalidad pedida de "este producto no lo consumís tanto, no
   deberías tener tanto stock" (sección 4): sin un tercer estado que
   capture "quedó sin usarse", `AgenteAprendizaje` y `AgenteImpacto` no
   tienen la señal que necesitan.

3. **Contrato `edit`/`editar` inconsistente**: `AgenteInventario.edit`
   filtra cambios contra una allowlist de campos permitidos
   ([:56-61](../js/agents/inventario.js#L56)); `AgenteHogar.editar` no
   ([:94-102](../js/agents/hogar.js#L94)) y aceptaría silenciosamente
   campos como `id`. No explotado hoy porque `main.js` sólo manda campos
   conocidos, pero importa si se agregan roles/multi-usuario (escenario
   hotel/restaurante).

4. **Código muerto expuesto en la API pública** (sin llamadores externos):
   `semaphore`/`thresholdsFor` en `vencimientos.js:60`, `limpiarIgnorados`
   en `compras.js:187`, `PROPIEDADES` en `hogar.js:242`, varias funciones
   de extracción en `conversacional.js:247`. Baja prioridad, no afecta
   funcionalidad.

---

## 4. Visión de producto — pendiente de diseñar/implementar

Requisitos explicados por el usuario (2026-07-30), no implementados aún:

### AgenteCocinero — entender al usuario
- Saber qué ofrecerle y qué no (restricciones + aprendizaje de gustos: la
  base ya existe vía `stylePreferences`/`AgenteAprendizaje`, ver sección 3).
- Saber con qué cocina más (patrones de consumo).
- Todas las sugerencias se ordenan primero por urgencia de vencimiento.
- Si hay **varios** productos próximos a vencer al mismo tiempo, además de
  las recetas normales debe devolver:
  - **Una receta "combo"** que use la **mayor cantidad posible** de esos
    productos (decisión 2026-07-30: si ninguna receta los usa a TODOS, se
    ofrece la que más de ellos cubra — combo parcial, nunca se omite por
    no ser perfecta).
  - **Recetas individuales**, una por cada producto próximo a vencer,
    aunque ya exista la combo (el usuario puede no querer/poder cocinar
    todo junto).
- "Próximo a vencer" para esta función = el mismo semáforo rojo/amarillo
  por categoría que ya calcula `vencimientos.js` (decisión 2026-07-30: no
  se inventa un umbral nuevo de días).
- **No es responsabilidad del cocinero** avisar "esto no lo consumís
  tanto" — esa señal es de `AgenteAprendizaje` (que la calcula) mostrada
  por `AgenteCompras` (en el momento de decidir si comprar de nuevo), no
  dentro de una receta. Ver también el punto de abajo.

**✅ Implementado (2026-07-30):** `AgenteCocinero.recetasParaVencer(enriquecidos)`
en [js/agents/cocinero.js](../js/agents/cocinero.js). Devuelve
`{ prioritarios, combo, individuales }`:
- `prioritarios`: productos rojo/amarillo, ordenados por urgencia.
- `combo`: la receta candidata que rescata más prioritarios a la vez
  (`null` si ninguna rescata al menos uno — nunca se ofrece un combo vacío).
- `individuales`: por cada producto prioritario, su mejor receta propia
  (puede repetir la del combo a propósito, son preguntas distintas).
- Reutiliza el mismo filtrado/puntaje que `suggestRecipes` (restricciones,
  regla de seguridad alimentaria, veredicto de `AgenteHogar`, afinidad de
  gusto) vía una función privada nueva `evaluarCandidatas(...)`, extraída
  de `suggestRecipes` para no duplicar la lógica — comportamiento de
  `suggestRecipes` sin cambios (75/75 tests existentes en verde tras el
  refactor: `recomendacion.test.js`, `estilo.test.js`,
  `generacion.test.js`).
- **Falta**: engancharlo en `js/main.js`/`index.html` (todavía no hay UI
  que llame a esta función ni tests formales en `tests/` para ella —  se
  validó con un smoke test manual descartable, no versionado).

### Control fino de inventario
- Saber cuándo vence (ya existe: `vencimientos.js`).
- Saber hace cuánto se compró y cuánto tiempo estuvo en la despensa (**ya
  existe el dato**: `addedDate` se guarda en cada producto
  ([inventario.js:33](../js/agents/inventario.js#L33)), y `aprendizaje.js`
  ya calcula la diferencia de días
  ([:71](../js/agents/aprendizaje.js#L71)) — falta explotarlo).
- Alertar: "este producto no lo consumís tanto, no deberías tener tanto
  stock" → **depende del punto 2 de la sección 3** (implementar el
  desenlace `'ignorado'`) para tener la señal de qué productos quedan sin
  usarse repetidamente. Reparto de responsabilidad (decisión 2026-07-30):
  `AgenteAprendizaje` calcula el patrón (usando `addedDate` + historial de
  desenlaces), `AgenteCompras` lo muestra al momento de comprar. No es del
  `AgenteCocinero`.

### Escala hotel/restaurante
- Mencionado como posible caso de uso futuro. Implica: mayor volumen de
  stock, productos repetidos por lote/proveedor, posible necesidad de
  roles/multi-usuario (relacionado con el punto 3 de inconsistencias:
  cerrar el contrato de `edit` en todos los agentes antes de abrir edición
  a varios usuarios).

---

## 5. Próximos pasos sugeridos

1. ~~Diseñar el nuevo comportamiento de `AgenteCocinero`: función que separe
   "productos próximos a vencer" en (a) receta combinada que los use todos,
   (b) recetas independientes por producto~~ → **hecho** (`recetasParaVencer`,
   sección 4, y enganchado a la UI + IA en sección 7).
2. Implementar el desenlace `'ignorado'` en `evaluador.js` +
   `aprendizaje.js` + `impacto.js`, y una función que detecte "stock que se
   repite y no se consume" usando `addedDate` + historial de desenlaces.
   **Sigue pendiente** — es la pieza que falta para "no consumís tanto, no
   deberías tener tanto stock" (visión de producto, sección 4).
3. Unificar `compras.js` para reutilizar `AgenteCocinero.inventarioDisponible`
   en vez de reimplementar el filtro/dedup. **Sigue pendiente.**
4. Evaluar si conviene una allowlist de campos en `AgenteHogar.editar`
   antes de pensar en multi-usuario. **Sigue pendiente.**
5. Migrar la memoria de `localStorage` a Firestore para que varios
   dispositivos compartan una misma despensa (ver sección 7) — necesario
   para el caso hotel/restaurante, no para la entrega del TP.

---

## 6. Trabajo práctico (UTN FRBA) — entrega final

Este proyecto es el TP de "Inteligencia Artificial Aplicada a
Organizaciones". Hay un `PLAN_ENTREGA_FINAL.md` en la raíz (fecha límite
17/08/2026) que mapea día a día contra la grilla de evaluación de la
consigna. Estado relevado el 2026-07-30 contra esa grilla:

- ✅ **App funcionando (30%)**: publicada en GitHub Pages, repo público con
  historia de commits real (35 commits a esa fecha).
- ✅ **Arquitectura (20%)**: `docs/DIAGRAMAS.md` tiene arquitectura general,
  flujo de agentes y tres UML (secuencia, casos de uso, modelo de datos).
- ✅ **Parte 2 — IA local (20%)**: `docs/PARTE_2_IA_LOCAL.md` completo y
  fundamentado con las 4 preguntas. Falta sólo la captura de terminal de
  Ollama (bonus opcional).
- ❌ **UX/UI · Nielsen (20%)** y **Ciberseguridad (10%)**: sin escribir
  todavía como documento (el plan tiene contenido borrador, programado
  para 11/08 y 12/08 respectivamente).
- ❌ Secciones 1 y 7 de la consigna (presentación del equipo, IAs usadas en
  el co-work + reflexión) y `docs/capturas/` (evidencia, mín. 3 capturas +
  log de sesión real): no encontré ningún archivo que las cubra todavía.

**Hecho el 2026-07-31**: `README.md` y `docs/DIAGRAMAS.md` estaban
desactualizados (describían Tesseract.js como motor de OCR principal y
"112 pruebas" en 4 suites) — corregido para reflejar PP-OCR + Tesseract de
respaldo y las 211 pruebas reales en 7 suites.

### Discusión abierta — límite de las 27 recetas fijas

`js/recipes.js` tiene 27 recetas escritas a mano (con pasos completos),
que en conjunto usan sólo 35 ingredientes distintos. `recetasParaVencer`
(sección 4) busca únicamente ahí, así que con productos fuera de esos 35
nombres no encuentra combo ni individuales. `docs/PARTE_2_IA_LOCAL.md` ya
señala esto: *"un recetario fijo no es un agente cocinero, es una tabla de
consulta"* — y por eso existe `AgenteGenerador` (LLM local), pero hoy no
está conectado al camino de `recetasParaVencer`.

**Decisión tomada (ver sección 7): opción 1 (conectar con IA generativa),
implementada.** La opción 2 (más recetas a mano) sigue abierta como
complemento, no se hizo.

---

## 7. IA unificada — implementado 2026-08-06

Contexto de la decisión: se detectó en vivo que ni el escáner de fecha
(troquelado sin tinta, falla incluso con linterna) ni el cocinero (27
recetas fijas) cumplían su función real. Se evaluaron variantes (proxy
propio en Cloudflare Workers, Firebase AI Logic, un documento externo de
arquitectura multiagente en Python) — el análisis completo está en
[`docs/PROPUESTA_IA_UNIFICADA.md`](PROPUESTA_IA_UNIFICADA.md). Decisión:
**un solo proveedor de IA (`AIProvider`) compartido entre Captura y
Cocinero, motor Gemini vía Firebase AI Logic** (sin backend propio: App
Check autentica la app, no una clave expuesta) **+ Ollama como alternativa
local ya existente**, no reemplazada.

### Qué se construyó

- **`js/agents/aiProvider.js`** (nuevo): interfaz única (`generarTexto`,
  `generarConImagen`, `parsearJSON`, `disponible`, `soportaImagenes`,
  `usarMotorFalso`). Motores: `ninguno` / `ollama` (texto) / `gemini`
  (texto + imagen, vía el puente `<script type="module">` en `index.html`
  que expone `window.__firebaseAI`).
- **`generador.js` refactorizado**: ya no gestiona su propia conexión al
  modelo, delega todo en `AIProvider` (mismo comportamiento externo,
  `configurar/leerConfig/disponible/usarMotorFalso/parsearJSON` quedaron
  como fachada fina para no romper a quien ya los llamaba).
- **`generador.js` → `generarParaVencer(enriquecidos, prioritarios)`**
  (nuevo): prompt que exige usar TODOS los productos obligatorios, y el
  código vuelve a verificar la cobertura después de `validar()` — un
  modelo que "se olvida" de un producto se descarta igual, aunque la
  receta sea válida en todo lo demás.
- **`captura.js` → `leerConVisionIA(fuente)`** (nuevo): respaldo de visión,
  último recurso, nunca automático. Antes de gastar una llamada paga
  chequea `cuadroSinContenido` (mismo umbral que ya usaba el OCR local) —
  si la foto no tiene contraste, ni una IA va a leer lo que la imagen no
  capturó, y se avisa sin llamar a nada. El texto que devuelve el modelo
  pasa por `extraerFecha()`, la misma validación de forma/plausibilidad
  que ya existía: el modelo no se salta ningún control por venir de una
  vía distinta.
- **`captura.js` → `identificarDesdeIA(cruda)`** (2026-08-15): el respaldo
  de visión pasó de **transcribir** a **identificar**. El prompt anterior
  pedía "transcribí el texto y el nombre del producto", y un envase tiene
  decenas de textos —eslogan, peso neto, "sin TACC", tabla nutricional—:
  devolvía el que estuviera impreso más grande, el mismo defecto que la
  suite `nombre.test.js` ya había corregido para el OCR local. Ahora se le
  piden campos separados (`producto`, `marca`, `categoria`,
  `fechaVencimiento`, `textoVisible`) y el nombre se arma acá con el tipo
  adelante, que es como lo matchea el Cocinero. El veto determinístico
  cubre las tres salidas: la categoría sólo pasa si está en la lista
  cerrada de 9 del formulario, el nombre se cruza contra `TIPOS_PRODUCTO`
  y **gana el catálogo local** sobre lo que haya dicho el modelo (si no
  comparten categoría, el producto queda fuera de las recetas), y la fecha
  sigue pasando por `extraerFecha()`. Pedir la fecha en un campo propio
  además evita que la expresión regular tenga que elegir entre el lote, la
  elaboración y el vencimiento dentro de un mismo bloque de texto.
  De paso se corrigió un caso que descartaba un producto correctamente
  identificado cuando `textoVisible` venía vacío — justo la foto del
  frente del envase. Cubierto por 12 chequeos nuevos entre
  `tests/nombre.test.js` y `tests/aiProvider.test.js`.
- **`db.js`**: `generadorConfig` renombrado a `aiProviderConfig` (STORES,
  exportAll, importAll) — es donde vive la config de motor ahora.
- **UI (`index.html` + `main.js`)**:
  - Preferencias → "IA generativa": selector de motor con campos según
    corresponda (Ollama: url/modelo; Gemini: JSON de Firebase, clave de
    reCAPTCHA de App Check, modelo).
  - Recetas → nueva sección "Para lo que se vence ahora" (sólo con 2+
    productos prioritarios): combo del catálogo fijo si existe, botón
    "Generar con IA" si no, e igual por cada producto individual sin
    receta propia.
  - Panel "Foto fecha" → botón "Leer con IA" que aparece sólo si el OCR
    local no llegó a `'ok'` y hay motor Gemini configurado.
- **`tests/aiProvider.test.js`** (nuevo, 15 pruebas): config anidada,
  motor falso, `foto_ilegible` sin gastar llamada, `extraerFecha()`
  aplicada al texto del modelo, y el caso central — receta que no cubre
  todos los obligatorios se rechaza aunque sea válida.
- Suite completa: **226/226 pruebas en verde** (211 previas + 15 nuevas)
  tras el refactor.

### Verificado de punta a punta — 2026-08-06

Se completó la configuración real (proyecto Firebase con cuenta personal,
sin plan Blaze necesario para "Gemini Developer API", App Check con
reCAPTCHA v3) y **`AgenteGenerador.generar()` con motor Gemini funcionó**:
generó recetas nuevas usando sólo ingredientes reales de la despensa,
marcadas "inventada", pasando por `validar()`. Confirma la cadena completa
Firebase → Gemini → veto determinístico → UI.

**Dos bugs reales encontrados y corregidos en el camino** (material
concreto para la Sección 7 del TP — co-work con IA, qué salió mal):

1. **El puente de módulo ES en `index.html` apuntaba a una URL de
   `gstatic.com` con versión (`11.6.0`) donde `firebase-ai.js` no existía
   — 404 real**, no un error de configuración del usuario. Se probó
   primero cambiar a jsDelivr (`/+esm`), que sí resolvía el archivo pero
   rompía en runtime con `"Service ai is not available"`: cada endpoint
   `/+esm` empaqueta su propia copia interna de `@firebase/app`, así que
   `initializeApp()` y `getAI()` terminaban mirando dos registros internos
   distintos. La solución fue volver a `gstatic.com` (que sí comparte una
   sola instancia entre los tres módulos, por diseño) con una versión
   **verificada a mano** (`12.17.1`), no adivinada.
2. **El modelo por defecto (`gemini-2.0-flash`) estaba dado de baja** del
   lado de Google al momento de probarlo. Cambiado a `gemini-3.6-flash` en
   `aiProvider.js`, `main.js` e `index.html`. Lección para el informe: un
   nombre de modelo hardcodeado en el código puede quedar obsoleto sin que
   nada en el proyecto avise — vale la pena mencionarlo como limitación
   conocida (mantenimiento de un motor de IA en la nube).

Ninguno de los dos bugs estaba en la lógica de la app (agentes, veto,
tests) — los 226 tests siguieron en verde todo este tiempo. Estaban en la
integración con un servicio externo, que es exactamente el tipo de cosa
que no se puede testear sin red real.

### Bug 3 (grave) y solución final — 2026-08-07

Al probar en dispositivos reales (celular, luego confirmado también desde
Chrome de escritorio) apareció un tercer problema, más serio que los dos
anteriores: **reCAPTCHA v3 fallaba de forma intermitente**, con dos
síntomas distintos según el momento (`appCheck/recaptcha-error` cuando
reCAPTCHA no lograba generar ningún token; `[401] Firebase App Check token
is invalid` cuando sí generaba uno pero el servidor lo rechazaba). Rompía
**tanto** la generación de recetas como el respaldo de visión por igual,
sin importar si App Check estaba en modo "Supervisada" o "Aplicada".

**Camino recorrido hasta la causa real:**
1. Primera hipótesis (equivocada): re-inicialización de Firebase en cada
   uso. Descartada — `modeloGemini` ya cachea el resultado, y el error
   real nunca fue "Firebase App named '[DEFAULT]' already exists" (el que
   correspondería a ese bug).
2. Segunda hipótesis (parcialmente cierta): condición de carrera —
   `initializeAppCheck()` no espera a que reCAPTCHA termine su primer
   desafío antes de que salga la primera llamada real. Se corrigió
   esperando el token explícitamente (`getAppCheckToken`) — necesario
   pero no suficiente.
3. **Regresión propia**: la primera versión de ese fix **cortaba con una
   excepción si la espera del token fallaba**, lo cual bloqueaba TODO sin
   importar el modo de App Check — antes, en "Supervisada", un token
   fallido simplemente no bloqueaba nada; después, sí. Se corrigió para
   que un fallo de reCAPTCHA sólo loguee un `console.warn`/`console.error`
   y la llamada real se intente igual.
4. **Evidencia decisiva**, con DevTools reales (Network + Console, tanto
   en el celular como en Chrome de escritorio): la llamada de verificación
   de Google (`POST google.com/recaptcha/api2/clr?k=...`) devolvía **400
   Bad Request de forma reproducible**, con dominio y clave confirmados
   correctos. Coincide con un issue abierto y sin resolver en el propio
   `firebase-js-sdk` (**#9135**: fallos de reCAPTCHA v3 con App Check,
   reportado en navegadores/modos variados). No es un bug de este
   proyecto — es de Google/Firebase.

**Solución aplicada**: reemplazar reCAPTCHA v3 por un **token de
depuración fijo** de App Check (generado y registrado a mano en Firebase
Console, guardado en `aiProvider.js` junto con el resto del default de
fábrica, también en base64). `self.FIREBASE_APPCHECK_DEBUG_TOKEN` se
setea antes de `initializeAppCheck`, así Firebase omite reCAPTCHA por
completo. **Confirmado funcionando** — la generación de recetas con
Gemini volvió a andar de punta a punta.

**Trade-off, para dejarlo explícito**: un token de depuración es
literalmente "confiá en cualquiera que tenga este valor" — mucho más
débil que una atestación real. reCAPTCHA queda en el código
(`initializeAppCheck` lo sigue recibiendo como provider) pero **inactivo
en la práctica**: el token de depuración lo pisa. La protección real que
sigue en pie es la restricción de dominio de la clave de API en Google
Cloud Console (configurada en una sesión anterior). Material honesto y
concreto para la Sección 6 (Ciberseguridad) del TP: riesgo identificado
(bypass de App Check si alguien extrae el token del código público),
medida de mitigación parcial (restricción de dominio como respaldo),
decisión consciente de aceptar el trade-off por el plazo de entrega, con
plan de revisar reCAPTCHA/otro proveedor de atestación más adelante.

**Pendiente de confirmar**: "Leer con IA" (respaldo de visión) con esta
misma solución — debería funcionar igual al usar el mismo `AIProvider`,
pero conviene probarlo explícitamente antes de darlo por cerrado.

### Decisión: config de Gemini "de fábrica", no por usuario — 2026-08-06

Motivo: si cada persona que abre el link publicado (incluido el docente
evaluando el TP, que abre el link *solo*, sin el alumno al lado — así lo
dice la consigna) tiene que crear su propio proyecto Firebase antes de ver
la IA funcionando, en la práctica nadie más que el alumno la va a ver
andar. Se cambió `AIProvider` para traer un proyecto Firebase provisto por
la app como default (`motor: 'gemini'` de entrada, con `firebaseConfig`
embarcado en el código, codificado en base64 para no dejarlo como texto
plano grepeable). Un usuario puede seguir apagándolo o pegando su propio
proyecto en Preferencias — eso sigue pisando el default.

Esto cambió la narrativa de "opt-in explícito por usuario" que tenía
`PARTE_2_IA_LOCAL.md` — se actualizó esa sección para explicar que el
consentimiento real pasó a estar en el momento de tocar cada botón
("Crear receta con IA" / "Leer con IA"), no en si hay o no una config
guardada. Documentado también en el `README.md` y en el propio texto de
ayuda de Preferencias en `index.html`.

Recomendación pendiente para el usuario (no es código): restringir la
API key por dominio en Google Cloud Console → APIs y servicios →
Credenciales, para que sólo funcione desde los orígenes reales de la app.

### Impacto en la rúbrica del TP (actualiza sección 6)

- `PARTE_2_IA_LOCAL.md` ganó una sección 5 ("Revisión: cuándo SÍ conviene
  la nube") que concilia el argumento pro-privacidad original con esta
  decisión — no lo contradice, lo refina.
- `docs/DIAGRAMAS.md` (arquitectura general) actualizado: nuevo nodo de
  respaldo de visión, `IA2` renombrado a `AIProvider`, veto ahora incluye
  "cobertura completa".
- README actualizado: stack, "qué es real y qué no", limitaciones, conteo
  de tests (226 en 8 suites).

### Mejora de UI pendiente (anotada, no implementada) — 2026-08-11

En el panel "Escáner", el botón "Leer con IA" (y "Escribir la fecha a
mano") quedan varias pantallas de scroll por debajo de la cámara — el
usuario que no scrollea nunca se entera de que existen. Se probó achicar
la cámara con `max-height` + `object-fit: contain`, pero eso rompió el
recuadro que dibuja `html5-qrcode` (mide el contenedor una sola vez, al
arrancar, y queda desalineado si el tamaño cambia por CSS después) — se
revirtió (commits `7ef02b6`, `64e49b1`, `ea8f542`).

**Propuesta acordada, sin implementar todavía**: en vez de tocar el
tamaño de la cámara, mover "Leer con IA" y "Escribir la fecha a mano" a
una barra fija (`position: sticky`) pegada arriba de la barra de
navegación inferior — visible sin scrollear, sin tocar la cámara ni el
ROI del OCR en absoluto. Es el patrón estándar en apps de escaneo
(acción secundaria/fallback siempre visible, nunca escondida). Maqueta de
referencia armada como Artifact (comparación antes/después con los
colores reales de `styles.css`) — pedir el link si se retoma, no quedó
guardado en el repo por ser sólo una vista previa.

Próximo paso si se retoma: implementar la barra fija en
`css/styles.css` (`.sticky-actions`, con `position: sticky; bottom:` la
altura de `.tabbar`) y mover los botones `auto-ocr-ia-cont` y
`auto-manual` de `index.html` ahí, sin tocar `.scan-stage`.

### El Cocinero completa con lo que ya hay en la casa — 2026-08-15

**Problema.** El Generador ya recibía la despensa entera (`disponibles` =
todo lo no vencido), así que técnicamente podía combinar lo que vence con
el resto. Pero faltaban las dos mitades que hacen que eso sirva:

1. El prompt sólo insistía en los productos obligatorios y agregaba un
   tibio "podés sumar otros si hace falta". Un modelo al que se le dice
   "usá la espinaca" devuelve *espinaca salteada* — cuando el usuario
   tenía queso y huevos ahí al lado para una tarta.
2. La receta se mostraba como una lista plana de ingredientes. El usuario
   igual tenía que ir a revisar la heladera para saber si le alcanzaba,
   que es justo el trabajo que la app promete ahorrarle.

**Solución, repartida según quién sabe qué.**

- `generador.js` → `armarPrompt`: la lista de la despensa ahora lleva la
  ubicación (`- queso (en Heladera, vence en 20 día/s)`) y el pedido
  explícito de completar el plato con el resto. La ubicación no es
  decorativa: lo que está en el Freezer necesita descongelarse, y una
  receta que no lo dice no se puede seguir — el prompt lo exige como
  primer paso.
- `cocinero.js` → `desglosarIngredientes(receta, invMap, prioritarios)` y
  `fraseDisponibilidad(desglose)` (nuevos): separan lo que se vence, lo
  que complementa desde el stock (agrupado por dónde ir a buscarlo) y lo
  que falta comprar. **Es cálculo determinístico sobre el inventario, no
  algo que se le pregunte al modelo**: la ubicación la cargó el usuario y
  el sistema ya la sabe. Al modelo se le pide la receta, no el estado de
  la despensa. Vale igual para recetas del catálogo y generadas.
- `evaluarCandidatas` adjunta `desglose` a cada candidata, así que la UI
  no reconstruye inventario por su cuenta.
- UI (`#rd-despensa` en el detalle, y la tarjeta del combo): *"Se hace con
  espinaca que se te vence, queso y huevos que tenés en la heladera y
  arroz que tenés en la alacena. No te falta nada."*

**Qué NO se hizo, a propósito.** No se le pide al modelo que informe
ubicaciones ni faltantes. Pedirle un dato que uno ya tiene es la forma
más fácil de que lo devuelva mal, y encima no se puede verificar sin
volver al inventario — con lo cual conviene leerlo del inventario y
listo. Mismo criterio que el resto del archivo: el modelo propone la
receta, el código dice la verdad sobre la despensa.

19 chequeos nuevos entre `tests/recomendacion.test.js` y
`tests/generacion.test.js` (266 en total, 8 suites). sw `v41`.
