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
   → **Corregido el 2026-08-15**: `compras.js` reutiliza
   `AgenteCocinero.inventarioDisponible` + `inventarioPorIngrediente`. Se
   hizo al arreglar el caso "milanesa" (ver más abajo), donde el defecto
   dejó de ser teórico: la lista de compras mandaba a comprar carne
   teniendo una milanesa en el freezer, contradiciendo a la pantalla de
   recetas que acababa de decir que alcanzaba.

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

### Estado actualizado — 2026-08-15

El relevamiento de arriba quedó viejo y se conserva sólo como registro de
por dónde se empezó. Lo que vale hoy:

- ✅ **UX/UI · Nielsen (20%)** → `docs/UX_NIELSEN.md`, las 10 heurísticas.
  **Pendiente adentro**: la sección 5.2 pide una prueba informal con una
  persona que no haya visto la app. Es el único hueco del documento.
- ✅ **Ciberseguridad (10%)** → `docs/CIBERSEGURIDAD.md`, 7 riesgos,
  incluida la degradación honesta de App Check.
- ✅ **Secciones 1 y 7** → `docs/EQUIPO_Y_COWORK.md`.
- ❌ **`docs/capturas/`**: sigue vacía (sólo el README con la checklist).
  Es lo único con un ❌ duro sobre la grilla, y pesa dentro del 30% de
  "app funcionando". Requiere el celular del autor: no se puede generar
  desde el repositorio.

**Hecho el 2026-07-31**: `README.md` y `docs/DIAGRAMAS.md` estaban
desactualizados (describían Tesseract.js como motor de OCR principal y
"112 pruebas" en 4 suites) — corregido para reflejar PP-OCR + Tesseract de
respaldo y las 211 pruebas reales en 7 suites.

**Hecho el 2026-08-15**: el README volvió a quedar viejo con el conteo de
pruebas (decía 226) — corregido a las **324 reales en 8 suites**, contadas
una por una. Un número inflado en el documento que lee el docente es
exactamente el tipo de detalle que destruye la credibilidad del resto.

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

### "Tengo una milanesa pero no tengo carne" — 2026-08-15

**Síntoma reportado.** Con tres productos cargados (arroz, puré de tomate,
milanesa) el Cocinero casi no ofrecía nada y la IA "no generaba nada", sin
ningún error visible en pantalla.

**Reproducido antes de tocar código** (script en scratchpad, no versionado):

```
claves del inventario:  [ 'arroz', 'pure de tomate', 'milanesa' ]
recetas del catálogo:   [ 'Arroz con verduras salteadas' ]   <- 1 de 27
combo para lo que vence: null
respuestas del modelo:
  "Milanesa a la napolitana"  -> RECHAZADA: usa ingredientes que no tenés: aceite
  "Arroz con carne y tomate"  -> RECHAZADA: usa ingredientes que no tenés: carne, tomate
```

**Tres causas independientes, todas reales:**

1. **No había capa de equivalencia entre el producto y el ingrediente.** El
   recetario piensa en 35 genéricos (`carne`, `tomate`, `fideos`); la
   despensa real dice "Milanesa", "Puré de tomate", "Tirabuzón". La app
   tenía una milanesa venciendo en el freezer y sostenía que no tenía
   carne. Rompía las dos capas a la vez: el catálogo no matcheaba, y el
   validador del Generador rechazaba la respuesta del modelo justo cuando
   éste escribía "carne", que es como se escriben las recetas.
2. **`aceite` no estaba entre los básicos.** Nadie carga el aceite en una
   app de vencimientos —no vence, no se compra semanalmente— pero sin él no
   se fríe ni saltea nada, así que el validador vetaba justamente las
   recetas correctas.
3. **La lista de compras tenía el mismo defecto** y mandaba a comprar carne
   teniendo la milanesa.

**Solución: `AgenteCocinero.canonizar(nombre)`.** Traduce el nombre real al
ingrediente que el recetario entiende. La lista de ingredientes conocidos se
DERIVA de `RECIPES`, así que no queda desincronizada si se agregan recetas.
Orden de resolución, de más específico a menos:

1. coincidencia exacta;
2. excepciones (`dulce de leche` NO es leche — tenerlo hacía creer al
   sistema que había leche y ofrecía recetas imposibles);
3. alias de varias palabras (`bife de chorizo` → carne, y no `chorizo`,
   que es un ingrediente real del recetario — lo encontró un test);
4. la palabra genérica dentro del nombre comercial (`puré de tomate` →
   tomate, `milanesa de pollo` → **pollo**, no carne);
