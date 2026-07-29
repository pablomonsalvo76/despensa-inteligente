# Plan de mejoras — Despensa Inteligente

Auditoría realizada sobre la versión actual (12 pantallas, 9 módulos de
agentes, PWA offline). Cada ítem indica su estado: **[HECHO]** en esta
tanda, o **[PENDIENTE]** con estimación de esfuerzo para una siguiente.

---

## 1. Diagnóstico general

La app cumple el diseño conceptual del TP: los 8 agentes existen como
módulos separados, el ciclo Observación→…→Aprendizaje corre de verdad y es
auditable en Perfil → Sistema, y la memoria persistente aprende (umbrales,
ingredientes evitados, ritmo de consumo). Los problemas que quedan no son
de arquitectura sino de **lazos sin cerrar** entre agentes y de
funcionalidad de conveniencia.

El hallazgo más importante de la auditoría: **cocinar una receta no
descontaba los ingredientes del inventario**. El usuario marcaba "Cociné"
el licuado de banana, y la banana seguía figurando como activa y en riesgo.
Eso rompe la promesa central (el inventario deja de reflejar la realidad,
el freno №1 según la Sección 8 del documento) y ensucia las métricas de
impacto.

---

## 2. Agentes y comunicación

- **[HECHO] Cerrar el lazo Cocinero → Evaluador → Inventario.** Al marcar
  una receta como cocinada, el Evaluador ahora descuenta del inventario los
  ingredientes que la receta usó (resta 1 a la cantidad; si llega a 0, el
  producto pasa a consumido). Los productos rescatados suman a las métricas
  de impacto. Es la mejora de mayor valor de todo el plan.
- **[HECHO] Mensajería visible entre agentes.** Cada evento
  agente→orquestador queda registrado en el log como "Comunicación:
  Inventario → Orquestador (producto_agregado)". La colaboración entre
  agentes —el corazón del TP— ahora es observable, no sólo declarada.
- **[HECHO] Chatbot con más capacidades de agente.** Nuevos intents:
  "consumí/terminé la leche" (registra el desenlace y dispara el ciclo de
  aprendizaje), "tiré el yogur" (descarte), "cuánto ahorré" (responde con
  las métricas de impacto) y "qué tengo" (resumen del inventario). El
  Conversacional deja de ser sólo un canal de carga y pasa a operar sobre
  todo el ciclo.
