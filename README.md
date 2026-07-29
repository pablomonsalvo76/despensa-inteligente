# Despensa Inteligente — implementación funcional

Esta carpeta contiene una app móvil (PWA) que implementa el diseño conceptual
del trabajo de medio ciclo "Despensa Inteligente: gestión agéntica de
inventario doméstico y prevención de desperdicio de alimentos".

## Cómo probarla

**En el celular (recomendado, para usar cámara real):**

1. Necesitás servirla por HTTPS o `localhost` — los navegadores bloquean el
   acceso a la cámara (`getUserMedia`) en `file://` o HTTP simple.
2. Opción rápida: subí la carpeta a [Netlify Drop](https://app.netlify.com/drop)
   (arrastrar y soltar, sin cuenta) o a GitHub Pages. Te da una URL HTTPS.
3. Abrí esa URL desde Chrome/Safari en el celular. Podés "Agregar a pantalla
   de inicio" para que se comporte como app instalada (PWA).

**En la compu, para revisar rápido sin cámara:**

```bash
cd despensa-inteligente
python3 -m http.server 8080
```

Abrí `http://localhost:8080`. La cámara funciona en `localhost` incluso sin
HTTPS. El ingreso manual y el chatbot funcionan siempre.

## Qué es real y qué es simulado

| Función | Estado |
|---|---|
| Inventario, semáforo, alertas, historial, log del ciclo | Real, con persistencia en `localStorage` |
| Ingreso manual | Real |
| Chatbot en lenguaje natural | Real, basado en reglas/regex (sin API de LLM, según lo definido para esta entrega) |
| Escaneo de código de barras | Real: usa la cámara (html5-qrcode) y resuelve el GTIN contra **Open Food Facts** (API pública, sin API key) |
| Foto + OCR de fecha de vencimiento | Real: usa la cámara y **Tesseract.js** (OCR en el navegador) para leer la fecha impresa |
| Agente Cocinero | Real, con matching por cobertura de ingredientes, urgencia, ingredientes críticos y filtros de alergias/dietas, contra una base local de ~27 recetas |
| Agente de Aprendizaje | Real: ajusta ingredientes evitados y ritmo de consumo por categoría a partir del historial |
| Notificaciones push | Notificaciones del navegador (`Notification` API) cuando hay productos críticos; no son push reales de servidor |
| Orquestador | Implementado como ciclo explícito en JS (Observación→Análisis→Planificación→Acción→Evaluación→Aprendizaje). El documento original prevé resolverlo con un motor tipo n8n en la entrega final; acá se ve la misma lógica de ciclo en la pestaña "Sistema" |

## Mapeo diseño → código

Cada agente descripto en la Sección 4 del documento tiene su archivo:

- `js/agents/inventario.js` — Agente de Inventario
- `js/agents/vencimientos.js` — Agente de Vencimientos (monitor)
- `js/agents/cocinero.js` — Agente Cocinero
- `js/agents/evaluador.js` — Agente Evaluador
- `js/agents/aprendizaje.js` — Agente de Aprendizaje
- `js/agents/captura.js` — Agente de Captura (manual, escaneo, foto/OCR)
- `js/agents/conversacional.js` — Agente Conversacional (chatbot)
- `js/agents/orquestador.js` — Orquestador del ciclo
- `js/agents/impacto.js` — Métricas de impacto (KPIs de la Sección 2)

La memoria persistente (Sección 6) vive en `js/db.js`, y la base de recetas
(Sección 3) en `js/recipes.js`.

## Decisiones de diseño alineadas al problema

El problema que la app resuelve es el desperdicio de alimentos en el hogar,
causado por falta de visibilidad del inventario y de planificación. Estas
funciones existen específicamente para atacarlo:

- **Panel de impacto (Historial).** Traduce el historial en los KPIs de la
  Sección 2: productos rescatados vs. desperdiciados, tasa de
  aprovechamiento, % de recetas seguidas y ahorro estimado. Sin esto, la app
  no le muestra al usuario si está logrando su objetivo.
- **Editar y eliminar productos.** El documento (Sección 8) identifica la
  carga incompleta o errónea del inventario como el principal *freno* del
  sistema: si el inventario miente, todas las decisiones posteriores son
  malas. Eliminar se distingue de "descartar": eliminar es corregir una
  carga por error y **no** cuenta como desperdicio en las métricas.
- **Chatbot con contexto.** Si el agente pregunta "¿cuándo vence?", alcanza
  con responder la fecha. Reduce la fricción de carga, otro freno declarado.
- **Cache local de códigos + fecha estimada por categoría.** Un escaneo que
  falla por falta de red es carga que no se hace. El GTIN resuelto queda
  memorizado y funciona offline; si el usuario no conoce la fecha, se estima
  por categoría (Sección 6, "arranque en frío").
- **Umbrales con control humano.** El Agente de Aprendizaje nunca pisa un
  umbral que el usuario fijó a mano (`lockedByUser`); sólo ajusta los que
  nadie fijó, y Preferencias muestra cuál es cuál.
- **Exportar/importar la memoria.** El aprendizaje acumulado es el activo
  del sistema; sin backup se pierde al borrar los datos del navegador.
- **Ranking de recetas por urgencia real.** El Agente Cocinero identifica el
  producto más próximo a vencer y privilegia las recetas que lo rescatan
  combinándolo con el resto de la despensa. El peso de urgencia es continuo
  (`10 / días restantes`), así que algo que vence mañana pesa el doble que
  algo que vence pasado; no todos los "amarillos" valen igual.
- **Nunca se cocina con productos vencidos.** La Sección 7 establece que la
  seguridad alimentaria prevalece sobre todo otro criterio, así que los
  productos ya vencidos se excluyen del pool de ingredientes disponibles:
  siguen visibles en Alertas para descartarlos, pero jamás se ofrecen para
  cocinar.
- **Paso a paso en cada receta.** Una sugerencia que sólo nombra un plato
  difícilmente termine en comida cocinada. Las 27 recetas incluyen
  instrucciones, tiempo, porciones y qué ingredientes faltan.
- **Descartar una receta la saca del listado.** El descarte es una decisión
  del usuario que el sistema respeta: la receta deja de sugerirse y puede
  restaurarse desde Preferencias.

## Limitaciones conocidas (honestas, para la entrega)

- La "memoria persistente" es `localStorage` del navegador: vive en el
  dispositivo, no en un backend compartido entre dispositivos. Se mitiga con
  exportar/importar, pero para la entrega final pasaría a una base real.
- El chatbot es un parser por reglas, no un LLM: entiende patrones comunes
  ("ingresé X, vence el dd/mm/aaaa", "¿qué se me vence?", "¿qué puedo
  cocinar?") y ahora también respuestas cortas a una pregunta pendiente,
  pero no lenguaje libre arbitrario.
- El OCR depende de la nitidez de la foto y de tener conexión para cargar
  Tesseract.js la primera vez.
- La resolución de código de barras depende de que el producto esté cargado
  en Open Food Facts (más cobertura en marcas internacionales que en
  artículos muy locales); si no lo encuentra, se completa el nombre a mano y
  queda memorizado para los próximos escaneos.
- El **ahorro estimado** usa un valor de referencia fijo por producto: es una
  estimación declarada como tal, no un cálculo con precios reales.

## Identidad visual

Dos temas, ambos con el mismo sistema de componentes:

- **Claro:** verde fresco (`#2F8F4E`) como color de marca — alimento vivo y
  sostenibilidad — con terracota (`#E2662F`) como acento cálido de cocina.
  Se eligió deliberadamente **no** usar el azul genérico de las apps de
  billetera virtual, para que la app comunique su dominio.
- **Oscuro:** negro con amarillo como acento, alto contraste.

El semáforo de vencimientos (verde / amarillo / rojo / vencido) mantiene su
significado y legibilidad en los dos temas.

## Verificación realizada

Se ejecutó un test funcional (Node, simulando `localStorage`) que valida
el ciclo completo: alta de productos → análisis de vencimientos →
sugerencia de recetas → registro de desenlace → ajuste de aprendizaje;
además de casos del chatbot (fechas ambiguas, cantidades, consultas) y
reglas de negocio (alergias como filtro duro, exclusión de recetas sin
ingrediente crítico disponible). Todos los archivos JS pasaron `node
--check` sin errores de sintaxis.
