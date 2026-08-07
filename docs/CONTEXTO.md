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

### Lo que falta para que esto funcione de punta a punta

**Depende del usuario, no es código pendiente**: crear el proyecto en
Firebase Console (cuenta Google + plan Blaze), activar Firebase AI Logic
y App Check (reCAPTCHA v3), y pegar esa configuración en Preferencias. Sin
eso, la app sigue funcionando entera con el recetario y el OCR locales —
nada se rompe por no tenerlo, sólo no aparecen los botones de IA en la
nube.

### Impacto en la rúbrica del TP (actualiza sección 6)

- `PARTE_2_IA_LOCAL.md` ganó una sección 5 ("Revisión: cuándo SÍ conviene
  la nube") que concilia el argumento pro-privacidad original con esta
  decisión — no lo contradice, lo refina.
- `docs/DIAGRAMAS.md` (arquitectura general) actualizado: nuevo nodo de
  respaldo de visión, `IA2` renombrado a `AIProvider`, veto ahora incluye
  "cobertura completa".
- README actualizado: stack, "qué es real y qué no", limitaciones, conteo
  de tests (226 en 8 suites).
