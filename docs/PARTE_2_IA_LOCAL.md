# Parte 2 — IA local en Despensa Inteligente

**Trabajo de fin de ciclo · Inteligencia Artificial Aplicada a Organizaciones · UTN FRBA**

> **Nota previa:** este apartado no es hipotético. El modelo local ya está
> integrado y funcionando en el proyecto (`js/agents/generador.js`), con 40
> pruebas automatizadas sobre su capa de control. Las respuestas que siguen
> salen de haberlo implementado, no de imaginarlo — incluidos los problemas
> que sólo aparecen cuando uno lo enchufa de verdad.

---

## 1 · ¿Qué papel juega un LLM/SLM local en el proyecto?

El rol es de **subagente especializado, no de agente principal**, y esa
distinción es deliberada.

La aplicación tiene doce agentes y once son lógica determinística: reglas,
umbrales y puntajes escritos en JavaScript. El modelo local entró en el
único lugar donde las reglas tenían un techo real: **la generación de
recetas**. Hasta ese momento el Agente Cocinero trabajaba contra un
recetario fijo de 27 recetas construido sobre 35 ingredientes. Ese número no
era una limitación de tiempo sino de concepto: un recetario fijo no es un
agente cocinero, es una tabla de consulta. Con una despensa que puede
contener cualquier producto del mercado, un catálogo cerrado deja fuera casi
todo. El modelo local levanta ese techo: genera recetas a partir de lo que
efectivamente hay en la heladera y del estilo que el sistema aprendió.

**No reemplaza ninguna API externa**, porque el proyecto no usaba ninguna de
IA. La única llamada externa es a Open Food Facts, que es una base de datos
de productos, no un modelo. Esto es importante señalarlo: en nuestro caso el
modelo local no fue una decisión de ahorro de costos frente a la nube, sino
la única forma de incorporar IA generativa **sin romper la premisa central
de la arquitectura**, que es que ningún dato del usuario sale del
dispositivo. Si hubiéramos usado una API en la nube, cada generación de
receta habría enviado a un tercero el inventario completo del hogar y las
alergias declaradas de quienes viven en él.

Hay un segundo rol, todavía no implementado y documentado como próximo paso:
**reemplazar el parser del Agente Conversacional**. Hoy `conversacional.js`
interpreta lenguaje natural con expresiones regulares. Funciona para
patrones previstos —*"ingresé leche, vence el 20/08"*— y falla con cualquier
cosa fuera de ellos. Una frase como *"compré dos yogures y un sachet de
leche que vence el viernes"* tiene dos productos, una cantidad escrita en
palabras y una fecha relativa: no se resuelve con patrones, y un SLM la
convierte en JSON estructurado sin dificultad. Ese es el caso más claro
donde el modelo haría algo que hoy es imposible.

### La regla de arquitectura: el modelo propone, el código veta

Toda receta generada pasa por `validar()`, una función pura y sin red que
puede rechazarla entera. El modelo **no escribe nunca directo a la
pantalla**. Los controles son:

- **Lista cerrada de ingredientes.** Al modelo se le entrega la despensa y
  sólo puede usar eso. Cualquier ingrediente ajeno invalida la receta
  completa. Esto es lo que hace *verificable* todo lo demás: no se puede
  afirmar que algo está libre de un alérgeno si no se sabe qué es.
- **Alergias y pautas alimentarias.** Se verifican contra los ingredientes
  reales. Los `tags` que el modelo declara sobre sí mismo se descartan: si
  el modelo afirma que una receta con pollo es vegana, no se le cree.
- **Productos vencidos.** Nunca entran al conjunto que se le ofrece al
  modelo, porque la exclusión vive en el Agente Cocinero y no puede
  depender de la buena voluntad de un LLM.

Esta arquitectura contrasta a propósito con el enfoque de **"Tribunal de
agentes"** del material de cátedra (`Antigravity_multyMCP`), donde varias
IAs discuten entre sí para validar una respuesta. Es una idea potente para
tareas de investigación y diseño, pero para nuestro dominio elegimos lo
contrario: **el árbitro es código determinístico, no consenso entre
modelos**. La razón es concreta — tres modelos pueden coincidir y estar los
tres equivocados, y acá un error significa proponerle un alérgeno a alguien
que declaró una alergia. Donde hay riesgo sanitario, la verificación tiene
que ser auditable línea por línea, no probabilística.

