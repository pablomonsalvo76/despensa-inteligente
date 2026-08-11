# Equipo y co-work con IA

**Trabajo de fin de ciclo · Inteligencia Artificial Aplicada a Organizaciones · UTN FRBA**
**Secciones 1 y 7 de la entrega final. 2026-08-11.**

---

## Sección 1 · Presentación del equipo y del proyecto

- **Integrantes**: Pablo Monsalvo — equipo de una sola persona. Al no
  haber división de roles entre integrantes, el rol cubrió todo el ciclo:
  diseño de la arquitectura de agentes, desarrollo del código, decisiones
  de producto (qué priorizar, qué escalamiento evaluar), documentación y
  co-work con las herramientas de IA descriptas en la Sección 7.
- **Nombre del proyecto**: Despensa Inteligente
- **Problema que resuelve**: en un hogar se tira comida por dos razones
  que no son falta de ganas — no se sabe qué hay, y no se sabe qué está
  por vencer. La app ataca eso con un ciclo cerrado (compra → despensa →
  consumo → compra): registra lo que entra, vigila los vencimientos,
  propone qué cocinar priorizando lo que está por vencerse, aprende de lo
  que el usuario hace y dice qué comprar — y qué **no** comprar, porque
  comprar de más es una de las causas del problema. Mismo problema
  planteado en la entrega de medio ciclo, ahora con la solución
  implementada y funcionando.
- **Público objetivo**: usuarios domésticos que gestionan la despensa de
  su hogar, sin conocimiento técnico particular. Como caso de
  escalamiento evaluado (no implementado): personal de cocina de un hotel
  o restaurante, donde el mismo motor de decisión (qué se vence, qué
  cocinar con eso, según el estilo de consumo) aplica a mayor escala, con
  ajustes pendientes de roles, unidades de peso y trazabilidad de lote.

---

## Sección 7 · IAs usadas en el co-work de desarrollo

| Herramienta IA | Para qué la usaron | Aportó bien / mal / sorprendió |
|---|---|---|
| **Claude (Sonnet, vía Claude Code)** | Socio de desarrollo principal durante todo el proyecto: diseño de la arquitectura de agentes, escritura de código real (los 13 agentes, `js/db.js`, la integración de Firebase AI Logic), revisión de código propio buscando inconsistencias, y — el uso más largo de esta sesión — depuración en vivo de la integración con Gemini, incluyendo leer documentación real (Firebase, Google reCAPTCHA) para verificar hipótesis en vez de adivinar. | **Bien**: encontró bugs reales con evidencia concreta (no genéricos) — por ejemplo, que el panel "Foto fecha" nunca precargaba el motor de OCR bueno, o que el escáner continuo abortaba todo el intento si fallaba sólo el motor de respaldo. **Mal, y es lo más honesto de reportar**: en la sesión de depuración de Firebase, propuso al menos tres diagnósticos incorrectos antes de encontrar la causa real — atribuyó un error a un nombre de modelo "dado de baja" (`gemini-2.0-flash`) sin evidencia suficiente, cuando el modelo funcionaba bien; eligió jsDelivr como CDN sin verificar que rompe el registro compartido de módulos de Firebase, causando un segundo bug (`Service ai is not available`) que hubo que diagnosticar aparte; y al agregar una espera del token de App Check, introdujo sin querer una regresión que bloqueaba **todo** el sistema (no sólo el caso que quería arreglar) — el propio usuario lo detectó y forzó a revisar el razonamiento. |
| **ChatGPT** (consultado por el alumno en paralelo) | Segunda opinión sobre el mismo bug de Firebase App Check/reCAPTCHA, propuesta de código alternativo para `prepararGemini()`. | Propuso un diagnóstico de "Firebase se inicializa dos veces" que sonaba plausible pero no coincidía con la evidencia real (nunca apareció el error específico que ese bug produce, `Firebase App named already exists`) — se verificó leyendo el código real antes de aplicar el cambio, y se descartó. También sugirió eliminar código de manejo de errores sin darse cuenta de que reintroducía un bug ya corregido. Sí aportó una idea buena y accionable: pedir capturas de la pestaña Network del navegador, que terminó siendo la evidencia que destrabó el diagnóstico real. |
| **Gemini** (Google AI Studio, consultado por el alumno) | Tercera opinión sobre el mismo bug. | Ofreció una versión de `prepararGemini()` con una corrección basada en el mismo diagnóstico incorrecto que ChatGPT ("doble inicialización"), además de usar una función (`getApps()`) que ni siquiera estaba disponible en el puente de código del proyecto — se hubiera roto en silencio si se aplicaba sin revisar. |

### Reflexión obligatoria

**¿Qué parte del desarrollo hubiera sido imposible o hubiera tomado el
doble de tiempo sin el co-work con IA?** Toda la integración con Firebase
AI Logic. Es una API relativamente nueva, con documentación dispersa
entre varias páginas y ejemplos que no siempre coinciden entre sí (el
propio Claude entregó primero una versión con una CDN incorrecta). Sin
poder iterar rápido — probar, leer el error real, buscar la causa en
documentación oficial, corregir — esa sola integración podría haber
llevado días en vez de una sesión. También aceleró mucho la escritura de
los agentes con lógica repetitiva pero con reglas de negocio específicas
(el semáforo de vencimientos, el validador de recetas generadas), donde
la IA escribió la primera versión y el trabajo humano fue revisar que la
regla de negocio estuviera bien aplicada, no escribir cada línea.

**¿Qué parte la IA hizo mal y tuvieron que corregir?** Dos cosas
concretas y bien documentadas en el repositorio (`docs/CONTEXTO.md`):

1. **Diagnósticos apresurados sin verificar contra la evidencia real.**
   El caso más claro: atribuir el fallo de Gemini a un modelo "dado de
   baja" cuando en realidad el modelo funcionaba — el error real estaba
   dos capas más abajo (la CDN elegida rompía el registro de módulos de
   Firebase). Se corrigió con un método, no con suerte: cada vez que una
   IA (cualquiera de las tres) proponía una causa, se le pedía evidencia
   verificable — un mensaje de error exacto, una línea de documentación
   oficial, un archivo de red capturado — antes de aplicar el cambio.
   Varias hipótesis plausibles quedaron descartadas por ese filtro.
2. **Una corrección que introdujo una regresión más grande que el bug
   original.** Al agregar código para esperar el token de App Check
   antes de la primera llamada a Gemini, se agregó también un `throw`
   que cortaba la ejecución si esa espera fallaba — sin notar que eso
   bloqueaba **absolutamente todo**, incluso en el modo de configuración
   donde antes sí funcionaba. Lo encontró el usuario probando la app, no
   una revisión de código previa. La lección que queda documentada: un
   cambio "defensivo" (agregar una validación) puede ser más estricto que
   el comportamiento real del sistema que se está protegiendo, y hay que
   probarlo en el mismo modo en que ya andaba antes, no sólo en el caso
   que se está arreglando.