5. alias sueltos (`milanesa`, `nalga`, `muzzarella`, `tirabuzón`…).

Si no reconoce nada devuelve el nombre tal cual: nunca inventa una
equivalencia para forzar un match.

**Dos decisiones de diseño que importan:**

- **`inventarioPorIngrediente` es un índice SEPARADO de
  `inventarioNormalizado`.** Son dos preguntas distintas y mezclarlas rompe
  una: "qué productos tengo" se recorre por valores y cada producto tiene
  que aparecer una vez; "¿tengo carne?" se consulta por clave y un producto
  puede responder a varios nombres. Colapsando todo en un solo mapa, tener
  milanesa y bife hubiera hecho desaparecer uno de los dos de "Para lo que
  se vence ahora".
- **Un producto "de soja" nunca se resuelve a carne**, aunque se llame
  milanesa: mapearlo le bloquearía al vegetariano de la casa una receta que
  sí puede comer.

**Riesgo que introduce la traducción, y cómo se cierra.** Comparar por
ingrediente canónico podía abrir un agujero en el filtro de alergias: quien
declaró "milanesa" recibiría una receta con `carne` porque los textos no
coinciden. Se canonizan también las alergias, en los tres lugares donde se
verifican (`generador.validar`, `cocinero.cumpleRestricciones`,
`hogar.evaluarReceta`). Canonizar sólo puede bloquear de más, nunca de
menos, que es el único lado hacia el que un filtro de alergias puede
equivocarse. La lista cerrada sigue cerrada: un ingrediente inventado no se
canoniza a nada de la despensa y se rechaza igual que antes.

28 chequeos nuevos, varios adversarios (ingrediente inventado, alergia por
nombre comercial, milanesa de soja, no aceptar pollo por tener carne). 302
en total, 8 suites. sw `v42`.

### El validador contra su propio prompt — 2026-08-15

**Síntoma.** «No salió ninguna receta que pase los controles. Motivo: usa
ingredientes que no tenés: mayonesa hellmanns clasica» — teniendo la
mayonesa cargada. El mensaje llevaba a pensar que el modelo había
inventado un producto; era exactamente al revés.

**Cómo se descartó la hipótesis del "producto inventado"**: el prompt y la
lista cerrada se arman del **mismo** `inventarioDisponible()`
([generador.js](../js/agents/generador.js), `generar`), así que no hay
camino por el que el modelo vea un nombre que el validador no tenga. Y una
marca con su variante ("hellmanns clasica") no se alucina: sale del nombre
del producto del usuario.

**Causa real.** `sanitizar()` limpia los nombres antes de meterlos en el
prompt (defensa contra inyección), pero la lista cerrada se armaba con el
nombre **sin sanear**. El modelo sólo puede copiar lo que ve:

```
clave del validador : "mayonesa hellmann's clasica"
en el prompt dice   : "mayonesa hellmanns clásica"   <- sin apóstrofo
```

El validador rechazaba la respuesta correcta a una pregunta que él mismo
había hecho mal. Dos variantes del mismo defecto: el recorte a 40
caracteres partía nombres largos al medio, y el genérico "mayonesa" —como
se escriben las recetas de verdad— tampoco tenía clave, porque `mayonesa`
no está entre los 35 ingredientes del recetario.

**Solución: `AgenteCocinero.buscarEnDespensa(ingrediente, índice)`.**
Resuelve un ingrediente escrito contra la despensa en tres formas, de más
estricta a menos: clave exacta → clave con la puntuación aplanada →
prefijo por **palabras completas** ("mayonesa" resuelve a "Mayonesa
Hellmanns Clásica", apoyándose en que el nombre se arma con el tipo
adelante). Por palabras y sólo como prefijo, nunca por contención: `sal`
no resuelve a `salchicha` ni `leche` a `dulce de leche` — los dos están
cubiertos por tests. El apóstrofo se borra en vez de separar, porque es lo
que hace el saneo del prompt. Y `sanitizar()` ahora recorta por palabra.

La lista cerrada sigue cerrada: `buscarEnDespensa` sólo resuelve a
productos que están en la despensa; un ingrediente inventado no resuelve a
nada.

**El reverso, que es la parte delicada.** Aflojar el emparejamiento de
ingredientes obliga a aflojar el de alergias en la misma medida, o se abre
un agujero: quien declaró "Mayonesa Hellmann's" recibiría una receta que
dice "mayonesa". Se agregó `esMismoAlimento(a, b)` —prefijo por palabras
en cualquier dirección, bloquea de más y nunca de menos— y se usa en los
tres lugares donde se verifican alergias (`generador.validar`,
`cocinero.cumpleRestricciones`, `hogar.evaluarReceta`).

