# Próximos pasos — a partir de la devolución docente

**Entrega evaluada: 90/100 (9.0).** Este documento traduce la devolución en
un plan ordenado. No es una lista de deseos: cada punto dice qué problema
resuelve, qué hay que tocar, y por qué está en ese lugar del orden.

---

## 1. Lo que dijo el docente, en una frase

Lo repitió dos veces, y es la instrucción principal:

> *"Más que agregar funcionalidades indiscriminadamente, sería interesante
> **medir el impacto de la IA** sobre el problema central."*

Es decir: el sistema ya demuestra que **funciona**. Lo que todavía no
demuestra es que **la IA aporta valor medible** frente a no tenerla. Todo lo
demás de su lista es secundario respecto de eso.

## 2. Dónde se perdieron los puntos

| Criterio | Perdido | Motivo | Costo de recuperarlo |
|---|---|---|---|
| Ciberseguridad | −2 de 10 | debug token en App Check + alergias al activar Gemini | **Bajo** |
| App funcionando | −3 de 30 | `localStorage` y despliegue estático | Alto |
| Arquitectura | −2 de 20 | falta clarificar el paso de parser a LLM en el chatbot | Medio |
| UX/UI | −2 de 20 | una sola sesión de prueba con usuario | **Muy bajo** |
| IA local | −1 de 20 | — | — |

Los dos más baratos —seguridad y una segunda prueba de usuario— valen 4
puntos juntos y no requieren rehacer nada. La persistencia es el más caro y
el que menos conviene atacar primero.

---

## 3. El plan, en orden

### Paso 1 — Medir si la IA aporta valor · *lo que pidió explícitamente*

**El problema**: hoy se puede afirmar que el sistema rescata comida, pero no
que la capa generativa mejore ese rescate respecto del recetario fijo.

**La trampa metodológica que hay que evitar.** La tentación es comparar
"recetas generadas cocinadas" contra "recetas del catálogo cocinadas". Esa
comparación **está confundida**: la generación se ofrece justamente cuando el
catálogo no alcanza, así que compite en los casos más difíciles, y la
novedad sesga en la dirección contraria. Medir preferencia no responde la
pregunta.

**La métrica que sí responde: cobertura, no aceptación.** Para un estado dado
de la despensa, el recetario fijo puede o no producir una receta — eso es
determinístico y no depende de lo que el usuario elija. Entonces:

```
Cobertura del catálogo  = % de productos en riesgo para los que
                          el recetario fijo ofrece al menos una receta

Cobertura con IA        = idem, sumando las recetas generadas y validadas

Aporte de la IA         = diferencia entre ambas
```

Eso es incontestable: mide qué productos **habrían quedado sin ninguna
opción** sin el modelo. Con la despensa de las capturas de la entrega (quinoa,
palta) la cobertura del catálogo era **0** y con IA pasó a haber receta. Ese
es el número que falta poner en la pantalla.

**Métricas secundarias, todas ya reconstruibles:**

| Métrica | De dónde sale |
|---|---|
| Recetas generadas aceptadas vs. descartadas | `history` + `buscarReceta(id).generada` |
| Productos rescatados por receta generada | `history.ingredientesUsados` |
| Tasa de veto del validador | **falta instrumentar**: hoy `rechazadas` es transitorio |

**La tasa de veto merece atención aparte.** Es la única métrica que
cuantifica el principio que el docente destacó como lo mejor del proyecto —
*"el modelo propone, el código veta"*. Hoy el veto ocurre y se pierde. Si se
persiste, se puede decir con un número **cuántas veces el código frenó al
modelo, y por qué motivo**. Eso convierte una afirmación arquitectónica en
evidencia.

**Qué tocar**: `impacto.js` (separar por origen y agregar cobertura),
`generador.js` (persistir los rechazos con su motivo), y la pantalla de
Estadísticas.

---

### Paso 2 — Desenlace `'ignorado'` · *"probablemente la mejor evolución funcional"*

Lo pidieron **las dos partes**: el docente lo marca como el faltante más
valioso, y el autor lo había pedido semanas antes —*"decirle: este producto
no lo consumís tanto, no deberías tener tanto stock"*—. Está documentado en
`evaluador.js` desde el principio y nunca se implementó.

**Definición que hay que fijar antes de codificar.** "Ignorado" no es
"vencido": un producto puede vencerse habiendo sido usado a medias. La señal
que interesa es **producto que llegó a su vencimiento sin haber participado
nunca de una receta cocinada**. Eso es computable: `history` guarda
`ingredientesUsados` en cada desenlace `cocinado`.

**Por qué importa**: es la única señal que permite detectar *compra excesiva*
en vez de *desperdicio puntual*. Un producto descartado una vez es un
accidente; un producto que se compra cada semana y nunca entra en una receta
es un patrón, y ese patrón es plata.

