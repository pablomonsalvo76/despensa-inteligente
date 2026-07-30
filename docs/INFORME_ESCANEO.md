# Informe — Sistemas de escaneo comerciales y qué podemos adoptar

**Despensa Inteligente · julio 2026**

Investigación sobre cómo escanean productos los supermercados, las apps de
retail y la industria alimentaria, comparado contra nuestro sistema, con
mejoras concretas ordenadas por costo y beneficio.

---

## 1 · Cómo escanean los que escanean bien

### 1.1 El supermercado (caja registradora)

El escáner de caja lee en una décima de segundo sin que el cajero apunte.
No es magia, son cuatro ventajas estructurales que nosotros no tenemos:

| Ventaja | Cómo la logran | ¿La podemos tener? |
|---|---|---|
| **Omnidireccional** | Espejos rotativos que proyectan un patrón de láser en estrella, o cámaras que capturan todo el campo a la vez: el código pasa en cualquier ángulo y algo lo cruza | Parcial: el detector nativo del navegador ya decodifica en cualquier orientación |
| **Iluminación propia** | El escáner ilumina el código por su cuenta; nunca depende de la luz del local | Parcial: linterna del teléfono (ya implementada) |
| **Distancia fija** | El vidrio de la caja fija la distancia focal: nunca hay desenfoque | No: la mano del usuario decide la distancia |
| **Operador entrenado** | El cajero escanea 5.000 veces por día y desarrolla técnica | No: nuestro usuario escanea 5 veces por semana |

**Lección para nosotros:** la mitad de la ventaja del supermercado es
*física*, no de software. Nunca vamos a igualar eso con una cámara de
teléfono sostenida a pulso — y por eso el objetivo correcto no es "leer
siempre" sino **fallar rápido y barato**: detectar pronto que no se puede
leer y ofrecer la alternativa (ya implementado: presupuesto de 10 s +
botón de carga manual visible).

### 1.2 La industria alimentaria (donde se imprime la fecha)

Los sistemas que verifican fechas de vencimiento en la línea de envasado
(Cognex, KEYENCE, Basler) logran 99,5% de precisión. Pero lo hacen con
condiciones que explican el número: cámara industrial fija, iluminación
controlada por diseño, y —la clave— **saben de antemano dónde está la
fecha y qué formato tiene**, porque ellos mismos la imprimieron. Verifican
lo esperado; nosotros descubrimos lo desconocido. Son problemas distintos,
y el nuestro es el difícil.

**Lección:** su técnica más transferible es la **región de interés
conocida**: nunca procesan el envase entero, sólo la franja donde la
impresora escribe. Nuestro equivalente es el encuadre guiado — decirle al
usuario dónde poner la fecha en vez de buscarla por toda la imagen (ya lo
hacemos con `ROI_FECHA`, y funciona mejor cuanto más chico es el recorte).

### 1.3 Los carritos inteligentes (Amazon Dash Cart, Caper de Instacart)

Reconocen el producto al apoyarlo en el carrito, combinando visión por
computadora con sensores de peso ("sensor fusion"). Su lección no es la
tecnología —inviable en un teléfono— sino el **principio de redundancia**:
nunca dependen de una sola señal. Si la cámara duda, el peso confirma.

**Lección:** nuestra versión de la redundancia ya existe y hay que
profundizarla: código de barras + OCR + cache local + estimación por
categoría son cuatro señales. La mejora está en cruzarlas mejor (ver §3.2).

### 1.4 Las apps de consumo (Yuka, MyFitnessPal)

Yuka —el caso más parecido al nuestro: escanear productos de almacén con
el teléfono— usa el SDK comercial de Scandit, no una librería gratuita.
MyFitnessPal puso el escáner detrás de una suscripción paga. La lectura de
mercado es directa: **el escaneo confiable en móvil es lo suficientemente
difícil como para que las apps grandes lo compren o lo cobren.**

Su patrón de UX coincide con lo que ya aprendimos a los golpes:
reconocimiento instantáneo sin botón de disparo, y **la carga manual
siempre visible como alternativa de primera clase**, no como premio
consuelo tras el fallo.

### 1.5 El depósito (terminales de mano)

Los lectores de almacén ofrecen tres cosas que el navegador no da bien:
gatillo físico, feedback multisensorial (beep + vibración + luz) y modo
lote — escanear veinte cosas seguidas sin confirmar cada una.

