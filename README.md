# Despensa Inteligente

App móvil (PWA) de gestión de despensa y prevención de desperdicio de
alimentos, con orquestación agéntica y memoria persistente.

Implementa el diseño conceptual del trabajo de medio ciclo *"Despensa
Inteligente: gestión agéntica de inventario doméstico y prevención de
desperdicio de alimentos"* — Inteligencia Artificial Aplicada a
Organizaciones, UTN FRBA.

**App en vivo:** https://pablomonsalvo76.github.io/despensa-inteligente/

> Abrila desde el celular para usar la cámara. Se puede instalar con
> *"Agregar a pantalla de inicio"* y queda como una app más.

---

## El problema

En un hogar se tira comida por dos razones que no son la falta de ganas:
no se sabe qué hay, y no se sabe qué está por vencer. Cuando uno se
entera, ya es tarde.

La app ataca eso con un ciclo cerrado: **compra → despensa → consumo →
compra**. Registra lo que entra, vigila los vencimientos, propone qué
cocinar priorizando lo que está por vencerse, aprende de lo que hacés y
te dice qué comprar — y qué **no** comprar, porque comprar de más es una
de las causas del problema.

---

## Cómo probarla

**En el celular** — https://pablomonsalvo76.github.io/despensa-inteligente/

La cámara necesita HTTPS sí o sí: los navegadores bloquean `getUserMedia`
sobre `file://` o HTTP simple.

**En la computadora**, para revisar rápido:

```bash
python3 -m http.server 8080
```

Abrí `http://localhost:8080`. La cámara funciona en `localhost` aunque no
haya HTTPS. El ingreso manual y el chatbot funcionan siempre.

**Con generación de recetas por IA local** (opcional): doble click en
`probar-ollama.bat`. Levanta Ollama con el permiso de origen que el
navegador necesita y deja el modelo listo. Requiere abrir la app desde
`http://localhost` — una página servida por HTTPS no puede llamar a
localhost.

---

## Arquitectura de agentes

Doce agentes, cada uno en su archivo, coordinados por un orquestador que
corre el ciclo **Observación → Análisis → Planificación → Acción →
Evaluación → Aprendizaje** (visible en la pestaña *Sistema*).

| Agente | Archivo | Qué decide |
|---|---|---|
| Inventario | `js/agents/inventario.js` | Alta, baja y estado de cada producto |
| Vencimientos | `js/agents/vencimientos.js` | Semáforo de urgencia y umbrales de alerta |
| Captura | `js/agents/captura.js` | Escaneo de código de barras, OCR de fecha, carga manual |
| Conversacional | `js/agents/conversacional.js` | Interpreta lenguaje natural del chat |
| Hogar | `js/agents/hogar.js` | Perfil de los comensales: alergias y condiciones |
| Cocinero | `js/agents/cocinero.js` | Qué recetas proponer y en qué orden |
| Generador | `js/agents/generador.js` | Inventa recetas nuevas con un LLM local |
| Compras | `js/agents/compras.js` | Qué comprar y qué **no** comprar |
| Evaluador | `js/agents/evaluador.js` | Registra el desenlace de cada decisión |
| Aprendizaje | `js/agents/aprendizaje.js` | Ajusta umbrales, gustos y estilo desde la conducta |
| Impacto | `js/agents/impacto.js` | KPIs: rescatado vs. desperdiciado, ahorro estimado |
| Orquestador | `js/agents/orquestador.js` | Corre el ciclo y comunica a los demás |

La **memoria persistente** vive en `js/db.js` (localStorage, con
exportar/importar). La base de recetas curadas, en `js/recipes.js`.

---

## Qué es real y qué no

| Función | Estado |
|---|---|
| Inventario, semáforo, alertas, historial, log del ciclo | Real, con persistencia local |
| Escaneo de código de barras | Real: cámara + `html5-qrcode`, resuelve el GTIN contra Open Food Facts (API pública, sin API key) |
| OCR de fecha de vencimiento | Real: cámara + Tesseract.js en el navegador |
| Recetas del recetario | Real: 27 recetas curadas con instrucciones paso a paso |
| Generación de recetas nuevas | Real, con LLM local vía Ollama. Opcional: si está apagado, el recetario sigue funcionando |
| Chatbot | Real, parser por reglas. No entiende lenguaje libre arbitrario |
| Aprendizaje de gustos y estilo | Real: aprende de lo que cocinás, lo que descartás y lo que declarás |
| Notificaciones | Del navegador (`Notification` API). No son push de servidor |