**Mensaje corregido**: «usa ingredientes que no tenés» era ambiguo entre
"los inventó" y "no los pude relacionar". Ahora dice «inventó ingredientes
que no están en tu despensa», que es lo único que puede pasar una vez
resuelto lo anterior.

10 chequeos nuevos (312 en 8 suites). sw `v43`.

### Límite de cuota gratuita y errores legibles — 2026-08-15

**No es un bug del código**: Gemini devolvió `429 RESOURCE_EXHAUSTED`
(`generate_content_free_tier_requests`, limit 20). Es el plan gratuito
funcionando como corresponde. Sí eran defectos las dos formas en que la
app lo comunicaba.

**1. Se imprimía el volcado del error HTTP completo.** JSON anidado, links
a documentación, nombres de métrica de cuota — ocupaba la pantalla entera
y no decía lo único que importa: si es culpa del usuario, si se arregla
solo, y qué puede hacer mientras tanto. Nuevo
`AIProvider.traducirError(e)`, aplicado en `invocarGemini` para que valga
igual en recetas y en visión:

| Error | Mensaje |
|---|---|
| 429 con tiempo | «Se llegó al límite de uso gratuito del modelo. Probá de nuevo en 9 segundos.» |
| 429 sin tiempo | «Se agotó la cuota gratuita… El recetario sigue funcionando sin el modelo.» |
| 5xx | «El modelo está sobrecargado. Probá de nuevo en un minuto.» |
| 401/403 | «Rechazó la credencial. Revisá Preferencias → IA en la nube.» |
| Sin red | «No se pudo conectar… El recetario funciona igual sin internet.» |

El detalle completo sigue yendo a la consola, que es donde sirve. El orden
de los chequeos importa: el mensaje de cuota incluye la palabra "API" y un
link, así que el chequeo de credenciales tiene que ir después del de cuota
o se lo queda él.

**2. El encabezado mentía.** Decía «No salió ninguna receta que pase los
controles» aunque el modelo no hubiera contestado nunca — mandaba al
usuario a buscar un problema en su despensa que no existía. Ahora
`generar`/`generarParaVencer` marcan `fallaDelModelo: true` cuando el
motor falla, y la UI distingue los dos casos (`motivoGeneracion` en
main.js, más los dos handlers de "Para lo que se vence ahora").

**Nota para la defensa**: este incidente es evidencia directa de por qué
la arquitectura en dos capas no es decorativa. Con la cuota agotada, el
recetario fijo siguió respondiendo sin conexión y sin modelo. Es el "piso
garantizado" haciendo exactamente lo que promete.

11 chequeos nuevos (323 en 8 suites). sw `v44`.

### El bucle de los 50 segundos — 2026-08-15

**Síntoma**: «esperá 50 segundos», se esperan, y vuelve a empezar la cuenta.
Nunca se libera.

**Causa.** Hay DOS cuotas gratuitas distintas y el error las reporta casi
igual, con un `retryDelay` de pocos segundos en los dos casos:

| Cuota | Se libera |
|---|---|
| Por minuto (RPM) | esperando los segundos que indica |
| **Por día (RPD)** | **a la medianoche del Pacífico** (~5 AM en Argentina) |

Confirmado en la documentación de Google: *"Requests per day (RPD) quotas
reset at midnight Pacific time"* y *"Rate limits are applied per project,
not per API key"*. Con la cuota diaria agotada, esperar el `retryDelay` no
sirve: se vuelve a fallar y a mostrar otra espera corta. La app repetía esa
promesa falsa y mandaba al usuario a esperar para fallar de nuevo.

`traducirError` ahora mira el nombre de la métrica (`..._per_day`) y dice
la verdad: se renueva mañana. Y en el caso por minuto agrega «si vuelve a
pasar, es el tope diario», porque no siempre se puede distinguir.

**Y una causa de consumo que era nuestra.** `generar` y `generarParaVencer`
usaban `intentos = 2`: si la primera receta no pasaba el validador, se le
volvía a pedir al modelo en silencio. Contra Ollama eso es gratis —corre en
la máquina del usuario— pero contra Gemini **cada intento consume un pedido
de una cuota que se mide por día**. Cada clic gastaba dos, y se llegaba al
tope con la mitad de los clics. Ahora `intentosPorDefecto()` devuelve 1 con
Gemini y 2 con Ollama.

**Presupuesto real a tener en cuenta**: la cuota es POR PROYECTO y la
comparten las recetas y el botón "Leer con IA" del escáner. Los límites
concretos del proyecto se ven en `aistudio.google.com/rate-limit`.