**Qué tocar**: `evaluador.js` (tercer desenlace), `aprendizaje.js` (detectar
el patrón por producto), `compras.js` (ya tiene "qué NO comprar" — ahí entra
la señal), `impacto.js`.

---

### Paso 3 — Segunda prueba de usuario · *2 puntos por 20 minutos*

El docente dejó escrito exactamente qué probar, así que no hay que diseñar
nada:

1. **Dos fallos seguidos del OCR** — ¿el usuario se rinde o encuentra la salida?
2. **Diferencia entre *eliminar* y *descartar*** — es sutil y afecta las métricas.
3. **Descubrimiento de "Leer con IA"** — la falla ya identificada en la heurística 8.

Es la mejora con mejor relación valor/esfuerzo de toda la lista: no toca
código y recupera puntos en el criterio que más pesa después de la app.

---

### Paso 4 — App Check productivo · *cierra la brecha de seguridad*

Es el criterio con peor porcentaje (80%). Dos caminos:

- **Mínimo aceptable**: el docente dijo que aceptaría que quede documentado
  como *degradación consciente para la demo, no arquitectura definitiva*.
  `CIBERSEGURIDAD.md` ya lo dice en el riesgo #7, pero está al final; conviene
  que aparezca en el encabezado del documento y en el informe.
- **Correcto**: reemplazar el debug token. El bug de reCAPTCHA v3 que motivó
  la degradación es del SDK de Firebase; conviene reevaluar si ya está
  resuelto en una versión posterior antes de dar por imposible el camino
  normal.

---

### Paso 5 — Unidades y conversión · *precisión del inventario*

Pasar de `quantity: 3` a `cantidad + unidad + conversión`. Hoy cocinar
descuenta una unidad entera, lo que es correcto para un sachet y falso para
500 g de carne.

Es también **el primer cambio** que la Sección 8 del informe identifica como
necesario para escalar a gastronomía, así que resuelve dos cosas a la vez.
Pero toca el modelo de datos, el descuento, el alta y la migración de los
datos existentes: es el más invasivo de los cinco primeros.

---

### Paso 6 — Favoritos · *la mejora que pidió el usuario real*

Ya está analizada en `UX_NIELSEN.md` 5.2, con la tensión de diseño resuelta:
implementar favoritos **como señal de aprendizaje** (entrada positiva
anticipada, hoy inexistente) y mantener la lista de compras subordinada al
rescate — los favoritos ordenan las sugerencias, pero no habilitan comprar
para una receta que no rescata nada.

Va después del `'ignorado'` porque ambos alimentan al mismo agente y conviene
tocar `aprendizaje.js` una sola vez.

---

### Paso 7 — Chatbot sobre el modelo local

El docente preguntará en la defensa: *"¿por qué el chatbot no usa el LLM local
si ya tenés Ollama integrado?"*. Hoy es un parser por reglas, y está
declarado con honestidad — eso no es el problema. El problema es que la
infraestructura ya existe (`AIProvider` con Ollama) y no se usa donde más
naturalmente aportaría.

**Cuidado con el orden**: el chatbot **modifica el inventario**. Ponerle un
LLM adelante sin un validador equivalente al de recetas sería contradecir el
principio que sostiene todo el proyecto. Primero el veto, después el modelo.

---

### Paso 8 — Persistencia

El docente pide migrar "a IndexedDB o base de datos remota". **Son dos cosas
distintas y conviene no mezclarlas**:

- **IndexedDB** resuelve capacidad, asincronía e índices. **No** resuelve
  multiusuario: sigue viviendo en un dispositivo.
- **Backend** resuelve multiusuario y sincronización, pero rompe la propiedad
  que hoy sostiene toda la sección de ciberseguridad: *los datos de salud
  nunca salen del dispositivo*.

Por eso va último: no es una mejora incremental, es una **decisión de
producto**. Si el objetivo sigue siendo doméstico y privado, IndexedDB
alcanza. Si el objetivo pasa a ser la cocina profesional de la Sección 8,
entonces hace falta backend, cuentas y roles — y la sección de seguridad hay
que reescribirla entera, no ajustarla.

---

## 4. Recomendación

Hacer los **pasos 1, 2 y 3** como bloque. Los tres responden a lo que el
docente marcó como más valioso, no requieren rehacer arquitectura, y juntos
producen algo que hoy falta: **un número que demuestre que la IA sirve**.

El paso 4 es barato y cierra la brecha del criterio más débil.

Del 5 en adelante son decisiones de producto, no de ingeniería, y conviene
tomarlas recién cuando esté claro si el proyecto sigue como app doméstica o
apunta a la cocina profesional.
