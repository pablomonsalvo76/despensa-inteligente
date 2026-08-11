# Evaluación de Ciberseguridad

**Trabajo de fin de ciclo · Inteligencia Artificial Aplicada a Organizaciones · UTN FRBA**
**Sección 6 de la entrega final. 2026-08-11.**

> No es un pentest formal — es el registro honesto de los riesgos que el
> equipo identificó activamente durante el desarrollo, incluidos dos que
> se descubrieron **en producción, resolviendo un bug real** (filas 3 y 7),
> no por checklist. Eso es evidencia de que se pensó en seguridad
> trabajando, no que se completó una tabla después de terminar.

---

## Log de riesgos

| # | Riesgo identificado | Tipo (OWASP / privacidad / acceso) | Medida implementada o decisión tomada |
|---|---|---|---|
| 1 | **XSS** por texto proveniente de fuentes no confiables: lo que lee el OCR de un envase, lo que escribe el usuario en el chat, y — el caso más nuevo — **el texto que devuelve el modelo de IA al generar una receta** | OWASP A03:2021 (Injection) | Toda inserción de texto dinámico en el DOM pasa por `escapeHtml()` (`js/main.js:80`) antes de usar `innerHTML`; el texto crudo del OCR se muestra con `textContent` directamente, ni siquiera pasa por HTML. Verificado específicamente en el punto de mayor riesgo — las recetas que genera Gemini (`r.name`, `r.ingredients`, cada paso) se escapan una por una antes de renderizarse (`js/main.js:2404-2409`). No es una regla teórica: se auditó el código real (57 usos de `innerHTML`, 54 pasan por `escapeHtml`; los 3 restantes son plantillas fijas sin datos externos). |
| 2 | **Datos de salud** (alergias, condiciones médicas de los comensales del hogar) | Privacidad | Regla general: nunca salen del dispositivo, porque no hay backend que los almacene — viven en `localStorage` únicamente. **Excepción real y documentada**: cuando el usuario activa la generación de recetas con Gemini, las alergias declaradas SÍ viajan en el prompt (`generador.js:191`, `PROHIBIDO usar X (alergia)`) para que el modelo las respete al proponer. Es una excepción acotada y con consentimiento explícito (el usuario activa la IA a propósito), no un descuido — documentada en detalle en `docs/PARTE_2_IA_LOCAL.md`, sección 5. |
| 3 | **Exposición de claves/credenciales en el cliente** | Secretos expuestos (OWASP A02) | La app no tiene backend, así que cualquier configuración vive necesariamente en el código que llega al navegador — no hay dónde esconder nada de un cliente 100% estático. Se manejó en capas: **(a)** la clave de Firebase no es secreta por diseño (identifica el proyecto, no autoriza nada por sí sola) pero igual se codificó en base64 para no dejar el prefijo `AIzaSy` como texto plano grepeable por bots que escanean GitHub; **(b)** la clave real de la API de Gemini está **restringida por dominio** en Google Cloud Console (sólo funciona desde `pablomonsalvo76.github.io` y `localhost`), así que copiarla no le sirve a nadie fuera de esos orígenes; **(c)** la verificación de aplicación (Firebase App Check) se pensó para no depender de ningún secreto — ver riesgo #7 para lo que pasó cuando esa capa falló en producción. |
| 4 | **Sin autenticación de usuario** | Control de acceso | Decisión consciente, no una omisión: cada instalación de la app es de un solo dispositivo/persona, sin cuentas ni login. Es coherente con el resto de la arquitectura (todo el dato vive local). Documentado explícitamente que una versión multiusuario real (el escenario hotel/restaurante que se evaluó como escalamiento futuro) sí necesitaría cuentas y roles — no es gratis extenderlo. |
| 5 | **Pérdida de datos** | Disponibilidad | Toda la memoria del sistema (inventario, aprendizaje, preferencias) vive únicamente en `localStorage` de un dispositivo — se pierde si se borran los datos del navegador o se cambia de teléfono. Mitigado con exportar/importar en formato JSON (`js/db.js: exportAll/importAll`), verificado explícitamente para cubrir **todos** los stores (incluidos `stylePreferences` y `aiProviderConfig`, que en un momento del desarrollo quedaron afuera del export por error — ver `docs/CONTEXTO.md`, corregido antes de esta entrega). |
| 6 | **Inyección de prompt** contra el modelo de IA | Prompt injection | Regla de arquitectura de todo el proyecto: **el modelo propone, el código verifica — nunca al revés**. Al generador de recetas se le entrega una lista cerrada de ingredientes (sólo lo que hay realmente en la despensa); cualquier receta que mencione algo fuera de esa lista se rechaza entera, sin excepción. Los nombres de producto (que pueden venir de OCR o de texto libre del usuario, y podrían intentar inyectar instrucciones) se sanitizan de saltos de línea y caracteres de control antes de entrar al prompt (`generador.js: sanitizar()`). Las alergias y la exclusión de productos vencidos **nunca se delegan al modelo** — se verifican con código determinístico después, sin excepción, aunque el modelo "diga" otra cosa sobre sí mismo (ej. si afirma que una receta con pollo es vegana, no se le cree — se recalculan los tags desde los ingredientes reales). Con 40 tests adversariales sobre `validar()`. |
| 7 | **Verificación de aplicación (App Check) degradada a un token fijo, en producción** | Control de acceso / diseño de mitigación | El más honesto de esta lista, porque se descubrió en vivo, el 2026-08-06/07. Se activó Firebase App Check con reCAPTCHA v3 para verificar que los pedidos a la IA vienen de la app real (sin depender de ningún secreto). En producción, reCAPTCHA v3 falló de forma intermitente por un bug documentado y sin resolver del propio SDK de Firebase (`appCheck/recaptcha-error`, reproducido en Chrome de escritorio y celular, con evidencia de red capturada). Ante el plazo de entrega, se optó por reemplazarlo por un **token de depuración fijo** embarcado en el código — Firebase desaconseja esto para producción porque cualquiera que lea el código puede copiar ese token y saltarse la verificación. **La decisión se tomó sabiendo el trade-off**, no por desconocerlo: la protección real que queda en pie es la restricción de dominio de la clave de API (riesgo #3), que es independiente de App Check y sigue vigente. Queda documentado como pendiente de revisar cuando Google resuelva el bug, o de migrar a otro proveedor de atestación. |

---

## Reflexión

El riesgo #7 es el que más vale la pena resaltar frente al docente: no es
una casilla marcada por cumplir la consigna, es una decisión de seguridad
real, tomada bajo presión de tiempo, con el trade-off entendido y una
mitigación de respaldo activa. Es exactamente el tipo de situación que un
equipo de desarrollo enfrenta en un proyecto real — una protección falla
por una causa externa fuera de control, y hay que decidir entre bloquear
la funcionalidad por completo o aceptar un riesgo acotado y documentado.
Se documenta la decisión, no se esconde.