**Riesgo para la demostración**: si el profesor prueba la app después de
una sesión de pruebas, puede encontrarse la cuota agotada. Mitigaciones,
de menor a mayor esfuerzo: probar temprano en el día; habilitar facturación
en el proyecto (el uso real de una demo cuesta centavos y los límites suben
mucho); o apoyarse en que el recetario fijo funciona sin cuota ni conexión
—que es exactamente lo que la arquitectura en dos capas garantiza—.

5 chequeos nuevos (328 en 8 suites). sw `v45`.

### El recetario deja de ser fijo — 2026-08-15

**Planteo del autor**: *"no me gusta tener 35 recetas predefinidas por un
JSON, no es una buena solución"*. Correcto en el fondo, pero la salida no
era sacar el recetario: era hacerlo crecer.

**Por qué el piso fijo se queda.** Ese mismo día, a las 14:49, se agotó la
cuota gratuita de Gemini y las 27 recetas escritas a mano fueron lo único
que siguió respondiendo. No son sólo una limitación: son lo que evita que
la app quede muerta sin conexión o sin cuota.

**Qué se agregó.** Cada receta que el modelo genera y que `validar()`
aprueba se guarda (`recordarReceta` en `js/recipes.js`) y pasa a formar
parte del catálogo. Desde ese momento:

- aparece en el ranking junto a las 27 originales;
- está disponible **offline y sin gastar cuota**, para siempre — la receta
  que hoy cuesta un pedido de un plan que se mide por día, mañana es gratis;
- le enseña sus ingredientes a `AgenteCocinero.canonizar()`, que deriva de
  ahí lo que sabe cocinar: **el techo de los 35 ingredientes sube solo**;
- entra en el aprendizaje de gusto como cualquier otra, porque `validar()`
  ya le asigna `cocina`, `estilo` y `tipo`.

`catalogoRecetas()` y `buscarReceta(id)` reemplazan a `RECIPES` en los 8
lugares que lo consultaban (cocinero, aprendizaje, evaluador, compras,
main). Si alguno hubiera quedado sin migrar, lo aprendido sería invisible
justo para el agente que lo dejó afuera.

**Lo que NO hizo falta inventar**: un mecanismo para rechazar lo aprendido.
Si el usuario descarta una receta generada, `dismissedRecipes` la filtra
igual que a una fija. Y la seguridad no se relaja: la receta se guarda ya
validada, y se vuelve a filtrar contra alergias, pautas y perfil del hogar
**cada vez** que se sugiere, así que una alergia declarada mañana bloquea
una receta guardada ayer.

**Decisiones que no son obvias:**
- **Tope de 200 con desalojo protegido.** `localStorage` es compartido con
  el inventario, que es el dato que no se puede perder. Al llegar al tope
  se descartan las más viejas, pero **nunca una que el usuario cocinó**:
  esa dejó de ser una propuesta del modelo y pasó a ser su repertorio.
- **Deduplicación por ingredientes, no por nombre.** Lo que define una
  receta es lo que lleva, no cómo la tituló el modelo esa vez.
- **Cache en memoria de lo aprendido.** `canonizar()` consulta el catálogo
  por cada ingrediente de cada receta candidata; sin cache eran decenas de
  `JSON.parse` por render.

**Bug encontrado por el test nuevo**: `DB.exportAll()` enumera los stores
**a mano**, no desde `STORES`. Agregar `learnedRecipes` a `STORES` no
alcanzaba — el recetario aprendido no entraba en la copia de seguridad y
se perdía al cambiar de teléfono. Es *el mismo olvido* que ya se había
cometido con `stylePreferences`. Corregido en `exportAll` e `importAll`.

11 chequeos nuevos (335 en 8 suites). sw `v46`.

### La receta generada era un callejón sin salida — 2026-08-16

**Reportado por el autor**: la receta inventada no deja marcar si la
cocinaste o la descartaste.

**Por qué importa más de lo que parece.** El desenlace no es un detalle de
interfaz: es la **única** entrada del Agente de Aprendizaje. Sin él,
`stylePreferences` no suma ni resta afinidad, y `avoidedIngredients` no
cuenta el rechazo. El modelo podía proponer diez platos y el sistema seguía
sin aprender nada del usuario — justo en la capa que se supone más
inteligente.

