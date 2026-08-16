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
| 6 | **Reconocer antes que recordar** | Sí | El usuario nunca tiene que recordar un código de categoría o una fecha estimada de memoria: "No la sé — estimar por categoría" calcula una fecha razonable a partir de lo que el sistema ya aprendió, en vez de pedirle al usuario que la sepa. El desplegable "ver el texto en bruto que interpretó el lector" (`auto-lectura`) deja disponible lo que el OCR entendió, para que el usuario reconozca el error en vez de imaginarlo — pero **colapsado**, por una razón que salió de usar la app: estaba abierto y rotulado "La cámara lee: …", y como muestra el intento del reconocedor *mientras todavía falla* (`"0"`, `"-."`), el usuario lo comparaba con lo que veía en pantalla, nunca coincidía, y concluía que la app estaba rota. Un dato puesto para dar transparencia terminaba destruyendo la confianza. Se conservó el valor diagnóstico y se corrigió la promesa del rótulo: la cámara no lee, interpreta el OCR. |
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

Sí. Prueba informal el **16/08/2026** con una persona que no había visto la
app antes, sobre la versión publicada y en su propio teléfono, sin
indicaciones previas ni acompañamiento durante el uso.

### Lo que funcionó

| Pantalla | Observación del usuario |
|---|---|
| **Inicio** | El código de colores del semáforo (vencidos, por vencer, en stock) le resultó **intuitivo sin explicación**: entendió el estado de la despensa "de un vistazo". Valoró que la lista muestre el contador de días restantes por producto. |
| **Alta de productos** | Identificó las tres vías de carga (OCR de la fecha, código de barras, manual) y las leyó como **flexibilidad**, no como complejidad: "según la preferencia o comodidad". |
| **Recetas** | Entendió que la sugerencia se arma con el inventario real, y destacó que las recetas **marquen con claridad los ingredientes que faltan comprar**. |

Los tres puntos corresponden a heurísticas evaluadas arriba —#1
visibilidad del estado, #7 flexibilidad y eficiencia, #6 reconocer antes que
recordar— y se cumplieron **sin intervención del evaluador**, que es la única
forma de verificarlas de verdad.

### Lo que propuso: favoritos + lista de compras derivada

El usuario no encontró un obstáculo de uso, pero propuso una funcionalidad
concreta: **marcar recetas como favoritas** (ícono de corazón) y, a partir de
las favoritas guardadas, **generar automáticamente la lista de compras** con
lo que falta para prepararlas.

**Es una propuesta buena y revela un hueco real.** Hoy el sistema tiene una
señal negativa explícita —descartar una receta la saca del listado— pero la
única señal positiva explícita es *cocinarla*, que exige efectivamente
cocinar. Un favorito permitiría decir "esta me gusta" antes de tener los
ingredientes, que es justamente cuando el dato sirve para decidir la compra.

**Y trae una tensión de diseño que hay que nombrar, no esconder.** La tesis
de la app es *cocinar lo que está por vencer y comprar menos*. Una lista de
compras derivada de recetas deseadas empuja en la dirección contraria:
comprar más. Hoy `AgenteCompras.queComprar` evita ese problema con dos
restricciones —sólo propone comprar para recetas a las que les faltan **como
máximo 2** ingredientes, y sólo si esa receta **rescata algo que está por
vencer**—. Sumar favoritos obliga a decidir si esa segunda restricción se
relaja, y relajarla cambia el carácter del producto.

**Resolución propuesta**: implementar favoritos como señal de aprendizaje
(entrada positiva explícita para `AgenteAprendizaje`) y mantener la lista de
compras subordinada al rescate: los favoritos **ordenan** las sugerencias de
compra, pero no habilitan comprar para una receta que no rescata nada. Así se
incorpora el aporte del usuario sin contradecir el objetivo del sistema.

### Honestidad sobre el alcance de esta prueba

Una sola sesión con una sola persona, sin obstáculos encontrados, es
evidencia **limitada**. No prueba que la app sea fácil de usar: prueba que
este usuario, en esta sesión, no se trabó. Una segunda ronda debería buscar
específicamente lo que esta no cubrió: qué pasa cuando el OCR falla dos veces
seguidas, si el usuario entiende la diferencia entre *eliminar* y *descartar*
—que es conceptualmente sutil y afecta las métricas—, y si encuentra la
opción de leer la fecha con IA sin que se la señalen (la falla ya
identificada en la heurística #8).
