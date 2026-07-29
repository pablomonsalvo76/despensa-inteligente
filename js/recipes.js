/**
 * recipes.js — Base de recetas y conocimiento culinario (Sección 3 y 4)
 * -----------------------------------------------------------------------
 * Dataset local usado por el Agente Cocinero. Cada receta declara:
 *  - ingredients: nombres normalizados (en minúscula) que deben matchear
 *    contra el nombre/categoría de productos del inventario.
 *  - critical: ingredientes NO sustituibles. Si falta alguno, la receta
 *    se descarta por completo (Sección 7: "no se sugieren recetas a las
 *    que les falten ingredientes críticos no sustituibles").
 *  - tags: usados para respetar restricciones alimentarias (Sección 7).
 *  - steps: instrucciones paso a paso. Una sugerencia sin instrucciones
 *    difícilmente se convierta en comida cocinada: el objetivo de la app no
 *    es nombrar un plato sino lograr que el producto en riesgo se consuma.
 */

const RECIPES = [
  {
    id: 'r01', name: 'Tortilla de papas',
    ingredients: ['huevo', 'papa', 'cebolla', 'aceite'], critical: ['huevo', 'papa'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'espanola', estilo: 'casera', tipo: 'principal', cookTimeMin: 30, servings: 4,
    steps: [
      'Pelá y cortá las papas en rodajas finas. Cortá la cebolla en pluma.',
      'Freí las papas y la cebolla a fuego bajo en abundante aceite, hasta que estén tiernas (no doradas). Escurrí el aceite.',
      'Batí los huevos en un bol con sal e incorporá las papas y la cebolla escurridas. Dejá reposar 5 minutos.',
      'Volcá la mezcla en una sartén con un hilo de aceite a fuego medio-bajo. Cociná 4-5 minutos.',
      'Tapá con un plato, dala vuelta y cociná 3-4 minutos del otro lado. Debe quedar jugosa por dentro.'
    ]
  },
  {
    id: 'r02', name: 'Arroz con verduras salteadas',
    ingredients: ['arroz', 'zanahoria', 'zapallito', 'cebolla', 'aceite', 'sal'], critical: ['arroz'],
    tags: ['vegetariano', 'vegano', 'sin_tacc'],
    cocina: 'asiatica', estilo: 'casera', tipo: 'principal', cookTimeMin: 25, servings: 3,
    steps: [
      'Herví el arroz en agua con sal según el tiempo del paquete. Colá y reservá.',
      'Cortá la cebolla, la zanahoria y el zapallito en cubos chicos y parejos.',
      'Calentá aceite en una sartén grande y salteá la cebolla 2 minutos.',
      'Sumá la zanahoria (5 minutos) y después el zapallito (3 minutos), a fuego fuerte para que queden al dente.',
      'Incorporá el arroz cocido, mezclá bien, salá y salteá 2 minutos más.'
    ]
  },
  {
    id: 'r03', name: 'Ensalada de tomate y lechuga',
    ingredients: ['tomate', 'lechuga', 'cebolla', 'aceite', 'sal'], critical: ['tomate', 'lechuga'],
    tags: ['vegetariano', 'vegano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'entrada', cookTimeMin: 10, servings: 2,
    steps: [
      'Lavá bien la lechuga hoja por hoja y secala. Cortala o rompela con la mano.',
      'Cortá el tomate en gajos y la cebolla en pluma fina.',
      'Si la cebolla está muy fuerte, dejala 5 minutos en agua fría para suavizarla.',
      'Mezclá todo en un bol y condimentá con aceite y sal justo antes de servir.'
    ]
  },
  {
    id: 'r04', name: 'Pollo al horno con papas',
    ingredients: ['pollo', 'papa', 'cebolla', 'aceite', 'sal'], critical: ['pollo'],
    tags: ['sin_tacc'],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 60, servings: 4,
    steps: [
      'Precalentá el horno a 200 °C.',
      'Cortá las papas en gajos y la cebolla en aros gruesos. Colocalas en una asadera.',
      'Salá el pollo por ambos lados y apoyalo sobre las papas. Rociá todo con aceite.',
      'Horneá 45-55 minutos, dando vuelta las papas a la mitad de la cocción.',
      'Verificá que el pollo esté bien cocido: los jugos deben salir transparentes, nunca rosados.'
    ]
  },
  {
    id: 'r05', name: 'Fideos con salsa de tomate',
    ingredients: ['fideos', 'tomate', 'cebolla', 'ajo', 'aceite'], critical: ['fideos', 'tomate'],
    tags: ['vegetariano'],
    cocina: 'italiana', estilo: 'casera', tipo: 'principal', cookTimeMin: 25, servings: 3,
    steps: [
      'Picá la cebolla y el ajo bien chiquitos. Cortá los tomates en cubos.',
      'Rehogá la cebolla y el ajo en aceite a fuego bajo, 5 minutos, sin que se quemen.',
      'Sumá el tomate, salá y cociná 15 minutos a fuego bajo, revolviendo cada tanto.',
      'Mientras tanto, herví los fideos en abundante agua con sal.',
      'Colá los fideos, mezclalos con la salsa y serví enseguida.'
    ]
  },
  {
    id: 'r06', name: 'Omelette de queso',
    ingredients: ['huevo', 'queso', 'sal'], critical: ['huevo', 'queso'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'principal', cookTimeMin: 10, servings: 1,
    steps: [
      'Batí 2-3 huevos con una pizca de sal hasta integrar bien.',
      'Calentá una sartén antiadherente a fuego medio con un poco de manteca o aceite.',
      'Volcá el huevo y dejá cuajar sin revolver, moviendo apenas los bordes hacia adentro.',
      'Cuando la superficie esté casi lista, poné el queso en una mitad.',
      'Doblá al medio, cociná 1 minuto más y serví.'
    ]
  },
  {
    id: 'r07', name: 'Sopa de verduras',
    ingredients: ['zanahoria', 'papa', 'zapallo', 'cebolla', 'apio', 'caldo'], critical: ['papa'],
    tags: ['vegetariano', 'vegano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'elaborada', tipo: 'entrada', cookTimeMin: 40, servings: 4,
    steps: [
      'Pelá y cortá en cubos todas las verduras que tengas disponibles.',
      'Rehogá la cebolla y el apio en una olla con aceite, 5 minutos.',
      'Sumá el resto de las verduras y cubrí con caldo o agua caliente.',
      'Cociná 25-30 minutos a fuego medio, hasta que todo esté tierno.',
      'Serví así o procesá para obtener una crema. Corregí la sal al final.'
    ]
  },
  {
    id: 'r08', name: 'Milanesas con puré',
    ingredients: ['carne', 'pan_rallado', 'huevo', 'papa', 'leche'], critical: ['carne'],
    tags: [],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 45, servings: 4,
    steps: [
      'Batí los huevos con sal en un plato hondo. Poné el pan rallado en otro.',
      'Pasá cada bife por huevo y después por pan rallado, presionando bien.',
      'Herví las papas en agua con sal hasta que estén tiernas (20 minutos).',
      'Pisá las papas con un poco de leche caliente y manteca hasta lograr un puré liso.',
      'Freí o horneá las milanesas hasta dorarlas de ambos lados. Serví con el puré.'
    ]
  },
  {
    id: 'r09', name: 'Yogur con frutas',
    ingredients: ['yogur', 'banana', 'manzana'], critical: ['yogur'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'desayuno', cookTimeMin: 5, servings: 1,
    steps: [
      'Cortá la fruta en cubos chicos. Si la banana está muy madura, pisala.',
      'Colocá el yogur en un bol.',
      'Sumá la fruta encima y mezclá suavemente. Ideal para aprovechar fruta muy madura.'
    ]
  },
  {
    id: 'r10', name: 'Licuado de banana y leche',
    ingredients: ['banana', 'leche', 'azucar'], critical: ['banana', 'leche'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'desayuno', cookTimeMin: 5, servings: 1,
    steps: [
      'Pelá la banana y cortala en trozos (sirve especialmente si ya está muy madura).',
      'Ponela en la licuadora con un vaso de leche bien fría.',
      'Licuá 30 segundos, endulzá a gusto y serví al momento.'
    ]
  },
  {
    id: 'r11', name: 'Tostadas con queso y tomate',
    ingredients: ['pan', 'queso', 'tomate'], critical: ['pan'],
    tags: ['vegetariano'],
    cocina: 'internacional', estilo: 'express', tipo: 'desayuno', cookTimeMin: 8, servings: 1,
    steps: [
      'Tostá las rebanadas de pan hasta que estén doradas.',
      'Cortá el tomate en rodajas finas y el queso en fetas.',
      'Armá las tostadas con el queso abajo y el tomate arriba.',
      'Opcional: llevá al horno o sartén tapada 2 minutos para fundir el queso. Salá y serví.'
    ]
  },
  {
    id: 'r12', name: 'Guiso de lentejas',
    ingredients: ['lentejas', 'zanahoria', 'papa', 'cebolla', 'chorizo'], critical: ['lentejas'],
    tags: [],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 50, servings: 4,
    steps: [
      'Si las lentejas no son de cocción rápida, dejalas en remojo unas horas.',
      'Rehogá la cebolla picada y el chorizo en rodajas en una olla, 5 minutos.',
      'Sumá la zanahoria y la papa en cubos, y rehogá 3 minutos más.',
      'Agregá las lentejas escurridas y cubrí con agua o caldo dos dedos por encima.',
      'Cociná 35-40 minutos a fuego bajo, revolviendo cada tanto. Salá al final.'
    ]
  },
  {
    id: 'r13', name: 'Arroz con leche',
    ingredients: ['arroz', 'leche', 'azucar', 'canela'], critical: ['arroz', 'leche'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'espanola', estilo: 'elaborada', tipo: 'postre', cookTimeMin: 40, servings: 4,
    steps: [
      'Poné el arroz en una olla con el doble de agua y cociná 10 minutos.',
      'Agregá la leche, el azúcar y una rama de canela.',
      'Cociná a fuego muy bajo 25-30 minutos, revolviendo seguido para que no se pegue.',
      'Retirá cuando esté cremoso (espesa más al enfriarse). Serví tibio o frío.'
    ]
  },
  {
    id: 'r14', name: 'Ensalada de frutas',
    ingredients: ['manzana', 'banana', 'naranja', 'uva'], critical: [],
    tags: ['vegetariano', 'vegano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'postre', cookTimeMin: 10, servings: 3,
    steps: [
      'Lavá y pelá las frutas que tengas. Cortalas en cubos parejos.',
      'Exprimí una naranja sobre la ensalada: el jugo evita que la manzana y la banana se oxiden.',
      'Mezclá con cuidado y llevá a la heladera 20 minutos antes de servir.'
    ]
  },
  {
    id: 'r15', name: 'Pizza casera',
    ingredients: ['harina', 'queso', 'tomate', 'aceite'], critical: ['harina', 'queso'],
    tags: ['vegetariano'],
    cocina: 'italiana', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 40, servings: 4,
    steps: [
      'Mezclá la harina con sal, un poco de aceite y agua tibia hasta formar un bollo liso.',
      'Dejá levar tapado 20-30 minutos en un lugar templado.',
      'Estirá la masa sobre una pizzera aceitada y precocinala 10 minutos a 220 °C.',
      'Cubrí con tomate triturado y condimentado, y después con el queso.',
      'Horneá 10-12 minutos más, hasta que el queso esté fundido y los bordes dorados.'
    ]
  },
  {
    id: 'r16', name: 'Pastel de papa',
    ingredients: ['carne', 'papa', 'cebolla', 'huevo', 'leche'], critical: ['carne', 'papa'],
    tags: ['sin_tacc'],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 50, servings: 4,
    steps: [
      'Herví las papas y pisalas con leche caliente y sal hasta formar un puré.',
      'Rehogá la cebolla picada y sumá la carne picada. Cociná hasta que pierda el color rosado.',
      'Condimentá el relleno y, si querés, sumá huevo duro picado.',
      'En una fuente, poné el relleno abajo y cubrí con el puré, emparejando con un tenedor.',
      'Gratiná en horno fuerte 15 minutos, hasta que la superficie esté dorada.'
    ]
  },
  {
    id: 'r17', name: 'Revuelto de zapallito',
    ingredients: ['zapallito', 'huevo', 'cebolla', 'aceite'], critical: ['zapallito', 'huevo'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'criolla', estilo: 'casera', tipo: 'principal', cookTimeMin: 15, servings: 2,
    steps: [
      'Cortá el zapallito en cubos chicos y la cebolla en pluma.',
      'Rehogá la cebolla en aceite 3 minutos, sumá el zapallito y cociná 6-8 minutos.',
      'Batí los huevos con sal y volcalos sobre las verduras.',
      'Revolvé constantemente a fuego bajo hasta que el huevo cuaje pero siga cremoso.'
    ]
  },
  {
    id: 'r18', name: 'Sándwich de jamón y queso',
    ingredients: ['pan', 'jamon', 'queso', 'manteca'], critical: ['pan', 'jamon'],
    tags: [],
    cocina: 'internacional', estilo: 'express', tipo: 'principal', cookTimeMin: 5, servings: 1,
    steps: [
      'Untá apenas de manteca la cara externa de cada rebanada de pan.',
      'Armá el sándwich con el jamón y el queso adentro.',
      'Cocinalo en sartén o sandwichera 3-4 minutos por lado, hasta dorar y fundir el queso.'
    ]
  },
  {
    id: 'r19', name: 'Puré de zapallo',
    ingredients: ['zapallo', 'manteca', 'sal'], critical: ['zapallo'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'casera', tipo: 'guarnicion', cookTimeMin: 25, servings: 3,
    steps: [
      'Pelá el zapallo y cortalo en cubos grandes.',
      'Herví en agua con sal 15-20 minutos, hasta que se deshaga al pincharlo.',
      'Colá muy bien (el zapallo retiene mucha agua) y pisá.',
      'Sumá manteca y sal, mezclá y serví caliente.'
    ]
  },
  {
    id: 'r20', name: 'Ensalada de garbanzos',
    ingredients: ['garbanzos', 'tomate', 'cebolla', 'aceite'], critical: ['garbanzos'],
    tags: ['vegetariano', 'vegano', 'sin_tacc'],
    cocina: 'mediterranea', estilo: 'casera', tipo: 'entrada', cookTimeMin: 15, servings: 3,
    steps: [
      'Escurrí y enjuagá bien los garbanzos si son de lata.',
      'Cortá el tomate en cubos y la cebolla bien chiquita.',
      'Mezclá todo en un bol.',
      'Condimentá con aceite, sal y, si tenés, un chorrito de limón. Mejora si reposa 10 minutos.'
    ]
  },
  {
    id: 'r21', name: 'Fideos con manteca y queso',
    ingredients: ['fideos', 'manteca', 'queso'], critical: ['fideos'],
    tags: ['vegetariano'],
    cocina: 'italiana', estilo: 'casera', tipo: 'principal', cookTimeMin: 15, servings: 2,
    steps: [
      'Herví los fideos en abundante agua con sal hasta que estén al dente.',
      'Antes de colar, guardá medio vaso del agua de cocción.',
      'Colá y devolvé los fideos a la olla con la manteca, revolviendo para que se derrita.',
      'Sumá el queso rallado y un poco del agua reservada para lograr una crema. Serví enseguida.'
    ]
  },
  {
    id: 'r22', name: 'Tarta de zapallito',
    ingredients: ['zapallito', 'huevo', 'harina', 'queso', 'cebolla'], critical: ['zapallito', 'harina'],
    tags: ['vegetariano'],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 45, servings: 4,
    steps: [
      'Rehogá la cebolla y el zapallito cortados en cubos, hasta que suelten el agua y se evapore.',
      'Dejá entibiar y mezclá con los huevos batidos y el queso.',
      'Forrá una tartera con la masa (comprada o casera) y volcá el relleno.',
      'Horneá a 190 °C durante 30-35 minutos, hasta que esté firme y dorada.'
    ]
  },
  {
    id: 'r23', name: 'Pollo con arroz',
    ingredients: ['pollo', 'arroz', 'zanahoria', 'cebolla'], critical: ['pollo', 'arroz'],
    tags: ['sin_tacc'],
    cocina: 'criolla', estilo: 'elaborada', tipo: 'principal', cookTimeMin: 40, servings: 3,
    steps: [
      'Cortá el pollo en cubos y sellalo en una olla con aceite hasta dorarlo. Reservá.',
      'En la misma olla rehogá la cebolla y la zanahoria picadas, 5 minutos.',
      'Sumá el arroz y revolvé 1 minuto para que se impregne.',
      'Volvé a poner el pollo, cubrí con el doble de caldo o agua caliente y salá.',
      'Cociná tapado a fuego bajo 18-20 minutos, sin revolver, hasta que absorba el líquido.'
    ]
  },
  {
    id: 'r24', name: 'Panqueques',
    ingredients: ['harina', 'huevo', 'leche', 'azucar'], critical: ['harina', 'huevo'],
    tags: ['vegetariano'],
    cocina: 'internacional', estilo: 'casera', tipo: 'postre', cookTimeMin: 20, servings: 3,
    steps: [
      'Batí los huevos con la leche y una pizca de sal.',
      'Incorporá la harina de a poco, batiendo para que no queden grumos. Dejá reposar 15 minutos.',
      'Calentá una sartén antiadherente apenas aceitada.',
      'Volcá un cucharón de mezcla, girá la sartén para cubrir la base y cociná 1 minuto por lado.',
      'Rellenalos dulces o salados según lo que tengas por consumir.'
    ]
  },
  {
    id: 'r25', name: 'Yogur con granola',
    ingredients: ['yogur', 'avena', 'banana'], critical: ['yogur'],
    tags: ['vegetariano', 'sin_tacc'],
    cocina: 'internacional', estilo: 'express', tipo: 'desayuno', cookTimeMin: 5, servings: 1,
    steps: [
      'Opcional: tostá la avena en una sartén seca 3 minutos para que quede crocante.',
      'Poné el yogur en un bol.',
      'Sumá la avena y la banana en rodajas. Mezclá y consumí al momento para que no se ablande.'
    ]
  },
  {
    id: 'r26', name: 'Salteado de carne y verduras',
    ingredients: ['carne', 'zanahoria', 'zapallito', 'cebolla', 'aceite'], critical: ['carne'],
    tags: ['sin_tacc'],
    cocina: 'asiatica', estilo: 'casera', tipo: 'principal', cookTimeMin: 25, servings: 3,
    steps: [
      'Cortá la carne en tiras finas y las verduras en bastones parejos.',
      'Calentá bien una sartén grande con aceite: el fuego fuerte evita que se hiervan.',
      'Sellá la carne 2-3 minutos y retirala. Reservá.',
      'Salteá las verduras 5-6 minutos, empezando por la zanahoria (la más dura).',
      'Devolvé la carne, mezclá, salá y cociná 2 minutos más.'
    ]
  },
  {
    id: 'r27', name: 'Sopa de fideos',
    ingredients: ['fideos', 'caldo', 'zanahoria', 'apio'], critical: ['fideos'],
    tags: ['vegetariano'],
    cocina: 'internacional', estilo: 'casera', tipo: 'entrada', cookTimeMin: 20, servings: 3,
    steps: [
      'Cortá la zanahoria y el apio en cubos chicos.',
      'Llevá el caldo a hervor y sumá las verduras. Cociná 8 minutos.',
      'Agregá los fideos y cociná el tiempo que indique el paquete.',
      'Corregí la sal y serví bien caliente.'
    ]
  }
];

/**
 * Cantidades de referencia por ingrediente, expresadas POR PORCIÓN.
 * Se escalan según las porciones de la receta para mostrar una lista de
 * ingredientes concreta ("Arroz — 1 taza") en lugar de un nombre suelto.
 * Son cantidades orientativas de cocina casera, no una tabla nutricional.
 */
const CANTIDADES_POR_PORCION = {
  arroz: { cant: 0.33, unidad: 'taza' },
  fideos: { cant: 80, unidad: 'g' },
  harina: { cant: 60, unidad: 'g' },
  avena: { cant: 40, unidad: 'g' },
  pan: { cant: 2, unidad: 'rebanadas' },
  pan_rallado: { cant: 40, unidad: 'g' },
  lentejas: { cant: 60, unidad: 'g' },
  garbanzos: { cant: 60, unidad: 'g' },
  leche: { cant: 200, unidad: 'ml' },
  yogur: { cant: 150, unidad: 'g' },
  queso: { cant: 50, unidad: 'g' },
  manteca: { cant: 15, unidad: 'g' },
  huevo: { cant: 1.5, unidad: 'unidades' },
  carne: { cant: 150, unidad: 'g' },
  pollo: { cant: 180, unidad: 'g' },
  jamon: { cant: 40, unidad: 'g' },
  chorizo: { cant: 50, unidad: 'g' },
  papa: { cant: 1.5, unidad: 'unidades' },
  cebolla: { cant: 0.5, unidad: 'unidad' },
  tomate: { cant: 1, unidad: 'unidad' },
  zanahoria: { cant: 1, unidad: 'unidad' },
  zapallito: { cant: 1, unidad: 'unidad' },
  zapallo: { cant: 200, unidad: 'g' },
  lechuga: { cant: 0.5, unidad: 'planta' },
  apio: { cant: 1, unidad: 'rama' },
  ajo: { cant: 1, unidad: 'diente' },
  banana: { cant: 1, unidad: 'unidad' },
  manzana: { cant: 1, unidad: 'unidad' },
  naranja: { cant: 1, unidad: 'unidad' },
  uva: { cant: 80, unidad: 'g' },
  caldo: { cant: 300, unidad: 'ml' },
  aceite: { cant: 1, unidad: 'cda' },
  sal: { cant: 1, unidad: 'a gusto' },
  azucar: { cant: 1, unidad: 'cda' },
  // Los aromáticos no escalan con las porciones: una rama de canela alcanza
  // igual para 1 que para 4 platos.
  canela: { cant: 1, unidad: 'rama', noEscala: true }
};

// Convierte 0.5 -> "1/2", 0.33 -> "1/3", 1.5 -> "1 1/2" (más legible en cocina).
function formatearCantidad(n) {
  const entero = Math.floor(n);
  const resto = n - entero;
  let fraccion = '';
  if (resto > 0.7) return String(entero + 1);
  if (resto > 0.6) fraccion = '2/3';
  else if (resto > 0.45) fraccion = '1/2';
  else if (resto > 0.28) fraccion = '1/3';
  else if (resto > 0.1) fraccion = '1/4';
  if (!fraccion) return String(entero || (n < 1 ? Math.round(n * 100) / 100 : entero));
  return entero > 0 ? `${entero} ${fraccion}` : fraccion;
}

/**
 * Devuelve la lista de ingredientes de una receta con cantidad y unidad,
 * escalada a las porciones que rinde.
 */
function ingredientesConCantidad(receta) {
  return receta.ingredients.map((ing) => {
    const base = CANTIDADES_POR_PORCION[ing];
    const nombre = ing.replace(/_/g, ' ');
    if (!base) return { nombre, cantidad: 'a gusto' };
    if (base.unidad === 'a gusto') return { nombre, cantidad: 'a gusto' };

    const total = base.noEscala ? base.cant : base.cant * receta.servings;
    // Gramos y mililitros se redondean a múltiplos prácticos
    if (base.unidad === 'g' || base.unidad === 'ml') {
      const redondeado = total >= 100 ? Math.round(total / 50) * 50 : Math.round(total / 10) * 10;
      return { nombre, cantidad: `${redondeado} ${base.unidad}` };
    }
    return { nombre, cantidad: `${formatearCantidad(total)} ${base.unidad}` };
  });
}

// Rango unicode de tildes/diacríticos, escrito en ASCII para evitar
// problemas de codificación al editar el archivo.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

// Normaliza un texto (nombre de producto) para poder matchear contra
// ingredientes de recetas: minúsculas, sin tildes, singular aproximado.
function normalizeName(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(DIACRITICOS, '')
    .trim()
    .replace(/s$/, ''); // heurística simple de singularización
}
