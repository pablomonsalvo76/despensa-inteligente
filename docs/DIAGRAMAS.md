# Diagramas — Despensa Inteligente

Sección 2 de la entrega final. Los diagramas están en **Mermaid**: se
versionan como texto en el repositorio y GitHub los renderiza solo, así que
cualquier cambio en la arquitectura queda en la historia de commits.

---

## 1 · Arquitectura general del sistema

Muestra cómo fluyen los datos de entrada a salida, **qué componentes son IA
y cuáles son lógica tradicional**, y dónde vive la memoria persistente.

```mermaid
flowchart LR
    E1["Cámara<br/>código de barras"]
    E2["Cámara<br/>foto de la fecha"]
    E3["Carga manual<br/>y chat"]

    IA1{{"PP-OCR (ONNX Runtime Web)<br/>OCR en el navegador, Tesseract.js de respaldo"}}
    IAV{{"Respaldo de visión (Gemini)<br/>sólo si el usuario toca 'Leer con IA'"}}
    X1[/"Open Food Facts<br/>API pública sin clave"/]

    L1["<b>Captura</b><br/>normaliza y valida"]
    L2["<b>Inventario</b> · <b>Vencimientos</b><br/>estado y urgencia"]
    L3["<b>Hogar</b> · <b>Cocinero</b> · <b>Compras</b><br/>decisión por reglas y puntaje"]
    L4["<b>Evaluador</b> · <b>Aprendizaje</b><br/>ajuste desde la conducta"]
    ORQ["<b>Orquestador</b><br/>corre el ciclo"]

    IA2{{"AIProvider<br/>Ollama local o Gemini en la nube, a elección<br/>genera recetas nuevas"}}
    VETO["VETO DETERMINÍSTICO<br/>alergias · vencidos<br/>sólo lo que hay en casa · cobertura completa"]

    DB[("MEMORIA PERSISTENTE<br/>js/db.js sobre localStorage<br/><br/>products · history · preferences<br/>stylePreferences · aiProviderConfig · household<br/>gtinCache · systemLog")]

    OUT["SALIDA<br/>alertas · recetas<br/>lista de compras · KPIs"]

    E1 --> L1
    E2 --> IA1 --> L1
    IA1 -. si no lee la fecha .-> IAV -. botón explícito .-> L1
    E3 --> L1
    E1 -. GTIN .-> X1 -. nombre .-> L1

    L1 --> L2 --> L3 --> OUT
    L3 --> IA2 --> VETO --> OUT
    OUT --> L4
    ORQ -.coordina.-> L2
    ORQ -.coordina.-> L3
    ORQ -.coordina.-> L4

    DB <--> L2
    DB <--> L3
    DB <--> L4

    classDef ia fill:#e8590c,stroke:#bf360c,color:#fff
    classDef logica fill:#2f8f4e,stroke:#1c5c32,color:#fff
    classDef mem fill:#37474f,stroke:#263238,color:#fff
    classDef ext fill:#5c6bc0,stroke:#3949ab,color:#fff
    classDef veto fill:#b71c1c,stroke:#7f0000,color:#fff
    classDef io fill:#455a64,stroke:#263238,color:#fff
    class IA1,IA2,IAV ia
    class L1,L2,L3,L4,ORQ logica
    class VETO veto
    class DB mem
    class X1 ext
    class E1,E2,E3,OUT io
```

> **Naranja = IA. Verde = lógica determinística. Rojo = el veto.**
> Gris oscuro = memoria persistente. Azul = servicio externo.

**Lo que hay que leer en este diagrama:**

- Sólo **tres componentes son IA**: el OCR local, su respaldo de visión en
  la nube, y el generador de recetas — los tres pasan por `AIProvider`
  (texto) o comparten el mismo patrón (visión). Todo el resto de la
  inteligencia del sistema es lógica determinística. Fue una decisión, no
  una carencia: las reglas se pueden auditar y explicar, y en una app que
  maneja alergias eso importa más que la sofisticación.
- El LLM **nunca escribe directo a la salida**: pasa por el veto, que ahora
  también verifica cobertura completa (que una receta "combo" realmente
  use todos los productos que dijo usar).
- El respaldo de visión **nunca se dispara solo**: es un botón explícito
  porque manda una foto puntual a un servicio externo (Gemini) y tiene
  costo. Sin configurarlo, la app funciona entera con lo local.
- La memoria sigue siendo local. Firebase AI Logic no es un servidor
  propio: es infraestructura de Google haciendo de intermediario para no
  exponer una clave en el cliente, no un backend que el equipo opere.

---

## 2 · Flujo de agentes y ciclo de decisión

