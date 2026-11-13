export interface EmojiEntry {
  readonly emoji: string;
  readonly name: string;
  readonly category: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly supportsSkinTone?: boolean;
}

export type SkinToneModifier = '' | '🏻' | '🏼' | '🏽' | '🏾' | '🏿';

export interface SkinToneOption {
  readonly modifier: SkinToneModifier;
  readonly label: string;
  readonly preview: string;
}

export const SKIN_TONE_OPTIONS: ReadonlyArray<SkinToneOption> = [
  { modifier: '', label: 'Predeterminado', preview: '✋' },
  { modifier: '🏻', label: 'Piel clara', preview: '✋🏻' },
  { modifier: '🏼', label: 'Piel medio clara', preview: '✋🏼' },
  { modifier: '🏽', label: 'Piel media', preview: '✋🏽' },
  { modifier: '🏾', label: 'Piel medio oscura', preview: '✋🏾' },
  { modifier: '🏿', label: 'Piel oscura', preview: '✋🏿' },
] as const;

const SKIN_TONE_MODIFIER_PATTERN = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION_SELECTOR_PATTERN = /^[\uFE0E\uFE0F]$/u;

export function applySkinTone(emoji: string, modifier: SkinToneModifier): string {
  const baseEmoji = emoji.replace(SKIN_TONE_MODIFIER_PATTERN, '');
  if (!modifier) return baseEmoji;

  const codePoints = Array.from(baseEmoji);
  if (codePoints.length === 0) return baseEmoji;

  let insertionIndex = 1;
  while (
    insertionIndex < codePoints.length &&
    VARIATION_SELECTOR_PATTERN.test(codePoints[insertionIndex])
  ) {
    insertionIndex += 1;
  }
  return codePoints[0] + modifier + codePoints.slice(insertionIndex).join('');
}

export function normalizeEmojiSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
}

export function matchesEmojiSearch(entry: EmojiEntry, query: string): boolean {
  const terms = normalizeEmojiSearch(query).split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;

  const searchableText = normalizeEmojiSearch(
    [entry.name, ...(entry.aliases ?? []), entry.category, entry.emoji].join(' '),
  );
  return terms.every((term) => searchableText.includes(term));
}