**Lección aplicable:** el **modo lote**. Nuestra app hoy es "un producto
por vez": escanear la compra semanal completa son veinte pasadas por el
mismo flujo. En depósito eso se resuelve encolando: escaneás todo, el
sistema acumula, y al final revisás la lista una sola vez.

---

## 2 · La tendencia que nos cambia el problema: Sunrise 2027

GS1 —el organismo que administra los códigos de barras del mundo— está
migrando el retail global a códigos 2D (DataMatrix y QR con GS1 Digital
Link). El plazo: **fin de 2027**, y Tesco en el Reino Unido ya migró
líneas enteras de productos en 2026.

Por qué nos importa: un código 2D GS1 lleva embebidos el GTIN **y la fecha
de vencimiento y el lote**. En un producto con DataMatrix GS1, todo
nuestro problema de OCR desaparece: la fecha viene en el código, exacta,
sin cámara temblorosa ni troquelado tenue.

La transición va a durar años y los productos de almacén argentinos van a
ser de los últimos, pero **el costo de estar preparados es casi nulo**:
`html5-qrcode` ya decodifica DataMatrix y QR — hoy los tenemos
deliberadamente apagados en `formatosDeProducto()`. Falta habilitarlos y
escribir el parser de los Application Identifiers de GS1 (el `17` es la
fecha de vencimiento, formato AAMMDD; el `01` es el GTIN; el `10` el
lote). Son ~40 líneas de código puro, perfectamente testeables.

**Ésta es la mejora de mejor relación costo/beneficio de todo el informe,
y además es material fuerte para la defensa: "la app ya lee el formato al
que el retail mundial está migrando".**

---

## 3 · Diagnóstico de nuestro sistema

### Lo que ya hacemos igual que los comerciales

- Formatos restringidos al dominio (4 simbologías, no 17) — práctica
  estándar de los SDKs comerciales
- Detector nativo del navegador cuando existe (BarcodeDetector) con
  fallback a WASM — el mismo esquema híbrido que html5-qrcode documenta
- Región de interés recortada, resolución alta, foco continuo, linterna
- Cache local de GTINs resueltos (nuestro "modo offline" es mejor que el
  de varias apps comerciales)
- Presupuesto de tiempo con salida manual visible — el patrón de Scandit
  de "no retener al usuario en un flujo que falla"
- Portón de forma + procedencia + confianza en la fecha (§1.2, la
  verificación estructural es exactamente lo que hace la industria)

### Dónde estamos genuinamente atrás

1. **El motor de OCR.** Tesseract.js es el eslabón más débil: fue diseñado
   para documentos escaneados, no para troquelados de matriz de puntos
   sobre plástico curvo con brillos. Los benchmarks móviles muestran a
   ML Kit de Google claramente arriba — pero ML Kit no existe para web:
   es nativo de Android/iOS. En navegador, las alternativas reales son
   pocas y ninguna es claramente superior para nuestro caso. Es un techo
   de plataforma, no de implementación.
2. **Un solo intento de flujo.** Sin modo lote, cargar la compra semanal
   es repetir veinte veces el ciclo completo.
3. **Sin telemetría de fallos.** No sabemos qué porcentaje de escaneos
   termina en carga manual, ni qué formatos de fecha fallan más. Los
   comerciales miden todo; nosotros adivinamos por reportes del usuario.

---

## 4 · Plan de mejoras, ordenado por costo/beneficio

| # | Mejora | Costo | Beneficio | Cuándo |
|---|---|---|---|---|
| 1 | **Soporte GS1 2D** (DataMatrix/QR + parser de AIs) | ~40 líneas + tests | Fecha exacta sin OCR en productos migrados; argumento fuerte de defensa | Ahora |
| 2 | **Telemetría local de escaneo** (cuántos éxitos, cuántos manuales, qué formatos fallan) — en localStorage, coherente con la privacidad | ~30 líneas | Deja de adivinarse qué falla; alimenta el log de sesión que pide la entrega | Ahora |
| 3 | **Modo lote** (escanear N productos seguidos, revisar al final) | ~1 día | La carga semanal deja de ser 20 flujos; es el patrón de depósito | Semana 2 |
| 4 | **Feedback multisensorial** (vibración ya existe; sumar beep corto en éxito) | ~10 líneas | Confirmación sin mirar la pantalla, patrón universal de retail | Ahora |
| 5 | **Foto fija de alta resolución para la fecha** (ImageCapture API con `takePhoto()`, que usa la resolución nativa del sensor, mayor que la del stream de video) | ~medio día | Más píxeles reales sobre el troquelado; es lo más cerca que un teléfono puede estar de la cámara industrial | Semana 2 |
| 6 | Migrar de html5-qrcode (sin mantenimiento desde 2023) a `zxing-wasm` o similar mantenido | ~1 día + regresión | Menos riesgo futuro; mismo rendimiento hoy | Después de la entrega |
| 7 | OCR con modelo de visión local (Ollama + LLaVA o similar) para fechas que Tesseract no puede | Alto; sólo demo en notebook | Interesante para la Parte 2 como extensión del SLM, no para producción | Documentar como futuro |