Qué decide cada agente, cómo se comunican y cuál es el ciclo.

```mermaid
flowchart LR
    subgraph OBS["1 · OBSERVACIÓN"]
        A1["<b>Captura</b><br/>¿qué entró<br/>a la despensa?"]
        A2["<b>Inventario</b><br/>¿qué hay<br/>y cuánto?"]
    end

    subgraph ANA["2 · ANÁLISIS"]
        A3["<b>Vencimientos</b><br/>¿qué está<br/>en riesgo?"]
        A4["<b>Hogar</b><br/>¿quién come<br/>y qué no puede?"]
    end

    subgraph PLAN["3 · PLANIFICACIÓN"]
        A5["<b>Cocinero</b><br/>¿qué cocinar<br/>para rescatarlo?"]
        A6["<b>Generador</b><br/>¿y si invento<br/>algo nuevo?"]
        A7["<b>Compras</b><br/>¿qué comprar<br/>y qué NO?"]
    end

    subgraph ACC["4 · ACCIÓN"]
        A8["<b>Interfaz</b><br/>propone al usuario<br/>y él decide"]
    end

    subgraph EVA["5 · EVALUACIÓN"]
        A9["<b>Evaluador</b><br/>¿cocinó, descartó<br/>o ignoró?"]
        A10["<b>Impacto</b><br/>¿rescatamos<br/>o desperdiciamos?"]
    end

    subgraph APR["6 · APRENDIZAJE"]
        A11["<b>Aprendizaje</b><br/>ajusta umbrales,<br/>gustos y estilo"]
    end

    A1 --> A2 --> A3 --> A4 --> A5
    A4 --> A6
    A3 --> A7
    A5 --> A8
    A6 --> A8
    A7 --> A8
    A8 --> A9 --> A10 --> A11
    A11 -.reajusta la próxima vuelta.-> A2

    ORQ["<b>ORQUESTADOR</b><br/>dispara y encadena el ciclo"]
    ORQ -.-> OBS
    ORQ -.-> ANA
    ORQ -.-> PLAN
    ORQ -.-> EVA
    ORQ -.-> APR

    classDef obs fill:#1565c0,stroke:#0d47a1,color:#fff
    classDef ana fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef plan fill:#2f8f4e,stroke:#1c5c32,color:#fff
    classDef acc fill:#e2662f,stroke:#bf360c,color:#fff
    classDef eva fill:#00838f,stroke:#006064,color:#fff
    classDef apr fill:#f9a825,stroke:#f57f17,color:#000
    classDef orq fill:#37474f,stroke:#263238,color:#fff
    class A1,A2 obs
    class A3,A4 ana
    class A5,A6,A7 plan
    class A8 acc
    class A9,A10 eva
    class A11 apr
    class ORQ orq
```

**El ciclo es cíclico de verdad:** lo que el usuario hace en el paso 4
alimenta el aprendizaje del paso 6, que cambia los umbrales y las
prioridades con que el sistema vuelve a observar. La flecha punteada de
vuelta no es decorativa — es lo que hace que la app de la semana cuatro no
se comporte igual que la del primer día.

---

## 3 · UML — Diagrama de secuencia

Una interacción completa: el usuario escanea un producto, el sistema lo
identifica, lee la fecha con OCR y termina sugiriéndole qué cocinar.

```mermaid
sequenceDiagram
    actor U as Usuario
    participant UI as Interfaz
    participant CAP as Captura
    participant OFACT as Open Food Facts
    participant OCR as PP-OCR (respaldo Tesseract.js)
    participant INV as Inventario
    participant DB as Memoria local
    participant ORQ as Orquestador
    participant VEN as Vencimientos
    participant HOG as Hogar
    participant COC as Cocinero

    U->>UI: apunta la cámara al código de barras
    UI->>CAP: procesarEscaneo(GTIN)
    CAP->>DB: ¿está en gtinCache?
    alt está cacheado
        DB-->>CAP: nombre y categoría
    else no está
        CAP->>OFACT: GET /product/ + gtin + .json
        OFACT-->>CAP: nombre y categoría
        CAP->>DB: guarda en gtinCache (sirve offline la próxima)
    end
    CAP-->>UI: producto identificado

    UI->>U: "ahora apuntá a la FECHA"
    U->>UI: encuadra la fecha
    UI->>CAP: procesarFoto(frame)
    CAP->>OCR: recognize(imagen preprocesada)
    OCR-->>CAP: texto crudo
    CAP->>CAP: extraerFecha() + corrección de confusiones O↔0, I↔1

    alt se leyó una fecha
        CAP-->>UI: fecha + nivel de confianza
    else no se leyó
        CAP-->>UI: sin_fecha
        UI->>U: ofrece "estimar por categoría"
    end

    U->>UI: confirma y guarda
    UI->>INV: add(producto)
    INV->>DB: persiste en products
    INV->>ORQ: runCycle("alta de producto")

    ORQ->>VEN: analyze()
    VEN->>DB: lee products y umbrales
    VEN-->>ORQ: productos con urgencia calculada
    ORQ->>HOG: perfilCombinado()
    HOG-->>ORQ: alergias y condiciones de la mesa
    ORQ->>COC: suggestRecipes(enriquecidos)
    COC->>COC: filtra alergias, críticos y vencidos
    COC->>COC: puntúa por urgencia + estilo aprendido
    COC-->>ORQ: recetas ordenadas
    ORQ->>DB: registra el ciclo en systemLog
    ORQ-->>UI: alertas + recetas
    UI-->>U: "tu leche vence en 2 días — hacé panqueques"
```

