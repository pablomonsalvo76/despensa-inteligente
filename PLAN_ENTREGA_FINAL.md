# Plan — Entrega Final · fecha límite lunes 17/08/2026

Hoy: martes 28/07/2026. **Quedan 20 días.**

---

## La regla que ordena todo

Las tareas están ordenadas por **peso en la nota**, no por lo interesante que
sean. La grilla de evaluación es:

| Criterio | Peso | Estado al 2026-08-11 |
|---|---|---|
| App funcionando y demostrable | 30% | Publicada y funcionando, incluida IA en la nube (Gemini) de fábrica. Falta la evidencia de la Sección 4 (ver `docs/capturas/`) |
| Arquitectura (diagrama + tabla stack) | 20% | Hecho — `docs/DIAGRAMAS.md` |
| UX/UI (heurísticas + público objetivo) | 20% | Hecho — `docs/UX_NIELSEN.md`. Falta sólo la prueba con un usuario real (5.2) |
| Parte 2 — IA local | 20% | Hecho — `docs/PARTE_2_IA_LOCAL.md`, con sección de revisión sobre la nube |
| Ciberseguridad (4 riesgos) | 10% | Hecho — `docs/CIBERSEGURIDAD.md`, 7 riesgos con evidencia real |
| Secciones 1 y 7 (equipo + IA en co-work) | — | `docs/EQUIPO_Y_COWORK.md`. Falta completar Sección 1 (integrantes) |

**El pivot a restaurantes/hoteles no aparece en ningún criterio.** Se responde
en el informe (Sección 8, semana 3), no reescribiendo la app.

### Los dos bloqueantes — RESUELTOS el 28/07

| Recurso | URL |
|---|---|
| Repositorio (público, 16 commits) | https://github.com/pablomonsalvo76/despensa-inteligente |
| Aplicación en vivo (HTTPS) | https://pablomonsalvo76.github.io/despensa-inteligente/ |

Verificado: la app carga completa y **sin un solo error de consola**, con
*Enforce HTTPS* activo — que es lo que la cámara necesita para funcionar.

**Estas dos URLs van en la primera página del informe.** Falta el link al
video de demo (opcional).

> Recordatorio: los 16 commits están fechados el 28/07. Lo que construye la
> historia real es commitear cada avance de acá al 17/08.

---

## Semana 1 · 28/07 → 03/08 — Destrabar

> Objetivo: que exista un link que el docente pueda abrir. Nada más.

### Día 1 (28/07) — Repositorio
- [ ] `git init` + `.gitignore` (excluir `android-build/www/`, `node_modules/`)
- [ ] Crear repo **público** en GitHub
- [ ] **Primeros commits por partes, no uno solo.** Agrupar por tema:
      db/persistencia → agentes → UI → OCR/cámara → tests → docs.
      La historia de commits es evidencia evaluada.

### Día 2 (29/07) — Publicar
- [ ] Activar GitHub Pages sobre `main` (te da HTTPS, obligatorio para cámara)
- [ ] Verificar en el celular: cámara, escaneo, OCR, instalación como PWA
- [ ] Anotar la URL — va en la primera página del informe

### Día 3 (30/07) — Validar la cámara arreglada
- [ ] Probar la lectura de `23/01/27` con los cambios de resolución y foco
- [ ] Leer el indicador `[foto: ancho×alto]`. Si dice 640×480, avisame
- [ ] Si sigue fallando: activar `ROI_FECHA` en la vía de foto (pendiente conocido)

### Días 4–5 (31/07 – 01/08) — Evidencia (Sección 4, parte del 30%)
- [ ] Capturas mínimo 3: home · flujo completo de carga · output de la IA
- [ ] Sumar 2 más que muestran bien el proyecto: pestaña Sistema (ciclo de
      agentes) y panel de impacto (KPIs)
- [ ] **Log de sesión real**: cargar productos de verdad de tu casa, usar la
      app unos días, exportar la memoria. Tiene que ser dato real, no de prueba
- [ ] Guardar todo en `docs/capturas/`

### Fin de semana (02–03/08) — Diagramas (20%)
- [ ] Arquitectura general: entrada → agentes → memoria → salida.
      Marcar qué es IA y qué es lógica tradicional, y dónde vive la memoria
