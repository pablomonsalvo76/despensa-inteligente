# Evaluación UX/UI — Heurísticas de Nielsen

**Trabajo de fin de ciclo · Inteligencia Artificial Aplicada a Organizaciones · UTN FRBA**
**Sección 5 de la entrega final. 2026-08-11.**

> Se evaluaron las **10 heurísticas**, no sólo el mínimo de 5 pedido —
> porque la app tiene evidencia real y concreta para cada una, no porque
> haga falta llenar espacio. Cada fila cita el archivo/función real donde
> vive la decisión, no una descripción genérica.

---

## 5.1 · Las 10 heurísticas

| # | Heurística | ¿Cumple? | Evidencia / Observación |
|---|---|---|---|
| 1 | **Visibilidad del estado del sistema** | Sí | El escaneo nunca deja al usuario sin saber qué está pasando: mensajes de progreso del OCR ("Leyendo la fecha… 7 s"), la resolución real de la cámara mostrada en pantalla (`[foto: 3840×2160]`, para diagnosticar sin adivinar), el semáforo verde/amarillo/rojo de vencimientos, y en el modo Escáner tres indicadores de paso independientes (código, nombre, fecha) que cambian de estado en vivo. `js/main.js` (`pasoEstado`, `set('auto-status', ...)`). |
| 2 | **Coincidencia entre el sistema y el mundo real** | Sí | El lenguaje es de cocina, no de base de datos: "Heladera / Freezer / Alacena" en vez de "ubicación_1/2/3"; el semáforo usa los mismos tres colores que un usuario ya asocia a "urgente/pronto/tranquilo" sin necesitar leyenda. Las categorías de producto (Lácteos, Verduras, Carnes…) son las de una alacena real, no una taxonomía técnica. |
| 3 | **Control y libertad del usuario** | Sí | *Eliminar* y *descartar* son dos acciones distintas a propósito: "Eliminar" corrige una carga por error y no cuenta como desperdicio en las métricas; "Descartar" si cuenta. Las recetas que el usuario rechaza no desaparecen para siempre — quedan en una lista de "Recetas descartadas" restaurable (`AgenteCocinero.restaurarDescartadas`). El escaneo continuo tiene un botón "Detener" siempre visible, no obliga a esperar el timeout. |
| 4 | **Consistencia y estándares** | Parcial | Los tres modos de captura (Escáner, Sólo código, Foto fecha) comparten el mismo formulario de abajo y el mismo lenguaje de estado ("buscando…", "no se pudo leer"), lo cual es consistente. Pero el botón "Leer con IA" está identificado con un ✨ que no se usa en ningún otro lugar de la app — un ícono nuevo introducido tarde en el desarrollo, sin unificar con el resto del sistema de iconografía (ver mejora de UI pendiente en `docs/CONTEXTO.md`). |
| 5 | **Prevención de errores** | Sí | La seguridad alimentaria nunca se delega: un producto vencido jamás se ofrece para cocinar, ni por el catálogo fijo ni por el modelo generativo — el filtro vive en `AgenteCocinero.inventarioDisponible` y se reutiliza en todos los agentes, no se puede evitar por accidente. Fechas ambiguas u OCR de baja confianza nunca se guardan solas: se muestran para que el usuario confirme. El campo Nombre es obligatorio antes de guardar (`captura.js: procesarManual`), evitando productos "fantasma" sin identificar. |
| 6 | **Reconocer antes que recordar** | Sí | El usuario nunca tiene que recordar un código de categoría o una fecha estimada de memoria: "No la sé — estimar por categoría" calcula una fecha razonable a partir de lo que el sistema ya aprendió, en vez de pedirle al usuario que la sepa. El panel "ver el texto que leyó la cámara" (`auto-crudo`) muestra literalmente lo que el OCR interpretó, para que el usuario reconozca el error en vez de tener que imaginarlo. |
| 7 | **Flexibilidad y eficiencia de uso** | Sí | Cuatro vías distintas para cargar un producto (escaneo automático, sólo código, sólo foto, carga manual/chat), pensadas para usuarios con necesidades distintas — alguien apurado usa el Escáner automático, alguien con un producto sin código de barras usa carga manual. El chatbot conversacional permite lenguaje libre en vez de formularios para quien lo prefiera. |
| 8 | **Diseño estético y minimalista** | Parcial | La pantalla de "Agregar producto" en modo Escáner acumula bastante contenido vertical (selector de método, banner, cámara, 3 pasos, botones, formulario completo) — un usuario que no scrollea puede no enterarse de que existe "Leer con IA". Es la única heurística con una falla real identificada y ya diagnosticada (ver `docs/CONTEXTO.md`, "Mejora de UI pendiente"), con una solución concreta (barra de acciones fija) diseñada pero no implementada aún por priorizar estabilidad antes de la entrega. |
| 9 | **Ayudar a reconocer, diagnosticar y corregir errores** | Sí | Cuando el OCR corrige un dígito por plausibilidad (ej. un 8 mal leído como 3), el sistema lo dice explícitamente: "Ojo: leí `23/01/27`... interpreté 23/01/2027 corrigiendo un dígito. Verificalo." — nunca corrige en silencio. Los mensajes de error diferencian causas reales: "no hay texto" no es lo mismo que "hay texto pero ninguna fecha", y cada uno sugiere una acción distinta. |
| 10 | **Ayuda y documentación** | Parcial | Hay ayuda contextual puntual y bien ubicada (el texto de "Preferencias" explica qué hace activar Gemini antes de que el usuario lo toque), pero no existe una sección de ayuda/FAQ centralizada dentro de la app — la documentación real vive en el repositorio (`README.md`), no accesible para un usuario final que sólo tiene el link publicado. |

