/**
 * Agente Cocinero (Sección 4)
 * -----------------------------------------------------------------------
 * "Recibe los productos en riesgo junto con el resto del inventario
 *  disponible y propone recetas factibles, respetando las preferencias
 *  y restricciones del usuario. Prioriza recetas que consuman los
 *  ingredientes más urgentes."
 *
 * Entradas: productos en riesgo, inventario disponible, preferencias,
 * base de recetas.
 * Salidas: recetas sugeridas al usuario.
 *
 * Criterio de ordenamiento (Sección 7): manda la urgencia, medida sobre
 * TODOS los productos que la receta rescata y no sobre uno solo. El producto
 * más próximo a vencer recibe un bonus que lo privilegia, pero acotado: una
 * receta que rescata varios productos en riesgo puede ganarle a una que sólo
 * usa el más urgente. Antes ese bonus era tan grande que funcionaba como
 * filtro y tapaba las recetas de mayor aprovechamiento (ver BONUS_PRIORITARIO).
 */

const AgenteCocinero = (() => {
  /* ---- Qué ES cada producto para el recetario ---------------------------
     El motor de recetas piensa en 35 ingredientes genéricos: carne, tomate,
     fideos, queso. La despensa real está llena de nombres de góndola:
     "milanesa", "puré de tomate", "tirabuzón", "muzzarella". Sin una capa
     que los una, el sistema tiene una milanesa venciendo en el freezer y
     sostiene con toda seriedad que no tiene carne.

     No es cosmético, rompe las DOS capas del Cocinero a la vez:
       · el recetario fijo no matchea ninguna receta, porque busca `carne`;
       · y el validador del Generador —que sólo acepta ingredientes de la
         despensa— rechaza la receta del modelo justo cuando éste escribe
         "carne", que es como se escriben las recetas.
     El resultado que se veía era "no genera nada" sin ningún error visible.

     La lista de ingredientes conocidos se DERIVA del catálogo en vez de
     escribirse a mano, y esa decisión rinde doble ahora que el recetario
     crece: cada receta que el modelo genera y el validador aprueba le
     enseña sus ingredientes a esta capa sola. El techo de los 35 sube con
     el uso en vez de quedar clavado en lo que alguien escribió a mano.

     Se memoiza porque `canonizar()` se llama una vez por ingrediente de
     cada receta candidata: rearmar el Set en cada llamada era gratis con
     27 recetas y deja de serlo con 200. Se invalida cuando cambia el
     tamaño del catálogo, que es la única forma en que crece.
     -------------------------------------------------------------------- */
  let cacheIngredientes = { tamano: -1, set: new Set() };

  function ingredientesConocidos() {
    const catalogo = catalogoRecetas();
    if (cacheIngredientes.tamano !== catalogo.length) {
      cacheIngredientes = {
        tamano: catalogo.length,
        set: new Set(catalogo.reduce(
          (acc, r) => acc.concat((r.ingredients || []).map(normalizeName)), []))
      };
    }
    return cacheIngredientes.set;
  }

  /* Nombres de góndola que NO contienen la palabra genérica adentro. Los que
     sí la contienen —"puré de tomate", "queso cremoso", "arroz integral",
     "leche entera"— no necesitan entrada acá: los resuelve la búsqueda por
     palabra de `canonizar`, que es lo que mantiene esta tabla corta. */
  const SINONIMOS = {
    // "bife de chorizo" está acá y no por casualidad: contiene la palabra
    // `chorizo`, que ES un ingrediente del recetario, así que sin la entrada
    // explícita un bife terminaba cocinándose como embutido. Los alias de
    // varias palabras se prueban primero justamente por estos casos.
    carne: ['bife de chorizo', 'milanesa', 'nalga', 'peceto', 'bife', 'cuadril',
            'lomo', 'vacio', 'asado', 'matambre', 'osobuco', 'roast beef',
            'falda', 'entraña', 'churrasco', 'hamburguesa', 'bondiola',
            'cerdo', 'costilla'],
    pollo: ['suprema', 'pechuga', 'muslo', 'alita'],
    queso: ['muzzarella', 'mozzarella', 'cremoso', 'port salut', 'parmesano',
            'tybo', 'sardo', 'provolone'],
    fideos: ['tirabuzon', 'mostachol', 'spaghetti', 'espagueti', 'tallarin',
             'penne', 'codito', 'municion', 'macarron', 'farfalle', 'pasta'],
    zapallo: ['calabaza', 'anco', 'cabutia'],
    pan_rallado: ['pan rallado', 'rebozador']
  };

  /* Nombres que contienen una palabra genérica pero NO son ese ingrediente.
     El dulce de leche es el caso claro: sin esta excepción, tenerlo en la
     alacena hacía creer al sistema que había leche, y ofrecía recetas
     imposibles. Se dejan tal cual y se cocinan sólo si alguna receta los
     nombra a ellos. */
  const NO_ES_EL_GENERICO = ['dulce de leche', 'leche de coco', 'agua de coco'];

  /* Un producto "de soja" o "vegetal" no es carne por más que se llame
     milanesa. La app guarda pautas alimentarias de todos los comensales:
     mapearlo a `carne` le bloquearía al vegetariano de la casa una receta
     que sí puede comer, y eso es un error con consecuencias. */
  const NO_ES_ANIMAL = /soja|vegetal|vegetariana|vegana|seitan|tofu|legumbre/;
  const DE_ORIGEN_ANIMAL = new Set(['carne', 'pollo']);

  /**
   * Traduce el nombre real de un producto al ingrediente que el recetario
   * entiende. Si no reconoce nada, devuelve el nombre normalizado tal cual:
   * nunca inventa una equivalencia para forzar un match.
   */
  function canonizar(nombre) {
    const n = normalizeName(nombre);
    if (!n || ingredientesConocidos().has(n)) return n;
    if (NO_ES_EL_GENERICO.some((e) => n.includes(e))) return n;

    // Un producto de soja o vegetal nunca se resuelve a un ingrediente
    // animal, ni siquiera si se llama "milanesa".
    const vegetal = NO_ES_ANIMAL.test(n);
    const aplicables = Object.keys(SINONIMOS)
      .filter((c) => !(vegetal && DE_ORIGEN_ANIMAL.has(c)));
    const buscar = (predicado) => aplicables
      .find((c) => SINONIMOS[c].some((alias) => predicado(alias)));

    // 1) Alias de varias palabras. Van primero porque son los más
    //    específicos: "bife de chorizo" tiene que ganarle a `chorizo`.
    const compuesto = buscar((alias) => alias.includes(' ') && n.includes(alias));
    if (compuesto) return normalizeName(compuesto);

    // 2) La palabra genérica adentro del nombre comercial: "puré de tomate"
    //    -> tomate. Antes de los alias sueltos porque también es más
    //    específica: una "milanesa de pollo" es pollo, no carne.
    const directo = n.split(/[^a-z0-9]+/).find((p) => p && ingredientesConocidos().has(p));
    if (directo) return directo;

    // 3) Nombres de góndola que no contienen la palabra genérica en ningún lado.
    const suelto = buscar((alias) => n.includes(alias));
    return suelto ? normalizeName(suelto) : n;
  }

  /* ---- Índice para preguntar "¿tengo tal ingrediente?" ------------------
     Deliberadamente SEPARADO de `inventarioNormalizado`. Son dos preguntas
     distintas y mezclarlas rompe una de las dos:

       · `inventarioNormalizado` responde "qué productos tengo" — se recorre
         por valores, y ahí cada producto tiene que aparecer UNA vez. Si se
         colapsaran acá la milanesa y el bife bajo la clave `carne`, uno de
         los dos desaparecería de "Para lo que se vence ahora" y el usuario
         dejaría de ver un producto que sí tiene.
       · este índice responde "¿tengo carne?" — se consulta por clave, y ahí
         un mismo producto puede (y debe) responder a varios nombres.

     Cada producto entra por su ingrediente canónico Y por su nombre propio:
     el modelo puede escribir "carne" o "milanesa" y las dos son correctas.
     -------------------------------------------------------------------- */
  function inventarioPorIngrediente(invMap) {
    const porIng = new Map();
    invMap.forEach((p) => {
      const canonico = canonizar(p.name);
      const previo = porIng.get(canonico);
      if (!previo || p.daysRemaining < previo.daysRemaining) porIng.set(canonico, p);

      const propio = normalizeName(p.name);
      if (propio !== canonico && !porIng.has(propio)) porIng.set(propio, p);
    });
    return porIng;
  }

  /* ---- Resolver un ingrediente ESCRITO contra la despensa ---------------
     Lo escribe el recetario o lo escribe el modelo, y en los dos casos el
     texto no tiene por qué coincidir carácter por carácter con el nombre
     que el usuario tiene guardado. Tres formas, de más estricta a menos:

       1. la clave exacta (nombre propio o ingrediente canónico);

       2. la clave con la puntuación aplanada. El modelo sólo puede copiar
          lo que le mostramos, y el prompt SANEA los nombres antes de
          mostrarlos: con "Mayonesa Hellmann's Clásica" cargada, el
          apóstrofo desaparecía del prompt, el modelo devolvía "mayonesa
          hellmanns clasica" y el validador lo rechazaba por no coincidir
          con su propia clave. Rechazaba la respuesta correcta a una
          pregunta que él mismo había hecho mal;

       3. prefijo por PALABRAS COMPLETAS: "mayonesa" resuelve a "Mayonesa
          Hellmanns Clásica". Es lo natural —una receta dice "mayonesa", no
          la marca— y se apoya en que el nombre se arma con el tipo
          adelante. Por palabras y sólo como prefijo, nunca por contención:
          así "sal" no puede resolver a "salchicha", ni "leche" a "dulce de
          leche".

     Nada de esto afloja la lista cerrada: se resuelve SIEMPRE contra un
     producto que está en la despensa. Un ingrediente inventado no resuelve
     a nada y se rechaza igual que antes.
     -------------------------------------------------------------------- */
  /* El apóstrofo se BORRA en vez de separar: el prompt lo elimina al sanear,
     así que el modelo escribe "hellmanns" donde la despensa dice
     "hellmann's". Separando, quedaban 4 palabras contra 3 y no emparejaban
     nunca. El resto de la puntuación sí separa —"port-salut" y "port salut"
     tienen que dar lo mismo de los dos lados. */
  const aplanar = (t) => normalizeName(t)
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function buscarEnDespensa(ingrediente, porIngrediente) {
    const directo = porIngrediente.get(canonizar(ingrediente))
      || porIngrediente.get(normalizeName(ingrediente));
    if (directo) return directo;

    const palabras = aplanar(ingrediente).split(' ').filter(Boolean);
    if (!palabras.length) return null;

    for (const [clave, producto] of porIngrediente) {
      const candidato = aplanar(clave).split(' ');
      if (candidato.length < palabras.length) continue;
      if (palabras.every((p, i) => p === candidato[i])) return producto;
    }
    return null;
  }

  /* ¿Estos dos textos nombran el mismo alimento? Se usa para las ALERGIAS,
     donde el riesgo corre al revés: si un ingrediente se puede escribir de
     varias formas, la alergia declarada también, y comparar literales deja
     pasar el alérgeno. Quien declaró "Mayonesa Hellmanns" no puede recibir
     una receta con "mayonesa". Prefijo por palabras en CUALQUIER dirección:
     bloquea de más, nunca de menos. */
  function esMismoAlimento(a, b) {
    if (canonizar(a) === canonizar(b)) return true;
    const pa = aplanar(a).split(' ').filter(Boolean);
    const pb = aplanar(b).split(' ').filter(Boolean);
    if (!pa.length || !pb.length) return false;
    const corto = pa.length <= pb.length ? pa : pb;
    const largo = corto === pa ? pb : pa;
    return corto.every((p, i) => p === largo[i]);
  }

  function inventarioNormalizado(enriquecidos) {
    // Mapa de ingredientes DISPONIBLES para cocinar.
    //
    // REGLA DE SEGURIDAD ALIMENTARIA (Sección 7): "la seguridad alimentaria
    // prevalece sobre cualquier otro criterio: el sistema nunca recomienda
    // consumir un producto vencido". Por eso los productos ya vencidos se
    // excluyen del pool de ingredientes: siguen visibles en Alertas para
    // descartarlos, pero jamás se ofrecen para cocinar.
    const map = new Map();
    enriquecidos
      .filter((p) => p.urgencia !== 'vencido' && p.daysRemaining > 0)
      .forEach((p) => {
        // Si hay dos productos con el mismo nombre, conserva el más urgente.
        const clave = normalizeName(p.name);
        const previo = map.get(clave);
        if (!previo || p.daysRemaining < previo.daysRemaining) map.set(clave, p);
      });
    return map;
  }

  function cumpleRestricciones(receta, prefs) {
    // Filtro duro: alergias y pautas alimentarias del titular (Sección 7).
    // Por ingrediente canónico: declarar "milanesa" como alergia tiene que
    // bloquear las recetas con `carne`, aunque el texto no coincida.
    const alergias = (prefs.allergies || []).filter(Boolean);
    const tieneAlergeno = receta.ingredients.some((ing) =>
      alergias.some((al) => esMismoAlimento(al, ing)));
    if (tieneAlergeno) return false;

    const dietas = prefs.dietary || [];
    for (const d of dietas) {
      if (!receta.tags.includes(d)) return false; // ej: usuario "vegetariano" exige tag vegetariano
    }
    return true;
  }

  function tieneCriticosDisponibles(receta, ingMap) {
    // "No se sugieren recetas a las que les falten ingredientes críticos
    // no sustituibles" (Sección 7)
    return receta.critical.every((ing) => ingMap.has(canonizar(ing)));
  }

  // Peso de urgencia continuo: cuanto menos días quedan, más urge rescatarlo.
  // Es preferible a los escalones del semáforo porque distingue entre un
  // producto que vence mañana y otro que vence en tres días.
  function pesoUrgencia(producto) {
    if (!producto) return 0;
    const dias = Math.max(producto.daysRemaining, 1);
    return 10 / dias; // 1 día -> 10 | 2 días -> 5 | 5 días -> 2 | 30 días -> 0.33
  }

  // Recetas que el usuario descartó: no deben volver a aparecer.
  function recetasDescartadas() {
    return new Set(DB.get('dismissedRecipes', []).map((d) => d.recipeId));
  }

  /* Bonus por rescatar el producto más próximo a vencer.
     -----------------------------------------------------------------------
     Antes valía 100, y con eso dejaba de ser un criterio para convertirse en
     una COMPUERTA: como el resto del puntaje rara vez pasa de 40, ninguna
     receta que no contuviera el producto número uno podía competir, por
     muchos productos en riesgo que rescatara. Con arroz venciendo hoy y
     avena mañana, una receta que salvaba la avena y otros tres productos
     quedaba por debajo de cualquiera que llevara arroz y nada más.

     El valor nuevo es del orden de un producto urgente (pesoUrgencia de un
     producto a 1 día, ya multiplicado): alcanza para desempatar a favor de
     lo más urgente, pero deja que una receta que rescata VARIOS productos
     en riesgo pueda ganarle. Que es lo que corresponde en una app cuyo
     objetivo es que no se tire comida. */
  const BONUS_PRIORITARIO = 15;

  /* Afinidad de estilo — lo que el agente aprendió que le gusta al usuario.
     -----------------------------------------------------------------------
     El perfil lo calcula el Agente de Aprendizaje sobre tres dimensiones
     (cocina, estilo, tipo) combinando conducta y preferencia declarada.

     Está ACOTADO a propósito, y el tope es la parte importante del diseño.
     El objetivo de la app es que no se tire comida: el gusto puede ordenar
     entre recetas que ya son viables, pero no puede tapar una que rescata un
     producto a punto de vencer. Sin tope volveríamos al mismo error que tenía
     el bonus de 100 — un criterio secundario funcionando como compuerta.
     Con MAX_AFINIDAD en 6, el gusto pesa menos que un solo producto urgente
     (que aporta 20 al puntaje), así que desempata sin mandar. */
  const MAX_AFINIDAD = 6;

  function afinidadEstilo(receta, perfilEstilo) {
    if (!perfilEstilo) return 0;
    let suma = 0;
    ['cocina', 'estilo', 'tipo'].forEach((d) => {
      const valor = receta[d];
      if (!valor) return;
      const puntos = (perfilEstilo[d] || {})[valor];
      if (puntos) suma += puntos;
    });
    // Recorte simétrico: ni el gusto ni el disgusto pueden desbordar.
    return Math.max(-MAX_AFINIDAD, Math.min(MAX_AFINIDAD, suma));
  }

  function score(receta, ingMap, prefs, productoPrioritario) {
    let coverage = 0;
    let urgencyScore = 0;

    receta.ingredients.forEach((ing) => {
      const producto = ingMap.get(canonizar(ing));
      if (producto) {
        coverage += 1;
        urgencyScore += pesoUrgencia(producto);
      }
    });

    const coverageRatio = coverage / receta.ingredients.length;

    const rescataPrioritario = productoPrioritario &&
      receta.ingredients.some((ing) => canonizar(ing) === canonizar(productoPrioritario.name));
    const bonusPrioritario = rescataPrioritario ? BONUS_PRIORITARIO : 0;

    // Ajuste por aprendizaje: penaliza ingredientes repetidamente rechazados
    const avoided = prefs.avoidedIngredients || {};
    let penalizacion = 0;
    receta.ingredients.forEach((ing) => {
      const norm = normalizeName(ing);
      if (avoided[norm] && avoided[norm] >= 3) penalizacion += 2;
    });

    return bonusPrioritario + urgencyScore * 2 + coverageRatio - penalizacion;
  }

  /* ---- De dónde sale cada cosa -----------------------------------------
     Una receta que rescata lo que vence casi nunca se hace sólo con eso:
     necesita un par de cosas más, y esas cosas normalmente ya están en la
     casa. Decirlo cambia la decisión del usuario. No es lo mismo "hacé una
     tarta de espinaca" —que obliga a ir a revisar la heladera a ver si
     alcanza— que "tenés la espinaca por vencer, y el queso y los huevos en
     la heladera: te da para la tarta". Lo segundo se puede cocinar ahora.

     Esto se calcula acá, sobre el inventario real, y no se le pregunta al
     modelo: la ubicación la cargó el usuario y el sistema ya la sabe. Al
     modelo se le pide la receta, no el estado de la despensa — pedirle un
     dato que uno tiene es la forma más fácil de que lo devuelva mal.
     -------------------------------------------------------------------- */
  // Espejo de `AgenteGenerador.BASICOS`: lo que se asume presente en
  // cualquier cocina y por lo tanto no se reporta como "te falta".
  const BASICOS_COCINA = new Set(['sal', 'agua', 'pimienta', 'aceite']);
  const ARTICULO = { Heladera: 'la heladera', Freezer: 'el freezer', Alacena: 'la alacena' };

  function desglosarIngredientes(receta, invMap, prioritarios = []) {
    // Se resuelve por ingrediente, no por nombre de producto: una receta pide
    // "carne" y lo que hay en el freezer se llama "Milanesa". La operación es
    // idempotente, así que da igual si el llamador ya pasó un índice.
    const porIngrediente = inventarioPorIngrediente(invMap);
    const urgentes = new Set((prioritarios || []).map((p) => canonizar(p.name)));
    const porVencer = [];
    const complementos = [];
    const basicos = [];
    const faltantes = [];

    (receta.ingredients || []).forEach((ing) => {
      const norm = canonizar(ing);
      const producto = buscarEnDespensa(ing, porIngrediente);
      if (!producto) {
        (BASICOS_COCINA.has(norm) ? basicos : faltantes).push(ing);
        return;
      }
      const item = {
        nombre: producto.name,
        ubicacion: producto.location || 'Heladera',
        daysRemaining: producto.daysRemaining
      };
      // "Por vencer" lo define el mismo semáforo de vencimientos.js, no una
      // lista aparte: un producto en rojo o amarillo cuenta como rescate
      // aunque no fuera de los que motivaron este pedido.
      if (urgentes.has(norm) || producto.urgencia === 'rojo' || producto.urgencia === 'amarillo') {
        porVencer.push(item);
      } else {
        complementos.push(item);
      }
    });

    porVencer.sort((a, b) => a.daysRemaining - b.daysRemaining);

    // Agrupados por dónde hay que ir a buscarlos, que es como se cocina de
    // verdad: la heladera se abre una vez, no una vez por ingrediente.
    const porUbicacion = {};
    complementos.forEach((c) => {
      (porUbicacion[c.ubicacion] = porUbicacion[c.ubicacion] || []).push(c.nombre);
    });

    return {
      porVencer, complementos, porUbicacion, basicos, faltantes,
      // "Completa" = se puede cocinar ahora mismo, sin comprar nada.
      completa: faltantes.length === 0
    };
  }

  function enumerar(lista) {
    if (lista.length <= 1) return lista[0] || '';
    return lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];
  }

  /** La frase que el Cocinero le dice al usuario sobre su propia despensa. */
  function fraseDisponibilidad(desglose) {
    if (!desglose || (!desglose.porVencer.length && !desglose.complementos.length)) return '';

    const partes = [];
    if (desglose.porVencer.length) {
      const nombres = enumerar(desglose.porVencer.map((p) => p.nombre.toLowerCase()));
      partes.push(`${nombres} que ${desglose.porVencer.length === 1 ? 'se te vence' : 'se te vencen'}`);
    }
    Object.entries(desglose.porUbicacion).forEach(([lugar, items]) => {
      partes.push(`${enumerar(items.map((i) => i.toLowerCase()))} que tenés en ${ARTICULO[lugar] || lugar.toLowerCase()}`);
    });

    const frase = `Se hace con ${enumerar(partes)}.`;
    return desglose.completa ? `${frase} No te falta nada.` : frase;
  }

  /* ---- Evaluación de candidatas (compartida) ---------------------------
     Filtra la base de recetas contra restricciones/seguridad/hogar y les
     asigna puntaje. La usan tanto `suggestRecipes` (el ranking general)
     como `recetasParaVencer` (las combinaciones para varios productos por
     vencer a la vez): es la MISMA regla de qué receta es viable y cuánto
     vale, no dos criterios distintos para la misma pregunta.
     -------------------------------------------------------------------- */
  function evaluarCandidatas(invMap, prefs, perfilHogar, perfilEstilo, productoPrioritario) {
    const descartadas = recetasDescartadas();
    // Índice por ingrediente: acá se pregunta "¿tengo carne?", no "¿tengo un
    // producto llamado carne?". Se arma una sola vez para las 27 recetas.
    const ingMap = inventarioPorIngrediente(invMap);

    return catalogoRecetas()
      .filter((r) => !descartadas.has(r.id))
      .filter((r) => cumpleRestricciones(r, prefs))
      .filter((r) => tieneCriticosDisponibles(r, ingMap))
      .map((r) => {
        const usados = r.ingredients.filter((ing) => ingMap.has(canonizar(ing)));
        const rescataPrioritario = !!productoPrioritario &&
          r.ingredients.some((ing) => canonizar(ing) === canonizar(productoPrioritario.name));

        // Veredicto del hogar: bloqueos (alergia / condición médica),
        // advertencias (sodio alto, no apto para el vegetariano de la casa)
        // y afinidad según los gustos declarados.
        const hogar = perfilHogar
          ? AgenteHogar.evaluarReceta(r, perfilHogar)
          : { apta: true, bloqueos: [], advertencias: [], afinidad: 0 };

        const afinEstilo = afinidadEstilo(r, perfilEstilo);

        return {
          receta: r,
          puntaje: score(r, ingMap, prefs, productoPrioritario) + hogar.afinidad + afinEstilo,
          afinidadEstilo: afinEstilo,
          rescataPrioritario,
          productoPrioritario: rescataPrioritario ? productoPrioritario : null,
          ingredientesUsados: usados,
          faltantes: r.ingredients.filter((ing) => !ingMap.has(canonizar(ing))),
          // Qué se rescata, qué se complementa con lo que ya hay y dónde
          // está cada cosa. Va en la candidata para que la UI no tenga que
          // reconstruir el inventario por su cuenta.
          desglose: desglosarIngredientes(r, ingMap, productoPrioritario ? [productoPrioritario] : []),
          hogar,
          // Ingredientes que la receta rescata, ordenados por urgencia real
          ingredientesUrgentes: usados
            .filter((ing) => {
              const p = ingMap.get(canonizar(ing));
              return p && (p.urgencia === 'rojo' || p.urgencia === 'amarillo');
            })
            .sort((a, b) => ingMap.get(canonizar(a)).daysRemaining - ingMap.get(canonizar(b)).daysRemaining)
        };
      })
      .filter((c) => c.ingredientesUsados.length > 0)
      // Filtro duro del hogar: si alguien de la casa no puede comerlo por
      // alergia o condición médica, la receta no se ofrece. La seguridad
      // prevalece sobre el aprovechamiento (Sección 7).
      .filter((c) => c.hogar.apta);
  }

  // Planificación del ciclo: dado el análisis de riesgo (o todo el
  // inventario si no hay riesgo), sugiere hasta N recetas.
  function suggestRecipes(enriquecidos, { max } = {}) {
    const prefs = DB.get('preferences', {});
    const invMap = inventarioNormalizado(enriquecidos);
    const maxSug = max || prefs.maxSuggestions || 3;

    // El Cocinero consulta al Agente de Hogar: no cocina "para el usuario"
    // sino PARA LA MESA. Alergias y condiciones de cualquier comensal son
    // filtro duro; gustos y condiciones que sólo limitan ajustan el puntaje.
    const perfilHogar = typeof AgenteHogar !== 'undefined' ? AgenteHogar.perfilCombinado() : null;

    // Producto más próximo a vencer entre los aptos para consumo: es el que
    // define la prioridad de todo el ranking.
    const disponiblesOrdenados = [...invMap.values()].sort((a, b) => a.daysRemaining - b.daysRemaining);
    const productoPrioritario = disponiblesOrdenados[0] || null;

    // Gusto aprendido (conducta + preferencia declarada). Si nunca cocinaste
    // ni declaraste nada, queda vacío y el ranking se comporta como antes.
    const perfilEstilo = DB.get('stylePreferences', null);

    const candidatas = evaluarCandidatas(invMap, prefs, perfilHogar, perfilEstilo, productoPrioritario)
      .sort((a, b) => b.puntaje - a.puntaje);

    return conExploracion(candidatas, maxSug);
  }

  // Cuántos de los productos prioritarios rescata una receta.
  function contarRescatados(receta, prioritarios) {
    return prioritarios.filter((p) =>
      receta.ingredients.some((ing) => canonizar(ing) === canonizar(p.name))
    ).length;
  }

  /* ---- Combinaciones para varios productos por vencer a la vez ---------
     Cuando hay más de un producto en rojo/amarillo al mismo tiempo, además
     del ranking general (`suggestRecipes`) el usuario quiere dos preguntas
     distintas: "¿hay UNA receta que use TODO esto junto?" y, para cada
     producto por separado, "¿qué cocino con ESTE?" — porque puede no
     querer o no poder cocinar todo junto, y la respuesta no es excluyente.

     "Próximo a vencer" reusa el mismo semáforo de vencimientos.js (rojo o
     amarillo): no se inventa un umbral de días propio de esta función.
     -------------------------------------------------------------------- */
  function recetasParaVencer(enriquecidos) {
    const prefs = DB.get('preferences', {});
    const invMap = inventarioNormalizado(enriquecidos);
    const perfilHogar = typeof AgenteHogar !== 'undefined' ? AgenteHogar.perfilCombinado() : null;
    const perfilEstilo = DB.get('stylePreferences', null);

    const prioritarios = [...invMap.values()]
      .filter((p) => p.urgencia === 'rojo' || p.urgencia === 'amarillo')
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    if (!prioritarios.length) return { prioritarios: [], combo: null, individuales: [] };

    const candidatas = evaluarCandidatas(invMap, prefs, perfilHogar, perfilEstilo, prioritarios[0]);

    // COMBO: la que más productos prioritarios rescata. Empate → gana la de
    // mayor puntaje normal. Si ninguna rescata ni uno, no hay combo — nunca
    // se ofrece un "combo" que en realidad no toca ningún producto urgente.
    const combo = candidatas
      .map((c) => ({ ...c, rescatados: contarRescatados(c.receta, prioritarios) }))
      .filter((c) => c.rescatados > 0)
      .sort((a, b) => b.rescatados - a.rescatados || b.puntaje - a.puntaje)[0] || null;

    // INDIVIDUALES: por cada producto prioritario, su mejor receta propia.
    // Puede repetir la del combo a propósito: son dos preguntas distintas.
    const individuales = prioritarios
      .map((p) => {
        const mejor = candidatas
          .filter((c) => c.receta.ingredients.some((ing) => canonizar(ing) === canonizar(p.name)))
          .sort((a, b) => b.puntaje - a.puntaje)[0];
        return mejor ? { producto: p, ...mejor } : null;
      })
      .filter(Boolean);

    return { prioritarios, combo, individuales };
  }

  /* ---- Reserva de exploración ------------------------------------------
     Un recomendador que sólo refuerza lo que ya sabe termina encerrando al
     usuario: si cocinaste italiana tres veces, la afinidad empuja italiana,
     y como sólo ves italiana nunca generás evidencia de que te guste otra
     cosa. La preferencia se vuelve una profecía autocumplida y el agente
     deja de aprender.

     Por eso el último lugar de la lista se reserva para la mejor receta que
     NO se está beneficiando del gusto aprendido. Sólo se aplica cuando hay
     lugar de sobra (más candidatas que espacios) y cuando el perfil ya está
     inclinando el ranking; si no, no hay nada de qué escapar.
     -------------------------------------------------------------------- */
  function conExploracion(ordenadas, maxSug) {
    const top = ordenadas.slice(0, maxSug);
    if (maxSug < 2 || ordenadas.length <= maxSug) return top;

    const haySesgo = top.some((c) => (c.afinidadEstilo || 0) > 0);
    if (!haySesgo) return top;

    const yaHayNeutra = top.some((c) => (c.afinidadEstilo || 0) <= 0);
    if (yaHayNeutra) return top;

    const neutra = ordenadas.find((c) => (c.afinidadEstilo || 0) <= 0);
    if (!neutra) return top;

    // Reemplaza la última (la de menor puntaje del top), nunca la primera:
    // lo más urgente sigue arriba.
    return [...top.slice(0, maxSug - 1), { ...neutra, esExploracion: true }];
  }

  // ---- Gestión de descartes (Evaluación del ciclo) ----
  // Si el usuario descarta una receta, deja de ofrecerse. Es una decisión
  // suya que el sistema debe respetar, no una sugerencia a repetir.
  function descartarReceta(recipeId) {
    const lista = DB.get('dismissedRecipes', []);
    if (lista.some((d) => d.recipeId === recipeId)) return lista;
    lista.push({ recipeId, timestamp: new Date().toISOString() });
    DB.set('dismissedRecipes', lista);
    return lista;
  }

  /* ---- Alternativas al descartar ---------------------------------------
     Descartar no es lo mismo que rendirse. Si el usuario rechaza "arroz con
     leche", el arroz que motivó la sugerencia sigue en la despensa y sigue
     por vencer: lo que corresponde es ofrecerle otra forma de usarlo, no
     mandarlo de vuelta a una lista donde la próxima sugerencia puede tratar
     de un producto completamente distinto.

     El criterio es el ingrediente CRÍTICO disponible: es el que hizo que la
     receta fuera elegible, y el que el usuario espera seguir aprovechando.
     Se buscan alternativas sobre un pool amplio (no las 3 de siempre) porque
     una alternativa útil puede estar más abajo en el ranking general.
     -------------------------------------------------------------------- */
  function alternativasA(recipeId, enriquecidos, max = 2) {
    const original = buscarReceta(recipeId);
    if (!original) return [];

    const ingMap = inventarioPorIngrediente(inventarioNormalizado(enriquecidos));
    const criticosDisponibles = original.critical
      .map(canonizar)
      .filter((n) => ingMap.has(n));
    if (!criticosDisponibles.length) return [];

    return suggestRecipes(enriquecidos, { max: catalogoRecetas().length })
      .filter((c) => c.receta.id !== recipeId)
      .filter((c) => c.receta.ingredients
        .some((ing) => criticosDisponibles.includes(canonizar(ing))))
      .slice(0, max);
  }

  function restaurarDescartadas() {
    DB.set('dismissedRecipes', []);
  }

  function listarDescartadas() {
    return DB.get('dismissedRecipes', [])
      .map((d) => ({ ...d, receta: buscarReceta(d.recipeId) }))
      .filter((d) => d.receta);
  }

  return {
    suggestRecipes, recetasParaVencer, descartarReceta, alternativasA,
    restaurarDescartadas, listarDescartadas,
    desglosarIngredientes, fraseDisponibilidad,
    canonizar, inventarioPorIngrediente, buscarEnDespensa, esMismoAlimento,
    afinidadEstilo, BONUS_PRIORITARIO, MAX_AFINIDAD,
    // Lo usa el Agente Generador: la exclusión de vencidos es la regla de
    // seguridad más importante y tiene que vivir en un solo lugar.
    inventarioDisponible: inventarioNormalizado
  };
})();
