// Friendly, stable names and avatars for anonymous visitors ("brown toucan"), like DataFast. Same visitor id = same name.

const COLORS: [string, string][] = [
  ['brown', '#e7cfb4'],
  ['rose', '#fbcfe8'],
  ['olive', '#d9e4b4'],
  ['coffee', '#e5d3c3'],
  ['amber', '#fde68a'],
  ['teal', '#a5f3fc'],
  ['coral', '#fecaca'],
  ['indigo', '#c7d2fe'],
  ['lime', '#d9f99d'],
  ['peach', '#fed7aa'],
  ['plum', '#e9d5ff'],
  ['sky', '#bae6fd'],
  ['mint', '#bbf7d0'],
  ['ruby', '#fda4af'],
  ['golden', '#fef08a'],
  ['silver', '#e2e8f0'],
  ['lavender', '#ddd6fe'],
  ['jade', '#a7f3d0'],
];

const ANIMALS = [
  'fox',
  'panda',
  'koala',
  'tiger',
  'lion',
  'frog',
  'monkey',
  'unicorn',
  'octopus',
  'owl',
  'penguin',
  'rabbit',
  'cat',
  'puppy',
  'hamster',
  'bear',
  'otter',
  'sloth',
  'hedgehog',
  'whale',
  'dolphin',
  'turtle',
  'parrot',
  'flamingo',
  'giraffe',
  'zebra',
  'elephant',
  'butterfly',
  'bee',
  'ladybug',
  'duck',
  'swan',
  'peacock',
  'raccoon',
  'deer',
  'seal',
  'crab',
  'shark',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Persona {
  name: string; // "brown toucan"
  avatar: string; // static SVG in public/avatars/, one per animal (see scripts/generate-avatars.mjs)
  color: string; // placeholder background while the avatar loads
}

export function persona(visitorId: string): Persona {
  const h = hash(visitorId);
  const [color, bg] = COLORS[h % COLORS.length];
  const i = Math.floor(h / COLORS.length) % ANIMALS.length;
  return { name: `${color} ${ANIMALS[i]}`, avatar: `/avatars/${i}.svg`, color: bg };
}

/** A real name when we know it (identify() or a payment), otherwise the animal name. */
export function displayName(visitorId: string, name?: string | null, email?: string | null): string {
  return name || email || persona(visitorId).name;
}