- [ ] Flujo de agentes: los 9 agentes, qué decide cada uno, el ciclo
      Observación→Análisis→Planificación→Acción→Evaluación→Aprendizaje
- [ ] UML: diagrama de secuencia de "escaneo → OCR → alta → receta sugerida"
- [ ] Mermaid conviene: se versiona en git y se ve en GitHub

**Corte de control 03/08:** si el link no está vivo, se suspende todo lo demás
hasta que lo esté.

---

## Semana 2 · 04/08 → 10/08 — Contenido y código nuevo

### Días 6–7 (04–05/08) — Tabla de stack (parte del 20%)

Cuidado acá. La tabla pide Backend / Base de datos / Modelo de IA /
Orquestación, y tus respuestas son "no hay" / localStorage / reglas / código
propio. **Eso no es un problema si está argumentado** — el criterio es "por qué
esta y no otra". Mal argumentado parece que faltó trabajo.

| Componente | Qué poner | El argumento |
|---|---|---|
| Frontend | HTML+CSS+JS vanilla, PWA | Sin build step; instalable y offline sin tienda de apps |
| Backend | Ninguno (todo en cliente) | Decisión, no carencia: sin servidor no hay datos de terceros que filtrar |
| Base de datos | localStorage + export/import | Los datos no salen del dispositivo; el backup lo controla el usuario |
| Modelo de IA | Reglas + Tesseract.js (OCR) + SLM local propuesto | Ver Parte 2 |
| Orquestación | Código propio, ciclo explícito | n8n/LangChain agregan infraestructura sin aportar al ciclo |
| Despliegue | GitHub Pages | HTTPS gratis, obligatorio para `getUserMedia` |

### Días 8–10 (06–08/08) — Las 3 capacidades que pidió el profe

Sólo si la semana 1 cerró completa. Ordenadas por costo/beneficio:

1. **Costeo de merma en dinero** — `impacto.js` ya tiene
   `VALOR_ESTIMADO_POR_PRODUCTO`, hoy un valor fijo. Pasar a precio real por
   producto (campo opcional en el alta) y mostrar la pérdida acumulada en pesos.
   *Barato, y es lo que convierte el KPI en argumento de negocio.*
2. **Compras por cantidad** — `compras.js` ya dice qué comprar y qué NO.
   Falta el *cuánto*, cruzando con `aprendizaje.js → actualizarPatronesConsumo`,
   que ya calcula ritmo de consumo. *Medio.*
3. **Estacionalidad** — lo único que no existe. Tabla de temporada por producto
   (fruta y verdura, hemisferio sur) + aviso al comprar fuera de temporada.
   *Se puede hacer con una tabla estática; no necesita modelo.*

Las tres sirven igual en el caso hogareño. Ninguna obliga a pivotear.

### Fin de semana (09–10/08) — Integración SLM (habilita el 20% de Parte 2)
- [ ] Adaptador con motores intercambiables: `reglas` (actual, fallback) /
      `ollama` / `webllm`, detrás de `AgenteConversacional.interpretar()`
- [ ] Selector en Preferencias
- [ ] Script `.bat` para levantar Ollama con `OLLAMA_ORIGINS` correcto
- [ ] Regla de arquitectura a defender en el informe:
      **el modelo propone, el código determinístico veta.** Alergias y
      exclusión de vencidos nunca se delegan al modelo
- [ ] Captura de terminal con el modelo respondiendo (bonus de nota)

> Ojo con *mixed content*: una página en HTTPS no puede llamar a
> `http://localhost:11434`. La demo del SLM se hace corriendo la app en
> `localhost`. La demo de la cámara se hace en el celular. Son dos demos.

---

## Semana 3 · 11/08 → 17/08 — Escribir (70% de la nota vive acá)

### Día 11 (11/08) — UX/UI · Nielsen (20%)

Mínimo 5 heurísticas, pero tenés evidencia real para las 10. Material que ya
existe en la app:

- *Visibilidad del estado*: mensajes de progreso del OCR, `[foto: 3840×2160]`,
  semáforo de vencimientos, indicadores por paso del escaneo
- *Coincidencia con el mundo real*: semáforo verde/amarillo/rojo, lenguaje de
  cocina y no de base de datos