**Resumen**: 7 de 10 completas, 3 parciales, ninguna directamente incumplida. Las tres parciales comparten una causa común: son las partes más nuevas del desarrollo (integración de IA, escáner combinado), construidas bajo presión de tiempo y sin una segunda pasada de pulido — coherente con lo que documenta la Sección 7 sobre el proceso real de desarrollo.

---

## 5.2 · Evaluación orientada al público objetivo

**Público objetivo** (definido en la Sección 1): usuarios domésticos que gestionan la despensa de su hogar, sin conocimiento técnico particular — y, como caso de escalamiento documentado, personal de cocina de un hotel o restaurante.

**¿El diseño es apropiado para el nivel técnico del usuario final?**
Sí, con una salvedad. El flujo principal (escanear, ver alertas, cocinar con lo que hay) no exige ningún conocimiento técnico: los tres modos de captura son botones grandes con ícono y una palabra, el semáforo es autoexplicativo. La salvedad es la configuración de IA en la nube (Preferencias → pegar JSON de Firebase, clave de reCAPTCHA): **eso sí requiere conocimiento técnico real**, y por eso se decidió (ver `docs/CONTEXTO.md`, "config de fábrica") embarcar una configuración por defecto en el código — el usuario final nunca necesita tocar esa pantalla para que la IA funcione; queda disponible sólo para quien quiera usar su propio proyecto.

**¿El lenguaje visual y textual es comprensible para ese usuario?**
Sí. Los mensajes de estado están escritos en primera persona y en tono conversacional ("Sigo buscándolo", "No encontré la fecha. Probá más cerca y con más luz"), evitando jerga de sistema ("error 404", "timeout"). Las categorías, ubicaciones y unidades son las de una cocina real.

**¿Se hizo alguna prueba con un usuario real? ¿Qué feedback se obtuvo?**
*(Sección pendiente de completar por el equipo — ver nota abajo.)*

> **Nota para completar antes de entregar**: la consigna pide evidencia de
> al menos una prueba informal con una persona que no haya visto la app
> antes (no hace falta que sea del rubro gastronómico). Sugerencia
> concreta: pedirle a alguien de tu casa que cargue un producto real desde
> cero, sin indicaciones previas, y anotar dónde se traba o qué no
> entiende. Documentarlo acá con honestidad — vale más una prueba real con
> un problema encontrado que ninguna prueba.