---

## Decisiones de diseño que vale la pena mirar

**La seguridad alimentaria no se delega nunca.** Los productos vencidos
se excluyen del pool de ingredientes: siguen visibles en Alertas para
descartarlos, pero jamás se ofrecen para cocinar. Las alergias son filtro
duro, no puntaje.

**El modelo propone, el código veta.** Toda receta generada por el LLM
pasa por `validar()`, una función pura sin red: sólo puede usar
ingredientes que estén realmente en la despensa, y los tags que el modelo
declara sobre sí mismo se descartan y se recalculan desde los
ingredientes. Si el modelo afirma que una receta con pollo es vegana, no
le creemos.

**Ningún criterio secundario puede funcionar como compuerta.** El bonus
por rescatar el producto más urgente y la afinidad por el estilo aprendido
están acotados a propósito, para que una receta que rescata varios
productos en riesgo pueda ganarle a una que sólo usa el más urgente.

**El aprendizaje reserva lugar para explorar.** Si el usuario cocina
italiana tres veces, la afinidad empuja italiana — y como sólo ve
italiana, nunca genera evidencia de que le guste otra cosa. Un lugar de
cada lista queda reservado para algo fuera del gusto aprendido.

**El aprendizaje nunca pisa una decisión humana.** Los umbrales que el
usuario fijó a mano (`lockedByUser`) quedan bajo su control; el agente
sólo ajusta los que nadie tocó, y Preferencias muestra cuál es cuál.

**Eliminar ≠ descartar.** Eliminar corrige una carga por error y no
cuenta como desperdicio en las métricas. Si el inventario miente, todas
las decisiones posteriores son malas.

---

## Verificación

Cuatro suites, **112 pruebas**, sin dependencias externas:

```bash
node tests/fechas.test.js         # 37 — parseo de fechas de envase y OCR
node tests/recomendacion.test.js  # 16 — ranking de recetas y aprendizaje
node tests/estilo.test.js         # 19 — aprendizaje de gusto y exploración
node tests/generacion.test.js     # 40 — veto determinístico sobre el LLM
```

Los tests se verificaron **por mutación**: se rompió cada control a
propósito en una copia para confirmar que la suite lo detecta. Un test que
pasa igual con el código roto no es evidencia de nada. Ese proceso
encontró dos pruebas que no discriminaban, y se reescribieron.

Todos los archivos JS pasan `node --check`.

---

## Limitaciones conocidas

- La memoria persistente es `localStorage`: vive en el dispositivo, no en
  un backend compartido. Se mitiga con exportar/importar.
- El chatbot es un parser por reglas. El LLM local todavía no lo
  reemplaza: está integrado sólo en la generación de recetas.
- El OCR depende de la nitidez de la foto y de la resolución que entregue
  la cámara del dispositivo.
- El escaneo depende de que el producto esté en Open Food Facts. Si no
  está, se carga el nombre a mano y queda memorizado.
- El ahorro estimado usa un valor de referencia por producto: es una
  estimación declarada como tal, no un cálculo con precios reales.
- La generación con LLM requiere Ollama corriendo localmente y la app
  abierta desde `localhost` (restricción de *mixed content* del navegador).

---

## Stack

Sin framework, sin build step y sin backend — a propósito: la app se
instala, funciona offline y ningún dato del usuario sale del dispositivo.

| Componente | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (PWA) |
| Persistencia | `localStorage` con exportar/importar |
| OCR | Tesseract.js (en el navegador) |
| Códigos de barras | html5-qrcode + Open Food Facts |
| IA generativa | Ollama local (opcional) |
| Orquestación | Código propio, ciclo explícito |
| Despliegue | GitHub Pages |

---

## Documentación

- [`PLAN_ENTREGA_FINAL.md`](PLAN_ENTREGA_FINAL.md) — plan de trabajo
- [`INSTALAR_EN_CELULAR.md`](INSTALAR_EN_CELULAR.md) — instalación y APK
- [`PLAN_MEJORAS.md`](PLAN_MEJORAS.md) — devoluciones e implementación
