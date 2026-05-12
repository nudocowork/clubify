/**
 * Biblioteca de emojis tipo WhatsApp con buscador bilingüe ES/EN.
 * Render: emoji unicode nativo (cada OS lo dibuja con su set propio —
 * Apple emoji en iOS/Mac, Noto en Android/Linux, Segoe en Windows). En
 * Konva.Text salen como en cualquier sistema, sin necesidad de
 * sprites/Twemoji.
 *
 * El buscador hace match contra `name` + `keywords` (ambos arrays para
 * acentos y plurales). Las búsquedas son case-insensitive y
 * accent-insensitive.
 *
 * Cómo extender: agregar entradas en EMOJI_DATA. Mantener el shape
 * exacto. Las categorías muestran en el orden declarado.
 */

export type EmojiEntry = {
  /** Emoji unicode renderizable. */
  e: string;
  /** Nombre principal (usado como título en hover). */
  n: string;
  /** Keywords para búsqueda (incluir ES + EN + sinónimos). */
  k: string[];
  /** Categoría para agrupar en el picker. */
  c: EmojiCategory;
};

export type EmojiCategory =
  | 'smileys'
  | 'people'
  | 'animals'
  | 'food'
  | 'activity'
  | 'travel'
  | 'objects'
  | 'symbols'
  | 'flags';

export const CATEGORY_LABELS: Record<EmojiCategory, string> = {
  smileys: 'Caritas',
  people: 'Personas',
  animals: 'Animales y naturaleza',
  food: 'Comida y bebida',
  activity: 'Actividades',
  travel: 'Viajes y lugares',
  objects: 'Objetos',
  symbols: 'Símbolos',
  flags: 'Banderas',
};

export const CATEGORY_ICONS: Record<EmojiCategory, string> = {
  smileys: '😀',
  people: '👤',
  animals: '🐶',
  food: '🍕',
  activity: '⚽',
  travel: '✈️',
  objects: '💡',
  symbols: '❤️',
  flags: '🏳️',
};

/** Banco de emojis. Curado a mano — los más usados en cartelería de
 *  negocios locales (comida, fitness, belleza, eventos, símbolos). */