- *Control y libertad*: eliminar ≠ descartar; recetas descartadas restaurables
- *Prevención de errores*: fechas ambiguas se preguntan en vez de asumirse;
  "No la sé — estimar por categoría"
- *Ayuda a reconocer errores*: panel "ver el texto que leyó la cámara"
- *Flexibilidad*: cuatro vías de carga (manual, escaneo, foto, chat)

### Día 12 (12/08) — Ciberseguridad (10%)

Mínimo 4 riesgos. Los tuyos, reales:

| Riesgo | Tipo | Medida / decisión |
|---|---|---|
| XSS por texto del OCR o del chat | OWASP A03 | Se inserta con `textContent`, nunca `innerHTML` |
| Datos de salud (alergias, condiciones) | Privacidad | Nunca salen del dispositivo; sin backend que los almacene |
| Exposición de claves | Secretos | No hay ninguna: Open Food Facts es API pública sin key |
| Sin autenticación | Acceso | Decisión consciente: dato local por dispositivo. Documentar que en versión multiusuario haría falta |
| Pérdida de datos | Disponibilidad | Export/import de la memoria |
| Prompt injection (a futuro con SLM) | Prompt injection | El modelo propone, el código veta; alergias nunca delegadas |

### Día 13 (13/08) — IA en co-work + reflexión

Material honesto y concreto de estas sesiones:

- La IA asumió que el bug del OCR estaba en el parser de fechas. Falso: el
  parser leía `23/01/27` perfecto (37/37 en la suite). El problema era que la
  cámara abría sin resolución ni foco. **Eso va en "qué hizo mal".**
- Bug de backtracking exponencial (ReDoS) en el regex de separadores, detectado
  y corregido; hay test de regresión
- `postinstall` en el `package.json` generado corría `cap sync` antes de que
  existiera la carpeta `android/`

### Días 14–15 (14–15/08) — Parte 2 · IA local (20%)

Las 4 preguntas, un párrafo mínimo cada una. Tus respuestas fuertes:

1. **Rol**: reemplaza el parser por regex de `conversacional.js`. Hoy
   *"compré dos yogures y un sachet de leche que vence el viernes"* no se puede
   resolver con patrones. Subagente de interpretación, no agente principal.
2. **Al usuario**: lenguaje libre en vez de fórmulas fijas; funciona sin
   internet; sin costo por token.
3. **Al profesional**: los datos de consumo y desperdicio hoy no se pueden
   analizar sin sacarlos del dispositivo. Con modelo local, sí.
4. **Limitaciones**: hardware, calidad del modelo chico para extracción
   estructurada, mantenimiento. Y la trampa de mixed content, que es concreta y
   la viviste.

### Día 16 (16/08) — Informe + Sección 8 (respuesta al profe)
- [ ] Armar el PDF de 10–20 páginas. **Primera página: tabla de links**
- [ ] Sección de escalamiento a gastronomía: el mismo motor, qué cambia
      (unidades de peso, costo real, roles, PEPS y trazabilidad de lote,
      alérgenos de carta), y por qué el caso hogareño fue el punto de partida
      para validar el ciclo
- [ ] Video de demo, máximo 3 minutos (opcional, suma)

### Día 17 (17/08) — Entrega
- [ ] Verificar que **todos** los links abren desde una ventana de incógnito
- [ ] Ensayar la exposición: 10 min + 5 de preguntas
- [ ] Entregar

---

## Si el tiempo se achica

Orden de sacrificio, del primero que se cae al último:

1. Video de demo
2. Estacionalidad
3. Compras por cantidad
4. Integración SLM funcionando *(la Parte 2 escrita **no** se sacrifica: vale 20%)*
5. Costeo de merma

**Nunca se sacrifica:** repo con historia, app publicada, capturas, diagramas,
Nielsen, ciberseguridad, Parte 2 escrita.

---

## Sin contacto en gastronomía

Para la Sección 5.2 (prueba con usuario real) no hace falta un chef: probá la
app con alguien de tu casa que no la haya visto, anotá dónde se traba y qué no
entendió. Una prueba informal documentada con honestidad cumple la consigna y
vale más que una inventada.

Para los números del sector, usar fuentes públicas (FAO, INTA) y **declararlo
como dato secundario**, no como relevamiento propio.