export const EMOJI_CATALOG: ReadonlyArray<EmojiEntry> = [
  {
    emoji: '😀',
    name: 'cara sonrisa',
    category: 'Caras',
    aliases: ['feliz', 'contento', 'sonrisa'],
  },
  {
    emoji: '😂',
    name: 'cara lágrimas alegría',
    category: 'Caras',
    aliases: ['risa', 'llorar de risa', 'jaja'],
  },
  {
    emoji: '😍',
    name: 'cara corazones',
    category: 'Caras',
    aliases: ['amor', 'enamorado', 'ojos de corazón'],
  },
  { emoji: '🤔', name: 'cara pensando', category: 'Caras', aliases: ['duda', 'pensando', 'hmm'] },
  {
    emoji: '😎',
    name: 'cara gafas',
    category: 'Caras',
    aliases: ['cool', 'genial', 'gafas de sol'],
  },
  {
    emoji: '😭',
    name: 'cara llanto',
    category: 'Caras',
    aliases: ['llanto', 'tristeza', 'llorar'],
  },
  {
    emoji: '😡',
    name: 'cara enfadado',
    category: 'Caras',
    aliases: ['enfado', 'enojo', 'molesto'],
  },
  {
    emoji: '😮',
    name: 'cara sorpresa',
    category: 'Caras',
    aliases: ['sorpresa', 'sorprendido', 'wow'],
  },
  { emoji: '😢', name: 'cara tristeza', category: 'Caras', aliases: ['triste', 'llorar'] },
  {
    emoji: '👍',
    name: 'pulgar arriba',
    category: 'Gestos',
    aliases: ['bien', 'ok', 'aprobado'],
    supportsSkinTone: true,
  },
  {
    emoji: '👎',
    name: 'pulgar abajo',
    category: 'Gestos',
    aliases: ['mal', 'no', 'desaprobado'],
    supportsSkinTone: true,
  },
  {
    emoji: '👏',
    name: 'aplausos',
    category: 'Gestos',
    aliases: ['aplauso', 'bravo'],
    supportsSkinTone: true,
  },
  {
    emoji: '🙏',
    name: 'manos plegadas gracias',
    category: 'Gestos',
    aliases: ['gracias', 'por favor', 'reza'],
    supportsSkinTone: true,
  },
  {
    emoji: '👋',
    name: 'saludo',
    category: 'Gestos',
    aliases: ['hola', 'adios', 'despedida'],
    supportsSkinTone: true,
  },
  { emoji: '❤️', name: 'corazón rojo', category: 'Símbolos', aliases: ['amor', 'corazon', 'rojo'] },
  { emoji: '🔥', name: 'fuego', category: 'Símbolos', aliases: ['caliente', 'genial'] },
  { emoji: '✨', name: 'brillos', category: 'Símbolos', aliases: ['magia', 'brillos', 'estrella'] },
  {
    emoji: '✅',
    name: 'correcto',
    category: 'Símbolos',
    aliases: ['hecho', 'confirmado', 'check'],
  },
  { emoji: '🎉', name: 'fiesta', category: 'Objetos', aliases: ['celebracion', 'cumpleanos'] },
  {
    emoji: '🚀',
    name: 'cohete',
    category: 'Objetos',
    aliases: ['lanzamiento', 'rapido', 'espacio'],
  },
  {
    emoji: '💡',
    name: 'bombilla idea',
    category: 'Objetos',
    aliases: ['idea', 'luz', 'inspiracion'],
  },
  { emoji: '☕', name: 'café', category: 'Objetos', aliases: ['cafe', 'desayuno', 'bebida'] },
  {
    emoji: '👩‍💻',
    name: 'persona programadora',
    category: 'Personas',
    aliases: ['programadora', 'codigo', 'desarrolladora'],
    supportsSkinTone: true,
  },
  {
    emoji: '🧑‍🚀',
    name: 'astronauta',
    category: 'Personas',
    aliases: ['espacio', 'cosmos'],
    supportsSkinTone: true,
  },
  {
    emoji: '🏳️‍🌈',
    name: 'bandera arcoíris',
    category: 'Símbolos',
    aliases: ['lgbt', 'orgullo', 'diversidad', 'arcoiris'],
  },
  { emoji: '😃', name: 'cara sonrisa abierta', category: 'Caras' },
  { emoji: '😄', name: 'cara sonrisa ojos', category: 'Caras' },
  { emoji: '😁', name: 'cara sonrisa grande', category: 'Caras' },
  { emoji: '😅', name: 'cara sonrisa sudor', category: 'Caras' },
  { emoji: '🤣', name: 'cara revolcándose de risa', category: 'Caras' },
  { emoji: '🥹', name: 'cara conteniendo lágrimas', category: 'Caras' },
  { emoji: '🥰', name: 'cara enamorada', category: 'Caras' },
  { emoji: '😘', name: 'cara beso', category: 'Caras' },
  { emoji: '😗', name: 'cara besando', category: 'Caras' },
  { emoji: '😙', name: 'cara besando ojos sonrientes', category: 'Caras' },
  { emoji: '😚', name: 'cara besando ojos cerrados', category: 'Caras' },
  { emoji: '😋', name: 'cara saboreando', category: 'Caras' },
  { emoji: '😛', name: 'cara sacando la lengua', category: 'Caras' },
  { emoji: '😜', name: 'cara guiñando lengua', category: 'Caras' },
  { emoji: '🤪', name: 'cara alocada', category: 'Caras' },
  { emoji: '🤨', name: 'cara ceja levantada', category: 'Caras' },
  { emoji: '🧐', name: 'cara monoculo', category: 'Caras' },
  { emoji: '🙄', name: 'cara ojos en blanco', category: 'Caras' },
  { emoji: '😱', name: 'cara gritando miedo', category: 'Caras' },
  { emoji: '🥳', name: 'cara celebrando', category: 'Caras' },
  { emoji: '👌', name: 'gesto perfecto', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤌', name: 'dedos juntos', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤝', name: 'apretón de manos', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🫶', name: 'manos formando corazón', category: 'Gestos', supportsSkinTone: true },
  { emoji: '✌️', name: 'señal de victoria', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤞', name: 'dedos cruzados', category: 'Gestos', supportsSkinTone: true },
  { emoji: '💪', name: 'bíceps', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤟', name: 'te quiero', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤘', name: 'cuernos', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤙', name: 'llámame', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🫡', name: 'saludo militar', category: 'Gestos' },
  { emoji: '🖐️', name: 'mano levantada dedos', category: 'Gestos', supportsSkinTone: true },
  { emoji: '✋', name: 'mano levantada', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🤚', name: 'dorso de mano levantada', category: 'Gestos', supportsSkinTone: true },
  { emoji: '🙌', name: 'manos levantadas', category: 'Gestos', supportsSkinTone: true },
  {
    emoji: '🐶',
    name: 'cara de perro',
    category: 'Animales y naturaleza',
    aliases: ['perro', 'mascota'],
  },
  {
    emoji: '🐱',
    name: 'cara de gato',
    category: 'Animales y naturaleza',
    aliases: ['gato', 'mascota'],
  },
  { emoji: '🐭', name: 'cara de ratón', category: 'Animales y naturaleza' },
  { emoji: '🐹', name: 'hámster', category: 'Animales y naturaleza' },
  { emoji: '🐰', name: 'cara de conejo', category: 'Animales y naturaleza' },
  { emoji: '🦊', name: 'zorro', category: 'Animales y naturaleza' },
  { emoji: '🐻', name: 'oso', category: 'Animales y naturaleza' },
  { emoji: '🐼', name: 'panda', category: 'Animales y naturaleza' },
  { emoji: '🐨', name: 'koala', category: 'Animales y naturaleza' },
  { emoji: '🐯', name: 'cara de tigre', category: 'Animales y naturaleza' },
  { emoji: '🦁', name: 'león', category: 'Animales y naturaleza' },
  { emoji: '🐸', name: 'rana', category: 'Animales y naturaleza' },
  { emoji: '🦄', name: 'unicornio', category: 'Animales y naturaleza' },
  {
    emoji: '🦋',
    name: 'mariposa',
    category: 'Animales y naturaleza',
    aliases: ['insecto', 'naturaleza'],
  },
  { emoji: '🌻', name: 'girasol', category: 'Animales y naturaleza' },
  { emoji: '🍎', name: 'manzana roja', category: 'Comida y bebida' },
  { emoji: '🍐', name: 'pera', category: 'Comida y bebida' },
  { emoji: '🍊', name: 'mandarina', category: 'Comida y bebida' },
  { emoji: '🍋', name: 'limón', category: 'Comida y bebida' },
  { emoji: '🍌', name: 'plátano', category: 'Comida y bebida' },
  { emoji: '🍉', name: 'sandía', category: 'Comida y bebida' },
  { emoji: '🍇', name: 'uvas', category: 'Comida y bebida' },
  { emoji: '🍓', name: 'fresa', category: 'Comida y bebida' },
  { emoji: '🫐', name: 'arándanos', category: 'Comida y bebida' },
  { emoji: '🍒', name: 'cerezas', category: 'Comida y bebida' },
  { emoji: '🍑', name: 'melocotón', category: 'Comida y bebida' },
  { emoji: '🍍', name: 'piña', category: 'Comida y bebida' },
  { emoji: '🥝', name: 'kiwi', category: 'Comida y bebida' },
  { emoji: '🍕', name: 'pizza', category: 'Comida y bebida', aliases: ['comida'] },
  { emoji: '🍔', name: 'hamburguesa', category: 'Comida y bebida', aliases: ['comida'] },
  { emoji: '⚽', name: 'fútbol', category: 'Deportes y ocio', aliases: ['deporte'] },
  { emoji: '🏀', name: 'baloncesto', category: 'Deportes y ocio' },
  { emoji: '🏈', name: 'fútbol americano', category: 'Deportes y ocio' },
  { emoji: '⚾', name: 'béisbol', category: 'Deportes y ocio' },
  { emoji: '🎾', name: 'tenis', category: 'Deportes y ocio' },
  { emoji: '🏆', name: 'trofeo', category: 'Deportes y ocio' },
  {
    emoji: '🎮',
    name: 'videojuego',
    category: 'Deportes y ocio',
    aliases: ['jugar', 'videojuego'],
  },
  { emoji: '🎸', name: 'guitarra', category: 'Deportes y ocio' },
  { emoji: '🎧', name: 'auriculares', category: 'Deportes y ocio' },
  { emoji: '🎨', name: 'paleta de pintura', category: 'Deportes y ocio' },
  {
    emoji: '🚗',
    name: 'automóvil',
    category: 'Viajes y lugares',
    aliases: ['coche', 'auto', 'carro'],
  },
  { emoji: '🚕', name: 'taxi', category: 'Viajes y lugares' },
  { emoji: '🚌', name: 'autobús', category: 'Viajes y lugares' },
  { emoji: '🚆', name: 'tren', category: 'Viajes y lugares' },
  { emoji: '✈️', name: 'avión', category: 'Viajes y lugares', aliases: ['vuelo', 'viajar'] },
  { emoji: '🚁', name: 'helicóptero', category: 'Viajes y lugares' },
  { emoji: '🏠', name: 'casa', category: 'Viajes y lugares' },
  { emoji: '🏖️', name: 'playa', category: 'Viajes y lugares' },
  {
    emoji: '💻',
    name: 'ordenador portátil',
    category: 'Tecnología y objetos',
    aliases: ['computadora', 'pc'],
  },
  {
    emoji: '📱',
    name: 'teléfono móvil',
    category: 'Tecnología y objetos',
    aliases: ['celular', 'movil', 'telefono'],
  },
  { emoji: '🖥️', name: 'ordenador de escritorio', category: 'Tecnología y objetos' },
  { emoji: '⌨️', name: 'teclado', category: 'Tecnología y objetos' },
  { emoji: '🔋', name: 'batería', category: 'Tecnología y objetos' },
  { emoji: '⚙️', name: 'engranaje', category: 'Tecnología y objetos' },
  { emoji: '🔧', name: 'llave inglesa', category: 'Tecnología y objetos' },
  { emoji: '🧡', name: 'corazón naranja', category: 'Símbolos' },
  { emoji: '💛', name: 'corazón amarillo', category: 'Símbolos' },
  { emoji: '💙', name: 'corazón azul', category: 'Símbolos' },
  { emoji: '🇪🇨', name: 'bandera de Ecuador', category: 'Banderas', aliases: ['ecuador', 'pais'] },
  { emoji: '🇨🇴', name: 'bandera de Colombia', category: 'Banderas', aliases: ['colombia', 'pais'] },
];

export const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function findEmojiEntry(emoji: string): EmojiEntry | undefined {
  return EMOJI_CATALOG.find(
    (entry) =>
      entry.emoji === emoji ||
      (entry.supportsSkinTone &&
        SKIN_TONE_OPTIONS.some(
          (option) =>
            option.modifier !== '' && applySkinTone(entry.emoji, option.modifier) === emoji,
        )),
  );
}