export const EMOJI_DATA: EmojiEntry[] = [
  // ───────── Smileys ─────────
  { e: '😀', n: 'sonrisa', k: ['smile', 'happy', 'feliz', 'sonreír', 'alegre'], c: 'smileys' },
  { e: '😃', n: 'sonrisa con ojos abiertos', k: ['smile', 'happy', 'feliz'], c: 'smileys' },
  { e: '😄', n: 'sonrisa abierta', k: ['smile', 'happy', 'feliz', 'alegre'], c: 'smileys' },
  { e: '😁', n: 'sonrisa con dientes', k: ['smile', 'grin', 'feliz', 'sonrisa'], c: 'smileys' },
  { e: '😆', n: 'risa', k: ['laugh', 'risa', 'reír'], c: 'smileys' },
  { e: '😅', n: 'risa sudor', k: ['sweat', 'sudor', 'nervioso'], c: 'smileys' },
  { e: '🤣', n: 'muriendo de risa', k: ['rofl', 'lol', 'risa', 'carcajada'], c: 'smileys' },
  { e: '😂', n: 'lágrimas de risa', k: ['joy', 'cry', 'risa', 'llorar'], c: 'smileys' },
  { e: '🙂', n: 'sonrisa suave', k: ['slight smile', 'sonrisa'], c: 'smileys' },
  { e: '😉', n: 'guiño', k: ['wink', 'guiño', 'guiñar'], c: 'smileys' },
  { e: '😊', n: 'sonrisa tímida', k: ['blush', 'smile', 'feliz', 'sonrojo'], c: 'smileys' },
  { e: '😇', n: 'angelical', k: ['angel', 'ángel', 'inocente'], c: 'smileys' },
  { e: '🥰', n: 'enamorado', k: ['love', 'amor', 'corazones'], c: 'smileys' },
  { e: '😍', n: 'corazones en los ojos', k: ['love', 'heart eyes', 'amor', 'enamorado'], c: 'smileys' },
  { e: '🤩', n: 'estrella', k: ['star', 'estrella', 'wow'], c: 'smileys' },
  { e: '😘', n: 'beso', k: ['kiss', 'beso'], c: 'smileys' },
  { e: '😋', n: 'delicioso', k: ['yum', 'tasty', 'rico', 'sabroso', 'delicioso'], c: 'smileys' },
  { e: '😎', n: 'cool', k: ['cool', 'sunglasses', 'lentes', 'genial'], c: 'smileys' },
  { e: '🤓', n: 'nerd', k: ['nerd', 'estudioso'], c: 'smileys' },
  { e: '🥳', n: 'fiesta', k: ['party', 'fiesta', 'cumpleaños'], c: 'smileys' },
  { e: '🤔', n: 'pensando', k: ['think', 'pensar', 'duda'], c: 'smileys' },
  { e: '😴', n: 'durmiendo', k: ['sleep', 'dormir'], c: 'smileys' },
  { e: '🤤', n: 'baba', k: ['drool', 'antojo', 'hambre'], c: 'smileys' },
  { e: '😱', n: 'shock', k: ['scream', 'shock', 'sorpresa', 'asustado'], c: 'smileys' },
  { e: '🤯', n: 'mente volada', k: ['mind blown', 'wow', 'sorprendido'], c: 'smileys' },

  // ───────── People ─────────
  { e: '👤', n: 'persona', k: ['person', 'persona', 'usuario'], c: 'people' },
  { e: '👥', n: 'grupo', k: ['group', 'people', 'grupo', 'gente'], c: 'people' },
  { e: '👋', n: 'saludo', k: ['wave', 'hello', 'hola', 'saludo'], c: 'people' },
  { e: '🤝', n: 'apretón de manos', k: ['handshake', 'deal', 'acuerdo'], c: 'people' },
  { e: '👏', n: 'aplauso', k: ['clap', 'aplauso', 'felicitar'], c: 'people' },
  { e: '🙌', n: 'manos arriba', k: ['raise hands', 'celebrar'], c: 'people' },
  { e: '🙏', n: 'gracias', k: ['pray', 'thanks', 'gracias', 'orar'], c: 'people' },
  { e: '👍', n: 'pulgar arriba', k: ['thumbs up', 'like', 'me gusta', 'aprobado'], c: 'people' },
  { e: '👎', n: 'pulgar abajo', k: ['thumbs down', 'dislike'], c: 'people' },
  { e: '👌', n: 'OK', k: ['ok', 'perfect', 'perfecto'], c: 'people' },
  { e: '✌️', n: 'paz', k: ['peace', 'victoria', 'paz'], c: 'people' },
  { e: '🤞', n: 'cruzar dedos', k: ['fingers crossed', 'suerte'], c: 'people' },
  { e: '👇', n: 'señalar abajo', k: ['point down', 'abajo', 'señalar'], c: 'people' },
  { e: '👆', n: 'señalar arriba', k: ['point up', 'arriba', 'señalar'], c: 'people' },
  { e: '👉', n: 'señalar derecha', k: ['point right', 'derecha'], c: 'people' },
  { e: '👈', n: 'señalar izquierda', k: ['point left', 'izquierda'], c: 'people' },
  { e: '💪', n: 'músculo', k: ['muscle', 'strong', 'fuerza', 'gym', 'fitness'], c: 'people' },
  { e: '🦾', n: 'brazo mecánico', k: ['mechanical arm', 'fuerza'], c: 'people' },
  { e: '🧠', n: 'cerebro', k: ['brain', 'cerebro', 'inteligencia'], c: 'people' },
  { e: '👀', n: 'ojos', k: ['eyes', 'ojos', 'mirar'], c: 'people' },
  { e: '👶', n: 'bebé', k: ['baby', 'bebé', 'niño'], c: 'people' },
  { e: '🧑‍🍳', n: 'chef', k: ['chef', 'cocinero', 'cocina'], c: 'people' },
  { e: '👨‍🍳', n: 'chef hombre', k: ['chef', 'cocinero'], c: 'people' },
  { e: '👩‍🍳', n: 'chef mujer', k: ['chef', 'cocinera'], c: 'people' },
  { e: '💇', n: 'corte de pelo', k: ['haircut', 'salón', 'peluquería'], c: 'people' },
  { e: '💆', n: 'masaje', k: ['massage', 'spa', 'masaje'], c: 'people' },
  { e: '💅', n: 'uñas', k: ['nails', 'uñas', 'manicura'], c: 'people' },
  { e: '🧘', n: 'meditación', k: ['yoga', 'meditate', 'yoga', 'meditar'], c: 'people' },
  { e: '🏋️', n: 'levantamiento', k: ['weight lifting', 'gym', 'pesas', 'fitness'], c: 'people' },
  { e: '🤸', n: 'gimnasia', k: ['gymnastics', 'cartwheel'], c: 'people' },

  // ───────── Animals ─────────
  { e: '🐶', n: 'perro', k: ['dog', 'puppy', 'perro', 'cachorro', 'veterinaria'], c: 'animals' },
  { e: '🐱', n: 'gato', k: ['cat', 'gato', 'minino'], c: 'animals' },
  { e: '🐭', n: 'ratón', k: ['mouse', 'ratón'], c: 'animals' },
  { e: '🐹', n: 'hámster', k: ['hamster', 'hamster'], c: 'animals' },
  { e: '🐰', n: 'conejo', k: ['rabbit', 'bunny', 'conejo'], c: 'animals' },
  { e: '🦊', n: 'zorro', k: ['fox', 'zorro'], c: 'animals' },
  { e: '🐻', n: 'oso', k: ['bear', 'oso'], c: 'animals' },
  { e: '🐼', n: 'panda', k: ['panda'], c: 'animals' },
  { e: '🐨', n: 'koala', k: ['koala'], c: 'animals' },
  { e: '🐯', n: 'tigre', k: ['tiger', 'tigre'], c: 'animals' },
  { e: '🦁', n: 'león', k: ['lion', 'león'], c: 'animals' },
  { e: '🐮', n: 'vaca', k: ['cow', 'vaca'], c: 'animals' },
  { e: '🐷', n: 'cerdo', k: ['pig', 'cerdo', 'chancho'], c: 'animals' },
  { e: '🐸', n: 'rana', k: ['frog', 'rana'], c: 'animals' },
  { e: '🐵', n: 'mono', k: ['monkey', 'mono'], c: 'animals' },
  { e: '🐔', n: 'pollo', k: ['chicken', 'pollo'], c: 'animals' },
  { e: '🐧', n: 'pingüino', k: ['penguin', 'pingüino'], c: 'animals' },
  { e: '🐦', n: 'pájaro', k: ['bird', 'pájaro'], c: 'animals' },
  { e: '🦅', n: 'águila', k: ['eagle', 'águila'], c: 'animals' },
  { e: '🦋', n: 'mariposa', k: ['butterfly', 'mariposa'], c: 'animals' },
  { e: '🐝', n: 'abeja', k: ['bee', 'abeja', 'miel'], c: 'animals' },
  { e: '🐠', n: 'pez', k: ['fish', 'pez', 'pescado'], c: 'animals' },
  { e: '🐙', n: 'pulpo', k: ['octopus', 'pulpo'], c: 'animals' },
  { e: '🌸', n: 'flor cerezo', k: ['flower', 'flor', 'cerezo', 'sakura'], c: 'animals' },
  { e: '🌺', n: 'hibisco', k: ['flower', 'flor', 'hibisco'], c: 'animals' },
  { e: '🌻', n: 'girasol', k: ['sunflower', 'girasol', 'flor'], c: 'animals' },
  { e: '🌷', n: 'tulipán', k: ['tulip', 'tulipán', 'flor'], c: 'animals' },
  { e: '🌹', n: 'rosa', k: ['rose', 'rosa', 'flor'], c: 'animals' },
  { e: '🌳', n: 'árbol', k: ['tree', 'árbol'], c: 'animals' },
  { e: '🌲', n: 'pino', k: ['evergreen', 'tree', 'pino'], c: 'animals' },
  { e: '🌴', n: 'palmera', k: ['palm', 'palmera', 'tropical'], c: 'animals' },
  { e: '🍀', n: 'trébol', k: ['clover', 'lucky', 'trébol', 'suerte'], c: 'animals' },
  { e: '🌿', n: 'hojas', k: ['herb', 'plant', 'hierba', 'plantas'], c: 'animals' },
  { e: '🌱', n: 'brote', k: ['seedling', 'planta', 'brote', 'orgánico'], c: 'animals' },

  // ───────── Food ─────────
  { e: '☕', n: 'café', k: ['coffee', 'café', 'expreso'], c: 'food' },
  { e: '🍵', n: 'té', k: ['tea', 'té', 'matcha'], c: 'food' },
  { e: '🧉', n: 'mate', k: ['mate', 'yerba'], c: 'food' },
  { e: '🥤', n: 'bebida', k: ['cup', 'drink', 'bebida', 'jugo', 'soda'], c: 'food' },
  { e: '🧋', n: 'bubble tea', k: ['bubble tea', 'boba'], c: 'food' },
  { e: '🍷', n: 'vino', k: ['wine', 'vino'], c: 'food' },
  { e: '🍺', n: 'cerveza', k: ['beer', 'cerveza'], c: 'food' },
  { e: '🍻', n: 'brindis cerveza', k: ['cheers', 'beer', 'brindis'], c: 'food' },
  { e: '🍸', n: 'martini', k: ['martini', 'cocktail', 'coctel'], c: 'food' },
  { e: '🍹', n: 'tropical', k: ['cocktail', 'tropical', 'tragos'], c: 'food' },
  { e: '🥂', n: 'champagne', k: ['champagne', 'brindis', 'cheers'], c: 'food' },
  { e: '🍾', n: 'champaña botella', k: ['champagne', 'celebración'], c: 'food' },
  { e: '🥃', n: 'whisky', k: ['whisky', 'whiskey', 'tumbler'], c: 'food' },
  { e: '🧊', n: 'hielo', k: ['ice', 'hielo'], c: 'food' },
  { e: '🍕', n: 'pizza', k: ['pizza'], c: 'food' },
  { e: '🍔', n: 'hamburguesa', k: ['burger', 'hamburger', 'hamburguesa'], c: 'food' },
  { e: '🌭', n: 'hot dog', k: ['hot dog', 'pancho', 'salchicha'], c: 'food' },
  { e: '🍟', n: 'papas fritas', k: ['fries', 'french fries', 'papas fritas'], c: 'food' },
  { e: '🌮', n: 'taco', k: ['taco'], c: 'food' },
  { e: '🌯', n: 'burrito', k: ['burrito', 'wrap'], c: 'food' },
  { e: '🥙', n: 'shawarma', k: ['kebab', 'shawarma'], c: 'food' },
  { e: '🥗', n: 'ensalada', k: ['salad', 'ensalada', 'healthy', 'saludable'], c: 'food' },
  { e: '🍲', n: 'sopa', k: ['soup', 'sopa', 'caldo', 'stew'], c: 'food' },
  { e: '🍝', n: 'pasta', k: ['pasta', 'spaghetti', 'fideos'], c: 'food' },
  { e: '🍜', n: 'ramen', k: ['ramen', 'noodles', 'fideos'], c: 'food' },
  { e: '🍣', n: 'sushi', k: ['sushi'], c: 'food' },
  { e: '🍱', n: 'bento', k: ['bento', 'lunch box'], c: 'food' },
  { e: '🍙', n: 'onigiri', k: ['onigiri', 'rice ball'], c: 'food' },
  { e: '🥘', n: 'paella', k: ['paella', 'pan', 'sartén'], c: 'food' },
  { e: '🥩', n: 'carne', k: ['steak', 'meat', 'carne', 'asado'], c: 'food' },
  { e: '🍖', n: 'costilla', k: ['ribs', 'asado', 'costilla'], c: 'food' },
  { e: '🍗', n: 'pollo frito', k: ['chicken leg', 'pollo'], c: 'food' },
  { e: '🥓', n: 'bacon', k: ['bacon', 'panceta', 'tocino'], c: 'food' },
  { e: '🍳', n: 'huevo frito', k: ['fried egg', 'huevo', 'desayuno'], c: 'food' },
  { e: '🥐', n: 'croissant', k: ['croissant', 'medialuna'], c: 'food' },
  { e: '🥖', n: 'baguette', k: ['baguette', 'pan'], c: 'food' },
  { e: '🍞', n: 'pan', k: ['bread', 'pan'], c: 'food' },
  { e: '🧀', n: 'queso', k: ['cheese', 'queso'], c: 'food' },
  { e: '🥪', n: 'sandwich', k: ['sandwich', 'sándwich'], c: 'food' },
  { e: '🍰', n: 'torta', k: ['cake', 'torta', 'pastel'], c: 'food' },
  { e: '🎂', n: 'pastel cumpleaños', k: ['birthday cake', 'cumpleaños', 'pastel'], c: 'food' },
  { e: '🧁', n: 'cupcake', k: ['cupcake', 'magdalena'], c: 'food' },
  { e: '🥧', n: 'pie', k: ['pie', 'tarta'], c: 'food' },
  { e: '🍩', n: 'donut', k: ['donut', 'doughnut', 'rosquilla'], c: 'food' },
  { e: '🍪', n: 'galleta', k: ['cookie', 'galleta', 'biscuit'], c: 'food' },
  { e: '🍫', n: 'chocolate', k: ['chocolate'], c: 'food' },
  { e: '🍬', n: 'caramelo', k: ['candy', 'caramelo', 'dulce'], c: 'food' },
  { e: '🍭', n: 'paleta', k: ['lollipop', 'paleta', 'chupetín'], c: 'food' },
  { e: '🍦', n: 'helado', k: ['ice cream', 'helado'], c: 'food' },
  { e: '🍨', n: 'helado bowl', k: ['ice cream', 'helado'], c: 'food' },
  { e: '🍧', n: 'raspado', k: ['shaved ice', 'raspado'], c: 'food' },
  { e: '🍓', n: 'fresa', k: ['strawberry', 'fresa', 'frutilla'], c: 'food' },
  { e: '🍎', n: 'manzana', k: ['apple', 'manzana'], c: 'food' },
  { e: '🍌', n: 'banana', k: ['banana', 'banana', 'plátano'], c: 'food' },
  { e: '🍊', n: 'naranja', k: ['orange', 'naranja'], c: 'food' },
  { e: '🍋', n: 'limón', k: ['lemon', 'limón'], c: 'food' },
  { e: '🍇', n: 'uvas', k: ['grapes', 'uvas'], c: 'food' },
  { e: '🍉', n: 'sandía', k: ['watermelon', 'sandía'], c: 'food' },
  { e: '🍑', n: 'durazno', k: ['peach', 'durazno', 'melocotón'], c: 'food' },
  { e: '🥑', n: 'palta', k: ['avocado', 'palta', 'aguacate'], c: 'food' },
  { e: '🥥', n: 'coco', k: ['coconut', 'coco'], c: 'food' },
  { e: '🫐', n: 'arándanos', k: ['blueberry', 'arándanos'], c: 'food' },
  { e: '🥝', n: 'kiwi', k: ['kiwi'], c: 'food' },

  // ───────── Activity ─────────
  { e: '⚽', n: 'fútbol', k: ['soccer', 'football', 'fútbol', 'futbol'], c: 'activity' },
  { e: '🏀', n: 'baloncesto', k: ['basketball', 'baloncesto', 'básquet'], c: 'activity' },
  { e: '🏈', n: 'fútbol americano', k: ['american football'], c: 'activity' },
  { e: '⚾', n: 'béisbol', k: ['baseball', 'béisbol'], c: 'activity' },
  { e: '🎾', n: 'tenis', k: ['tennis', 'tenis'], c: 'activity' },
  { e: '🏐', n: 'voleibol', k: ['volleyball', 'voleibol'], c: 'activity' },
  { e: '🏓', n: 'ping pong', k: ['ping pong', 'tenis de mesa'], c: 'activity' },
  { e: '🏸', n: 'bádminton', k: ['badminton'], c: 'activity' },
  { e: '🥊', n: 'box', k: ['boxing', 'box', 'guante'], c: 'activity' },
  { e: '🎯', n: 'diana', k: ['target', 'objetivo', 'meta', 'diana'], c: 'activity' },
  { e: '🎮', n: 'gamepad', k: ['gaming', 'videojuegos', 'control'], c: 'activity' },
  { e: '🎲', n: 'dado', k: ['dice', 'dado', 'azar'], c: 'activity' },
  { e: '🎨', n: 'arte', k: ['art', 'paint', 'arte', 'paleta'], c: 'activity' },
  { e: '🎭', n: 'teatro', k: ['theater', 'teatro', 'máscaras'], c: 'activity' },
  { e: '🎤', n: 'micrófono', k: ['microphone', 'karaoke', 'micrófono'], c: 'activity' },
  { e: '🎧', n: 'auriculares', k: ['headphones', 'música', 'auriculares'], c: 'activity' },
  { e: '🎵', n: 'nota musical', k: ['music', 'música', 'nota'], c: 'activity' },
  { e: '🎬', n: 'cine', k: ['movie', 'film', 'cine'], c: 'activity' },
  { e: '📸', n: 'cámara', k: ['camera', 'foto', 'cámara'], c: 'activity' },

  // ───────── Travel ─────────
  { e: '🚗', n: 'auto', k: ['car', 'auto', 'coche'], c: 'travel' },
  { e: '🚕', n: 'taxi', k: ['taxi'], c: 'travel' },
  { e: '🚙', n: 'SUV', k: ['suv'], c: 'travel' },
  { e: '🚌', n: 'bus', k: ['bus', 'colectivo'], c: 'travel' },
  { e: '🏍️', n: 'moto', k: ['motorcycle', 'moto'], c: 'travel' },
  { e: '🚲', n: 'bici', k: ['bicycle', 'bici', 'bicicleta'], c: 'travel' },
  { e: '🛵', n: 'scooter', k: ['scooter'], c: 'travel' },
  { e: '✈️', n: 'avión', k: ['airplane', 'avión', 'viaje'], c: 'travel' },
  { e: '🏠', n: 'casa', k: ['house', 'home', 'casa', 'hogar'], c: 'travel' },
  { e: '🏢', n: 'oficina', k: ['office', 'building', 'oficina', 'edificio'], c: 'travel' },
  { e: '🏥', n: 'hospital', k: ['hospital'], c: 'travel' },
  { e: '🏪', n: 'tienda', k: ['store', 'shop', 'tienda', 'almacén'], c: 'travel' },
  { e: '🛍️', n: 'compras', k: ['shopping', 'bags', 'compras', 'bolsa'], c: 'travel' },
  { e: '🏝️', n: 'isla', k: ['island', 'isla', 'tropical'], c: 'travel' },
  { e: '🏖️', n: 'playa', k: ['beach', 'playa'], c: 'travel' },
  { e: '🏔️', n: 'montaña', k: ['mountain', 'montaña'], c: 'travel' },
  { e: '🌅', n: 'amanecer', k: ['sunrise', 'amanecer'], c: 'travel' },
  { e: '🌆', n: 'ciudad', k: ['cityscape', 'ciudad'], c: 'travel' },
  { e: '🌃', n: 'noche', k: ['night', 'noche', 'ciudad'], c: 'travel' },
  { e: '☀️', n: 'sol', k: ['sun', 'sol'], c: 'travel' },
  { e: '🌙', n: 'luna', k: ['moon', 'luna'], c: 'travel' },
  { e: '⭐', n: 'estrella', k: ['star', 'estrella', 'premio'], c: 'travel' },
  { e: '🌟', n: 'estrella brillante', k: ['glowing star', 'estrella'], c: 'travel' },
  { e: '☁️', n: 'nube', k: ['cloud', 'nube'], c: 'travel' },
  { e: '⛅', n: 'sol nubes', k: ['partly cloudy', 'sol', 'nubes'], c: 'travel' },
  { e: '🌈', n: 'arcoíris', k: ['rainbow', 'arcoíris'], c: 'travel' },

  // ───────── Objects ─────────
  { e: '💡', n: 'idea', k: ['idea', 'bulb', 'foco', 'bombilla'], c: 'objects' },
  { e: '🔥', n: 'fuego', k: ['fire', 'fuego', 'hot', 'caliente'], c: 'objects' },
  { e: '💎', n: 'diamante', k: ['diamond', 'gem', 'diamante', 'lujo'], c: 'objects' },
  { e: '👑', n: 'corona', k: ['crown', 'corona', 'rey', 'premium'], c: 'objects' },
  { e: '🎁', n: 'regalo', k: ['gift', 'present', 'regalo', 'sorpresa'], c: 'objects' },
  { e: '🏷️', n: 'etiqueta', k: ['label', 'tag', 'etiqueta', 'precio'], c: 'objects' },
  { e: '🎉', n: 'fiesta', k: ['party', 'celebration', 'fiesta', 'celebrar'], c: 'objects' },
  { e: '🎊', n: 'confeti', k: ['confetti', 'confeti'], c: 'objects' },
  { e: '🎈', n: 'globo', k: ['balloon', 'globo'], c: 'objects' },
  { e: '🎀', n: 'lazo', k: ['ribbon', 'lazo', 'moño'], c: 'objects' },
  { e: '💰', n: 'bolsa dinero', k: ['money bag', 'dinero', 'plata'], c: 'objects' },
  { e: '💸', n: 'dinero volando', k: ['money fly', 'gasto'], c: 'objects' },
  { e: '💳', n: 'tarjeta', k: ['credit card', 'tarjeta', 'crédito'], c: 'objects' },
  { e: '💵', n: 'dólar', k: ['dollar', 'cash', 'dólar', 'efectivo'], c: 'objects' },
  { e: '🪙', n: 'moneda', k: ['coin', 'moneda'], c: 'objects' },
  { e: '🛒', n: 'carrito', k: ['shopping cart', 'carrito', 'compras'], c: 'objects' },
  { e: '🧾', n: 'recibo', k: ['receipt', 'recibo', 'factura'], c: 'objects' },
  { e: '📦', n: 'paquete', k: ['package', 'paquete', 'envío'], c: 'objects' },
  { e: '📲', n: 'celular flecha', k: ['mobile', 'celular'], c: 'objects' },
  { e: '📱', n: 'celular', k: ['phone', 'mobile', 'celular', 'teléfono'], c: 'objects' },
  { e: '💻', n: 'laptop', k: ['laptop', 'computer', 'computadora'], c: 'objects' },
  { e: '⌚', n: 'reloj', k: ['watch', 'reloj'], c: 'objects' },
  { e: '🔔', n: 'campana', k: ['bell', 'campana', 'alerta'], c: 'objects' },
  { e: '📍', n: 'pin ubicación', k: ['location', 'pin', 'ubicación'], c: 'objects' },
  { e: '🗺️', n: 'mapa', k: ['map', 'mapa'], c: 'objects' },
  { e: '🔑', n: 'llave', k: ['key', 'llave', 'acceso'], c: 'objects' },
  { e: '🔒', n: 'candado', k: ['lock', 'candado', 'seguro'], c: 'objects' },
  { e: '✉️', n: 'correo', k: ['email', 'mail', 'correo'], c: 'objects' },
  { e: '📧', n: 'email', k: ['email', 'correo'], c: 'objects' },
  { e: '📞', n: 'teléfono', k: ['phone call', 'teléfono'], c: 'objects' },
  { e: '💬', n: 'chat', k: ['chat', 'message', 'mensaje'], c: 'objects' },
  { e: '🗣️', n: 'hablar', k: ['speaking', 'hablar'], c: 'objects' },
  { e: '✂️', n: 'tijeras', k: ['scissors', 'tijeras', 'cortar'], c: 'objects' },
  { e: '🪒', n: 'navaja', k: ['razor', 'barbería', 'navaja'], c: 'objects' },
  { e: '💄', n: 'lápiz labial', k: ['lipstick', 'labial', 'makeup'], c: 'objects' },
  { e: '🧴', n: 'crema', k: ['lotion', 'crema'], c: 'objects' },
  { e: '🧼', n: 'jabón', k: ['soap', 'jabón'], c: 'objects' },
  { e: '🛁', n: 'bañera', k: ['bath', 'bañera'], c: 'objects' },
  { e: '🚿', n: 'ducha', k: ['shower', 'ducha'], c: 'objects' },

  // ───────── Symbols ─────────
  { e: '❤️', n: 'corazón rojo', k: ['heart', 'love', 'corazón', 'amor'], c: 'symbols' },
  { e: '🧡', n: 'corazón naranja', k: ['heart orange', 'corazón naranja'], c: 'symbols' },
  { e: '💛', n: 'corazón amarillo', k: ['heart yellow', 'corazón amarillo'], c: 'symbols' },
  { e: '💚', n: 'corazón verde', k: ['heart green', 'corazón verde'], c: 'symbols' },
  { e: '💙', n: 'corazón azul', k: ['heart blue', 'corazón azul'], c: 'symbols' },
  { e: '💜', n: 'corazón violeta', k: ['heart purple', 'corazón violeta'], c: 'symbols' },
  { e: '🖤', n: 'corazón negro', k: ['heart black', 'corazón negro'], c: 'symbols' },
  { e: '🤍', n: 'corazón blanco', k: ['heart white', 'corazón blanco'], c: 'symbols' },
  { e: '💗', n: 'corazón creciendo', k: ['heart growing', 'corazón'], c: 'symbols' },
  { e: '💖', n: 'corazón brillante', k: ['sparkling heart', 'corazón'], c: 'symbols' },
  { e: '💘', n: 'corazón flecha', k: ['cupid', 'corazón flecha'], c: 'symbols' },
  { e: '💝', n: 'corazón regalo', k: ['heart gift', 'corazón regalo'], c: 'symbols' },
  { e: '✨', n: 'destellos', k: ['sparkles', 'destellos', 'magia'], c: 'symbols' },
  { e: '⚡', n: 'rayo', k: ['lightning', 'bolt', 'rayo', 'rápido'], c: 'symbols' },
  { e: '🚀', n: 'cohete', k: ['rocket', 'cohete', 'lanzar'], c: 'symbols' },
  { e: '🏆', n: 'trofeo', k: ['trophy', 'trofeo', 'premio', 'ganador'], c: 'symbols' },
  { e: '🥇', n: 'medalla oro', k: ['gold medal', 'medalla', 'oro', 'primer'], c: 'symbols' },
  { e: '🥈', n: 'medalla plata', k: ['silver medal', 'plata'], c: 'symbols' },
  { e: '🥉', n: 'medalla bronce', k: ['bronze medal', 'bronce'], c: 'symbols' },
  { e: '🎖️', n: 'medalla militar', k: ['medal'], c: 'symbols' },
  { e: '✅', n: 'check', k: ['check', 'tick', 'sí', 'aprobado'], c: 'symbols' },
  { e: '☑️', n: 'check caja', k: ['check box', 'aprobado'], c: 'symbols' },
  { e: '❌', n: 'X roja', k: ['cross', 'no', 'cancelar'], c: 'symbols' },
  { e: '❗', n: 'exclamación', k: ['exclamation', 'urgente'], c: 'symbols' },
  { e: '❓', n: 'pregunta', k: ['question', 'pregunta'], c: 'symbols' },
  { e: '💯', n: '100', k: ['hundred', '100', 'perfecto'], c: 'symbols' },
  { e: '🆕', n: 'nuevo', k: ['new', 'nuevo'], c: 'symbols' },
  { e: '🆓', n: 'gratis', k: ['free', 'gratis'], c: 'symbols' },
  { e: '🔝', n: 'top', k: ['top', 'mejor'], c: 'symbols' },
  { e: '🔆', n: 'brillo', k: ['bright', 'brillo'], c: 'symbols' },
  { e: '↗️', n: 'flecha NE', k: ['arrow', 'flecha'], c: 'symbols' },
  { e: '➡️', n: 'flecha derecha', k: ['arrow right', 'flecha derecha'], c: 'symbols' },
  { e: '⬅️', n: 'flecha izquierda', k: ['arrow left', 'flecha izquierda'], c: 'symbols' },
  { e: '⬆️', n: 'flecha arriba', k: ['arrow up', 'flecha arriba'], c: 'symbols' },
  { e: '⬇️', n: 'flecha abajo', k: ['arrow down', 'flecha abajo'], c: 'symbols' },
  { e: '🔄', n: 'refresh', k: ['refresh', 'recargar', 'reciclar'], c: 'symbols' },
  { e: '➕', n: 'más', k: ['plus', 'add', 'más', 'agregar'], c: 'symbols' },
  { e: '➖', n: 'menos', k: ['minus', 'menos'], c: 'symbols' },
  { e: '✖️', n: 'multiplicar', k: ['multiply', 'por'], c: 'symbols' },
  { e: '➗', n: 'dividir', k: ['divide', 'dividir'], c: 'symbols' },
  { e: '♾️', n: 'infinito', k: ['infinity', 'infinito'], c: 'symbols' },
  { e: '☮️', n: 'paz', k: ['peace', 'paz'], c: 'symbols' },
];