---

## 4 · UML — Casos de uso

```mermaid
flowchart LR
    U(("Usuario<br/>del hogar"))
    C(("Comensal<br/>alergias y<br/>condiciones"))
    S(("Sistema<br/>agéntico"))

    subgraph APP["Despensa Inteligente"]
        UC1["Cargar producto<br/>escaneo · foto · manual · chat"]
        UC2["Consultar qué vence"]
        UC3["Recibir sugerencias<br/>de recetas"]
        UC4["Pedir una receta<br/>inventada por IA"]
        UC5["Registrar desenlace<br/>cocinado · descartado"]
        UC6["Ver lista de compras<br/>qué llevar y qué no"]
        UC7["Declarar restricciones<br/>y estilo de cocina"]
        UC8["Exportar / importar<br/>la memoria"]
        UC9["Ver métricas<br/>de impacto"]
        UC10["Vigilar vencimientos<br/>y avisar"]
        UC11["Aprender del<br/>comportamiento"]
    end

    U --> UC1
    U --> UC2
    U --> UC3
    U --> UC4
    U --> UC5
    U --> UC6
    U --> UC7
    U --> UC8
    U --> UC9
    C -.perfil que condiciona.-> UC3
    C -.perfil que condiciona.-> UC4
    S --> UC10
    S --> UC11
    UC5 -.alimenta.-> UC11
    UC11 -.mejora.-> UC3

    classDef uc fill:#2f8f4e,stroke:#1c5c32,color:#fff
    classDef sys fill:#f9a825,stroke:#f57f17,color:#000
    class UC1,UC2,UC3,UC4,UC5,UC6,UC7,UC8,UC9 uc
    class UC10,UC11 sys
```

Los casos de uso en amarillo **no los inicia el usuario**: los dispara el
sistema por su cuenta. Es la diferencia entre una app que responde y un
sistema agéntico que además decide cuándo actuar.

---

## 5 · UML — Modelo de datos

Estructura de la memoria persistente (`js/db.js`).

```mermaid
classDiagram
    class Producto {
        +String id
        +String name
        +String category
        +Number quantity
        +Date expiryDate
        +String status
        +Date addedDate
        +Date resolvedDate
        +String location
        +String gtin
        +String source
        +Number daysRemaining
        +String urgencia
    }

    class Desenlace {
        +String productId
        +String recipeId
        +String outcome
        +Date timestamp
    }

    class Receta {
        +String id
        +String name
        +String[] ingredients
        +String[] critical
        +String[] tags
        +String cocina
        +String estilo
        +String tipo
        +Number cookTimeMin
        +Number servings
        +String[] steps
        +Boolean generada
    }

    class Comensal {
        +String nombre
        +String[] alergias
        +String[] condiciones
        +String[] dietas
        +String[] gusta
        +String[] noGusta
    }

    class Preferencias {
        +String[] allergies
        +String[] dietary
        +Map alertThresholds
        +Map avoidedIngredients
        +Map estilosPreferidos
        +Number maxSuggestions
    }

    class PerfilEstilo {
        +Map cocina
        +Map estilo
        +Map tipo
    }

    Producto "1" --> "0..*" Desenlace : genera
    Receta "1" --> "0..*" Desenlace : genera
    Desenlace "0..*" --> "1" PerfilEstilo : alimenta
    Desenlace "0..*" --> "1" Preferencias : ajusta
    Comensal "0..*" --> "1" Preferencias : condiciona
    Preferencias "1" --> "0..*" Receta : filtra
    PerfilEstilo "1" --> "0..*" Receta : ordena
```

`daysRemaining` y `urgencia` no se guardan: los calcula el Agente de
Vencimientos en cada ciclo. Persistir un dato derivado del reloj es pedir
que quede desactualizado.