---

## 2 · ¿Qué le aporta al usuario de la aplicación?

**Cambia qué le puede pedir al sistema.** Antes el usuario elegía dentro de
una lista; ahora puede pedir que le inventen algo con lo que tiene. La
diferencia práctica aparece con despensas incompletas o poco convencionales,
que son la mayoría: con 27 recetas fijas, un usuario con ingredientes fuera
del catálogo no recibía ninguna sugerencia útil y la app le fallaba
justamente cuando más la necesitaba.

**Lo hace más privado, y esto es lo central.** La aplicación almacena
alergias y condiciones médicas de todos los comensales del hogar —el Agente
de Hogar existe precisamente para eso— además del historial completo de
consumo. Son datos de salud y hábitos alimentarios de un grupo familiar.
Con un modelo local, esa información **nunca sale del dispositivo**: se
procesa en la misma máquina donde se generó. Con una API en la nube, cada
sugerencia implicaría enviar a un tercero qué come una familia, quién es
celíaco y quién hipertenso. Para el usuario la diferencia es invisible en la
pantalla y enorme en lo que se puede hacer con sus datos.

**Lo hace gratuito y usable sin conexión.** No hay costo por token, así que
no hay límite de uso ni razón para racionar las sugerencias. Y una vez
descargado el modelo, funciona sin internet — coherente con una PWA que ya
funcionaba offline.

**Lo que NO mejora es la velocidad**, y conviene decirlo. Una API en la nube
sobre hardware dedicado responde más rápido que un modelo de 3B en una
notebook. Se eligió privacidad y costo cero por encima de latencia, que en
este caso es aceptable porque generar una receta no es una interacción de
tiempo real: el usuario espera unos segundos sin que la experiencia se
rompa.

---

## 3 · ¿Qué aporta a nosotros como profesionales?

**Acceso a datos que hoy son deliberadamente inaccesibles.** La aplicación
genera información valiosa: patrones de consumo por categoría, tasa de
aprovechamiento, qué recetas se siguen y cuáles se descartan, cuánto se
desperdicia y de qué tipo. Todo eso vive en `localStorage` y **no lo
podemos ver**, porque la arquitectura no tiene servidor. Es una limitación
autoimpuesta que protege al usuario y al mismo tiempo nos deja ciegos.

Un modelo local rompe ese dilema sin romper la privacidad: permite analizar
esos datos **en el dispositivo del usuario**, entregando conclusiones en vez
de datos crudos. El usuario podría preguntarle a su propia app *"¿qué es lo
que más tiro?"* y recibir un análisis en lenguaje natural sin que un solo
registro viaje a ningún lado. Nosotros, como equipo, obtenemos la capacidad
de ofrecer inteligencia sobre los datos sin convertirnos en responsables de
custodiarlos — que es un problema legal y ético además de técnico.

Escalado a una organización, esto es la diferencia entre una herramienta
usable y una prohibida. Un restaurante o un hotel tienen datos de compras,
proveedores y costos que no pueden salir de la empresa por razones
competitivas y contractuales. Un SLM corriendo en un servidor propio permite
analizar esos datos sin ese conflicto.

**En el día a día, cambia cómo se desarrolla.** El material de cátedra
plantea reservar Ollama para *"trabajo nocturno"*, con la regla de que nunca
debe bloquear la máquina mientras se la usa. Nuestra experiencia matiza esa
regla: para nuestro caso —prompts cortos, respuestas de pocos cientos de
tokens, uso esporádico— un modelo chico corre en primer plano sin molestar.
La regla del profesor aplica a inferencia pesada y sostenida; conviene
distinguir el tamaño de la tarea antes de asumir que todo modelo local es
invasivo. Tener el modelo disponible sin costo por token cambia además la
economía de experimentar: se puede iterar un prompt cincuenta veces sin
mirar la factura.

---

## 4 · Limitaciones concretas frente a una API en la nube

Estas no son limitaciones teóricas: son las que encontramos al implementarlo.

### Restricciones del navegador — la que más costó