/** Normaliza string: lowercase + sin acentos. Permite que "Galleta"
 *  haga match con "galleta" y que "Cafe" haga match con "Café". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Busca emojis por keyword. Devuelve los más relevantes primero.
 *  Si q es vacío, devuelve todos. */
export function searchEmojis(q: string, limit?: number): EmojiEntry[] {
  const query = normalize(q).trim();
  if (!query) {
    return limit ? EMOJI_DATA.slice(0, limit) : EMOJI_DATA;
  }
  type Scored = { entry: EmojiEntry; score: number };
  const out: Scored[] = [];
  for (const entry of EMOJI_DATA) {
    let bestScore = 0;
    // Match contra name + keywords. Exact start match > contains > sub-word.
    const candidates = [entry.n, ...entry.k];
    for (const cand of candidates) {
      const c = normalize(cand);
      if (c === query) {
        bestScore = Math.max(bestScore, 100);
      } else if (c.startsWith(query)) {
        bestScore = Math.max(bestScore, 80);
      } else if (c.includes(query)) {
        bestScore = Math.max(bestScore, 50);
      }
    }
    if (bestScore > 0) {
      out.push({ entry, score: bestScore });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const sliced = limit ? out.slice(0, limit) : out;
  return sliced.map((s) => s.entry);
}

/** Agrupa emojis por categoría, manteniendo el orden de EMOJI_DATA. */
export function emojisByCategory(): Record<EmojiCategory, EmojiEntry[]> {
  const out = {} as Record<EmojiCategory, EmojiEntry[]>;
  for (const cat of Object.keys(CATEGORY_LABELS) as EmojiCategory[]) {
    out[cat] = [];
  }
  for (const entry of EMOJI_DATA) {
    out[entry.c].push(entry);
  }
  return out;
}