**Lo que NO recomiendo:** pagar un SDK comercial (Scandit/Scanbot cuestan
miles de dólares al año y contradicen el stack sin costos del proyecto), y
entrenar un modelo propio de detección de fechas (los papers logran 99%
pero con datasets y GPUs que exceden por mucho el alcance de la entrega).

---

## 5 · Conclusión honesta

El mercado confirma que el problema que peleamos es real y difícil: las
apps que lo resuelven bien usan SDKs comerciales de miles de dólares
(Yuka con Scandit) o directamente lo cobran (MyFitnessPal). Contra ese
estándar, nuestro sistema con librerías gratuitas y sin backend está
razonablemente cerca del techo alcanzable en un navegador con Tesseract.

Las dos verdades que deja la investigación:

1. **El OCR de fechas en móvil no se "arregla": se rodea.** Por eso las
   mejoras de mayor valor no intentan leer mejor sino depender menos de
   leer: GS1 2D (la fecha viene en el código), modo lote (menos fricción
   por producto), telemetría (saber qué falla), carga manual digna (la
   salida siempre disponible).
2. **La industria valida nuestro diseño de a capas.** Verificación
   estructural de la fecha, región de interés, redundancia de señales y
   fallo rápido son exactamente lo que hacen los sistemas de 99% — la
   diferencia es que ellos controlan la física y nosotros no.

---

### Fuentes

- [Scandit — How to Make a Barcode Scanner App Performant](https://www.scandit.com/blog/make-barcode-scanner-app-performant/)
- [Scandit — Best Practices for Usability](https://docs.scandit.com/data-capture-sdk/dotnet.ios/best-practices-for-usability.html)
- [Scandit — caso Yuka](https://www.scandit.com/resources/case-studies/yuka/)
- [Scanbot — How to read damaged or blurry barcodes](https://scanbot.io/blog/how-to-read-damaged-or-blurry-barcodes/)
- [Scanbot — Quagga2 vs html5-qrcode](https://scanbot.io/blog/quagga2-vs-html5-qrcode-scanner/)
- [GS1 US — What is Sunrise 2027](https://www.gs1us.org/industries-and-insights/by-topic/sunrise-2027)
- [HPRT — GS1 Sunrise 2027 Guide](https://www.hprt.com/blog/gs1-sunrise-2027-guide.html)
- [Cognex — Date and Lot Code Inspection](https://www.cognex.com/en/applications/optical-character-recognition/date-and-lot-code-inspection)
- [KEYENCE — OCR Verification](https://www.keyence.com/products/vision/applications/ocr-verification-and-character-inspection.jsp)
- [Basler — OCR Verification of Expiry Dates](https://www.baslerweb.com/en/use-cases/reliable-ocr-verification-of-expiry-dates/)
- [MDPI — Mobile Food Expiration Date Determination Using OCR](https://www.mdpi.com/2571-5577/8/6/176)
- [Amazon — Just Walk Out y Dash Cart](https://www.aboutamazon.com/news/retail/amazon-just-walk-out-dash-cart-grocery-shopping-checkout-stores)
- [Caper (Instacart) — Smart Carts](https://www.caper.ai/)
- [Fritz.ai — Comparing on-device text recognition](https://fritz.ai/comparing-on-device-text-recognition-ocr/)
- [STRICH — Comparison to ZXing and Quagga](https://strich.io/strich-compared-to-zxing-js-and-quagga/)
- [Tera Digital — Omnidirectional Barcode Scanners](https://tera-digital.com/blogs/barcodes/omnidirectional-barcode-scanner)
- [MyFitnessPal — Barcode scanner](https://support.myfitnesspal.com/hc/en-us/articles/360032624771-How-do-I-use-the-barcode-scanner-to-log-foods)