Una página servida por **HTTPS no puede llamar a `http://localhost`**. El
navegador lo bloquea como *mixed content* y no hay flag ni excepción que lo
resuelva. Como la aplicación está publicada en GitHub Pages —con HTTPS
obligatorio, porque la cámara lo exige— **la demostración del modelo local y
la demostración de la cámara no pueden hacerse en el mismo entorno**: una
requiere `localhost`, la otra requiere HTTPS.

Es una limitación estructural de las aplicaciones web frente a las nativas,
y no aparece en ninguna documentación de Ollama. Se resolvió documentándola
y dando un camino claro (`probar-ollama.bat` levanta el servidor con
`OLLAMA_ORIGINS` configurado, que sin eso rechaza todo pedido del
navegador). Una API en la nube no tiene este problema: es HTTPS de punta a
punta.

### Hardware

El modelo usado (Llama 3.2) ocupa unos 2 GB y necesita RAM disponible y,
preferentemente, GPU. Eso vuelve la función **imposible en el celular**, que
es el dispositivo principal de esta aplicación. Existen alternativas que
corren en el navegador vía WebGPU, pero implican descargas de varios cientos
de megabytes y en gama media directamente no arrancan. Hoy la generación de
recetas es una función de escritorio dentro de una app pensada para el
teléfono: una contradicción real que la arquitectura de dos capas mitiga
—el recetario local sigue funcionando en cualquier dispositivo— pero no
elimina.

### Calidad del modelo para nuestro caso

Un modelo de 3B es notoriamente menos confiable que uno de frontera para
**extracción estructurada**, que es lo que le pedimos: JSON válido con un
esquema fijo. En la práctica devuelve el JSON envuelto en explicaciones o en
bloques de código, por lo que hubo que escribir un parser tolerante
(`parsearJSON`). También inventa ingredientes que no están en la despensa —
exactamente lo que el validador rechaza. Es decir: **la capa de veto no es
paranoia, es una necesidad medida**. Con un modelo de frontera esos
rechazos serían menos frecuentes, pero la capa seguiría siendo obligatoria,
porque la garantía no puede depender de la calidad estadística del modelo.

### Mantenimiento y actualización

Con una API en la nube el proveedor actualiza el modelo y uno hereda las
mejoras. Con un modelo local, actualizar es responsabilidad propia: bajar
pesos nuevos, verificar que el prompt siga funcionando, revalidar. Y hay un
riesgo menos obvio — **un cambio de modelo puede alterar el comportamiento
sin que nada falle visiblemente**. Por eso las 40 pruebas del validador
importan: si un modelo nuevo empieza a devolver recetas peores, los
rechazos suben y queda registrado, en lugar de degradarse en silencio.

### Fragmentación de la experiencia

La función depende de que el usuario instale Ollama, descargue un modelo y
levante un servidor. Para el usuario final de una app de despensa, eso es
inviable. Hoy es una función para usuarios técnicos, y la aplicación está
diseñada para funcionar completa sin ella.

---

## Conclusión

El modelo local no reemplazó nada en este proyecto: **habilitó** algo que
antes no era posible sin renunciar a la privacidad. Su rol es de subagente
acotado, bajo un control determinístico que no delega la seguridad
alimentaria en ninguna inferencia probabilística.

La lección más útil del ejercicio no es que los modelos locales sean mejores
o peores que la nube, sino que **el nivel de control debe ajustarse al
riesgo del dominio**. En una herramienta de investigación, un tribunal de
modelos que discuten es un buen árbitro. En una aplicación que decide qué
puede comer una persona con alergias, el árbitro tiene que ser código que se
pueda leer, testear y auditar.

---

### Entregable opcional — Ollama en ejecución

*(Insertar acá la captura de terminal.)*

**Cómo reproducirlo:** ejecutar `probar-ollama.bat` en la raíz del
repositorio. El script verifica la instalación, descarga el modelo, le hace
una consulta del dominio del proyecto y levanta el servidor con el permiso
de origen que el navegador necesita.

**Pregunta enviada al modelo:**

> *"Tengo zapallito que vence mañana, cebolla y huevos. Decí en dos líneas
> qué cocinarías para no desperdiciar nada."*