- **[PENDIENTE · medio] Sustituciones del Cocinero.** Sugerir recetas a las
  que falta un ingrediente NO crítico indicando el reemplazo ("sin apio
  también sale"). Requiere tabla de sustituciones por ingrediente.
- **[PENDIENTE · alto] Alertas predictivas del Aprendizaje.** Usar el ritmo
  de consumo aprendido para avisar *antes* del umbral fijo ("la leche suele
  durarte 4 días y la abriste hace 3"). La base de datos ya existe
  (consumptionPatterns); falta el motor de predicción por producto.
- **[PENDIENTE · bajo] Limitación a documentar:** el Agente de Vencimientos
  "permanente" sólo corre con la app abierta. Un monitoreo real en segundo
  plano requiere push de servidor (fuera del alcance sin backend).

## 3. Funcionalidad

- **[HECHO] Marcar consumido desde cualquier producto.** Antes sólo se
  podía desde Alertas cuando ya estaba en riesgo; consumir algo "verde" no
  tenía registro y el aprendizaje perdía esas muestras. Ahora la pantalla de
  edición tiene "Lo consumí", con descuento de cantidad parcial (si tenés 6
  huevos y usás 1, quedan 5).
- **[PENDIENTE · medio] Lista de compras.** Generada desde los faltantes de
  recetas + productos consumidos recientemente. Nueva pantalla + store.
- **[PENDIENTE · bajo] Detección de duplicados al cargar.** Si ya existe
  "Leche" activa, ofrecer sumar cantidad en vez de crear otra fila.
- **[PENDIENTE · medio] Escaneo de tickets de compra.** El documento lo
  menciona como acelerador; el OCR ya está (Tesseract), falta el parser de
  líneas de ticket. Precisión esperable: media.

## 4. Diseño

- **[HECHO — tandas anteriores]** Las 12 pantallas del mockup, ilustraciones
  SVG offline, temas claro/oscuro/sistema, tabbar con botón central.
- **[PENDIENTE · bajo] Accesibilidad.** Falta `aria-live` en el toast y en
  los contadores del dashboard; contraste del amarillo en tema claro está
  al límite en textos chicos.
- **[PENDIENTE · bajo] Gestos.** Swipe en filas de producto para
  consumir/descartar rápido. Es azúcar de UX, no funcionalidad.

## 5. Devolución docente — implementación

> *"La IA debe proporcionar a futuro qué podés hacer con los productos. O cómo
> integrar en la comida elegida los ingredientes que tenés que usar. Qué no
> comprar / qué comprar para poder usar con lo que está por vencer. Pero el
> agente debe conocer al usuario y quienes comen con este. Los gustos,
> necesidades, alergias, problemas médicos, gustos e historia."*

- **[HECHO] Agente de Perfil del Hogar** (`js/agents/hogar.js`). Modela a los
  **comensales**, no sólo al dueño del teléfono: nombre, alergias,
  condiciones médicas (celiaquía, intolerancia a lactosa, diabetes,
  hipertensión, colesterol), pautas alimentarias, gustos, rechazos y notas
  libres (la "historia" que menciona la devolución).
  - Las **alergias se unen**: si una sola persona es alérgica al maní, la
    casa entera deja de recibir recetas con maní.
  - Las condiciones se dividen en **duras** (celiaquía → nunca gluten) y
    **limitantes** (hipertensión → se advierte el sodio alto, no se prohíbe).
  - Las propiedades (gluten, lactosa, sodio, azúcar, grasa) se declaran **por
    ingrediente**, no por receta: al sumar recetas nuevas las restricciones
    se derivan solas y no hay riesgo de olvidar una etiqueta — que en salud
    sería un error grave.
  - Alcance sanitario declarado en pantalla: es un filtro de sentido común,
    **no** reemplaza indicación profesional.
- **[HECHO] Cocinero consciente de la mesa.** Ya no cocina "para el usuario"
  sino para todos: filtra por el perfil combinado, puntúa por gustos
  declarados y muestra advertencias ("no es vegetariano: Juan no puede
  comerlo", "sodio elevado por queso — cuidar por Juan").
- **[HECHO] Agente de Compras** (`js/agents/compras.js`) — el "qué comprar /
  qué no comprar" pedido explícitamente.
  - **Qué comprar:** no lista lo que falta en general, sino los pocos
    ingredientes que **desbloquean una receta capaz de rescatar algo en
    riesgo**. Se acota a recetas con ≤2 faltantes: comprar 4 cosas ya no es
    "aprovechar lo que tengo", es hacer las compras del mes. Respeta el
    hogar: no sugiere comprar leche si alguien es alérgico.
  - **Qué NO comprar:** dos fuentes reales — ya tenés stock (y encima está
    por vencer), o el historial muestra que ese producto lo descartás más de
    lo que lo consumís.
- **[PENDIENTE · alto] Integrar los urgentes en la comida elegida.** Hoy el
  Cocinero elige recetas que ya contienen el ingrediente urgente. El paso
  siguiente que sugiere la devolución es *adaptar* una receta elegida por el
  usuario para incorporar lo que hay que gastar ("a este guiso sumale la
  espinaca que vence mañana"). Requiere un motor de compatibilidad de
  ingredientes.

## 6. Orden recomendado para la próxima tanda

1. Integrar ingredientes urgentes en la receta elegida (devolución docente).
2. Alertas predictivas por ritmo de consumo (es el diferencial del TP).
3. Detección de duplicados al cargar.
4. Sustituciones del Cocinero ("sin apio también sale").
5. Accesibilidad y gestos.
