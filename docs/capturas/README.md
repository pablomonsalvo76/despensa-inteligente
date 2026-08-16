# Capturas — Sección 4 (Evidencia de funcionamiento)

Capturas tomadas el **16/08/2026** desde un teléfono Android real, sobre la
app publicada en HTTPS, con datos cargados por el usuario. No son maquetas.

| Archivo | Pantalla | Qué evidencia |
|---|---|---|
| `captura 1.jpeg` | Bienvenida | Punto de entrada de la PWA |
| `captura 2.jpeg` | **Inicio** | Estado real de la despensa: productos por vencer, recetas disponibles, resumen por categoría |
| `captura 3.jpeg` | Inicio (scroll) | Actividad del sistema en la pantalla principal |
| `captura 4.jpeg` | Agregar producto | Los tres métodos de captura y el formulario |
| `captura 5.jpeg` | **Escáner — el OCR local falla** | Código leído (verde), fecha "no se pudo leer", y la app ofrece el respaldo de IA |
| `captura 6.jpeg` | **Escáner — la IA resuelve** | Los tres pasos en verde: código, "Papa Frita", 17/09/2026 |
| `captura 7.jpeg` | Escáner (scroll) | Divulgación progresiva: *"Ver lo que devolvió la IA"* + formulario completado solo |
| `captura 8.jpeg` | Mis productos | Inventario con vencimiento y ubicación por producto |
| `captura 9.jpeg` | **Recetas** | Priorización por urgencia: *"Rescata lo más urgente: Milanesa"* |
| `captura 10.jpeg` | **Receta generada** | Etiqueta `inventada`, pasos completos, y el aviso de que pasó los mismos controles |
| `captura 11.jpeg` | Detalle de receta | *"Se hace con… / Te falta…"*: qué hay en casa y dónde, qué falta comprar |
| `captura 12.jpeg` | **Sistema** | Ciclo de orquestación y log en vivo de los agentes |
| `despensa-inteligente-2026-08-16.json` | — | **Log de sesión real**: exportación completa de la memoria del sistema |

## Las tres que pide la consigna como mínimo

- **Pantalla principal** → `captura 2.jpeg`
- **Flujo de uso principal** → `captura 5.jpeg` + `captura 6.jpeg`
- **Output de la IA** → `captura 10.jpeg`

## Por qué el par 5 + 6 vale más que cualquiera de las dos sola

Cuentan la arquitectura en dos capas en dos imágenes: el OCR local —que corre
100% en el dispositivo— no logra leer una fecha impresa sobre plástico
arrugado, lo dice sin inventar nada, y ofrece el respaldo de visión detrás de
un botón explícito. La captura siguiente muestra el resultado. Ninguna de las
dos capas se presenta como infalible.

## Dos detalles que un evaluador atento puede notar

- En `captura 10`, entre los ingredientes de la receta generada aparece
  **"mayonesa hellmanns clasica"**. Ese producto expuso un defecto real del
  validador el 15/08 —rechazaba la respuesta correcta del modelo por una
  diferencia de apóstrofo entre el prompt y la lista cerrada— documentado en
  `CONTEXTO.md`. La captura es la verificación en producción del arreglo.
- En `captura 9`, *"Arroz guisado con asado desmenuzado"* **no** es una de las
  27 recetas fijas: es una receta generada por el modelo, validada e
  incorporada al catálogo, conviviendo con las escritas a mano.

## Pendiente opcional

- `estadísticas / impacto`: la pantalla de KPIs (rescatado vs. desperdiciado)
  no quedó capturada. Suma, pero no es obligatoria.
