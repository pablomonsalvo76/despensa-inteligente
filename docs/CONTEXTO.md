# Contexto de trabajo — Despensa Inteligente

> Registro vivo de qué se revisó, qué se arregló y hacia dónde va el proyecto.
> Última actualización: 2026-07-30.

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

1. Diseñar el nuevo comportamiento de `AgenteCocinero`: función que separe
   "productos próximos a vencer" en (a) receta combinada que los use todos,
   (b) recetas independientes por producto, reutilizando la regla de
   inventario disponible de `cocinero.js` (y corrigiendo `compras.js` para
   que use la misma, ver sección 3, punto 1).
2. Implementar el desenlace `'ignorado'` en `evaluador.js` +
   `aprendizaje.js` + `impacto.js`, y una función que detecte "stock que se
   repite y no se consume" usando `addedDate` + historial de desenlaces.
3. Unificar `compras.js` para reutilizar `AgenteCocinero.inventarioDisponible`
   en vez de reimplementar el filtro/dedup.
4. Evaluar si conviene una allowlist de campos en `AgenteHogar.editar`
   antes de pensar en multi-usuario.