**Causa.** El panel "Inventar una receta" (`sc-recetas`) dibujaba la receta
como HTML plano: título, etiqueta `inventada` y pasos. No había forma de
abrirla. La pantalla de detalle (`sc-receta`) sí tiene los botones
`rd-cook` / `rd-dismiss`, que llaman a `AgenteEvaluador.registrarDesenlace`
—y de ahí sale todo: descartar la saca del listado vía
`AgenteCocinero.descartarReceta`, y cocinar descuenta los ingredientes de
la despensa—. Simplemente no se llegaba a esa pantalla.

**Solución**: un botón por receta que abre el detalle de siempre, con
`candidataDesdeGenerada`. La receta inventada se trata igual que una del
recetario, que es exactamente lo que es una vez que pasó el validador.

**Efecto colateral que sólo funciona gracias al recetario que crece**: al
cocinar una receta generada, `descontarIngredientesDeReceta` la busca con
`buscarReceta(id)`. Antes de persistir lo generado esa búsqueda fallaba en
silencio y no descontaba nada. Ahora descuenta bien.

También se corrigió que `pan_rallado` se mostrara con guion bajo en el
aviso "Te falta:" — es una clave interna, no un texto para el usuario.
Apareció en una de las capturas de la entrega.

sw `v47`.

### El panel de la receta inventada no se enteraba del desenlace — 2026-08-16

Dos observaciones del autor sobre el botón agregado hace un rato, las dos
correctas:

**1. La etiqueta.** Decía *"Abrir receta — cociné o descarté"*. Se escribió
así para ser explicativa y terminó siendo un cartel: larga, con un guion en
el medio y fuera del tono del resto de la app, donde los botones dicen
"Ver receta", "Guardar producto", "Detener". Queda **"Abrir receta"**. Lo
que pasa adentro se descubre adentro; el botón sólo tiene que decir a dónde
lleva.

**2. Después de marcarla como cocinada, seguía en pantalla.** El panel
"Inventar una receta" es HTML estático que nadie vuelve a dibujar: al
volver de la pantalla de detalle, la receta seguía ahí intacta y el usuario
no tenía forma de saber si el desenlace se había registrado. Nuevo
`cerrarPanelGenerada(receta, confirmacion)`, llamado desde `rd-cook` y
`rd-dismiss`: limpia el panel y deja la confirmación en su lugar.

Sólo limpia **si la receta cerrada es la que estaba en el panel**. Marcar
una receta del recetario no tiene por qué borrar una propuesta del modelo
que el usuario todavía no decidió.

La receta no se pierde al limpiarse: quedó incorporada al catálogo (ver
"El recetario deja de ser fijo") y vuelve a aparecer entre las sugerencias.

sw `v48`.

### Cocinar no descontaba nada del inventario — 2026-08-16

**Reportado por el autor**: se marca una receta como cocinada y el producto
sigue en la despensa.

**Causa — y es un error introducido por mí el día anterior.** Al migrar los
agentes a la capa de ingrediente canónico se corrigieron el Cocinero, el
Generador y la lista de compras. En `evaluador.js` se cambió la búsqueda de
la receta (`RECIPES.find` → `buscarReceta`) pero **no se revisó el matcheo
interno**, que seguía comparando nombres literales:

```js
const norm = normalizeName(ing);              // 'carne'
activos.filter((p) => normalizeName(p.name) === norm)   // 'milanesa'
```

Con "Milanesa" en el freezer y `carne` en la receta no encontraba nada y no
descontaba. Migrar una familia de llamadas y dejar una afuera es peor que no
migrar ninguna: el sistema queda internamente inconsistente y el síntoma
aparece lejos del cambio.

**Por qué es el más grave de esta familia de defectos**: si el inventario
miente, mienten también las alertas, las recetas y la lista de compras,
porque todas se calculan sobre él. El README ya lo decía para otro caso —
*"Eliminar ≠ descartar. Si el inventario miente, todas las decisiones
posteriores son malas"*.

**Solución**: `descontarIngredientesDeReceta` resuelve con
`AgenteCocinero.buscarEnDespensa` sobre `inventarioPorIngrediente`, que
además conserva el criterio de consumir el más urgente entre productos
equivalentes. Se agregó un `Set` de ids ya descontados para que un mismo
producto no se descuente dos veces si dos ingredientes resuelven a él.

5 chequeos nuevos, incluida la regresión con Milanesa + `carne` y el control
de que no se toque un producto que la receta no usa (340 en 8 suites).

**Limitación que quedó documentada, no resuelta**: el inventario cuenta
unidades enteras. Para un paquete de fideos está bien; para la carne no,
que se consume por kilo. Medio kilo usado descuenta el producto entero.
Anotado en la Sección 9 del informe y conectado con la Sección 8, donde
"unidad y conversión" es el primer cambio necesario para gastronomía.

sw `v49`.
