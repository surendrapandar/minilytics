// Generates the static visitor avatars in public/avatars/ with DiceBear's "Lorelei" style
// (design: Lisa Wischofsky, CC0 1.0). We ship plain SVG files instead of calling api.dicebear.com
// at runtime, so there's no third-party request, no rate limit and nothing to pay for.
//
// Run once, then commit the output (the packages are not project dependencies):
//   npm i --no-save @dicebear/core@9 @dicebear/lorelei@9 && node scripts/generate-avatars.mjs
//
// The number of avatars must match ANIMALS in src/shared/names.ts (one avatar per animal name).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';

const COUNT = 38;
const BACKGROUNDS = ['ffe3ea', 'e3edff', 'e2f5e9', 'fdf1d4', 'efe6ff'];
const out = new URL('../public/avatars/', import.meta.url);
mkdirSync(out, { recursive: true });

for (let i = 0; i < COUNT; i++) {
  const svg = createAvatar(lorelei, {
    seed: `minilytics-${i}`,
    backgroundColor: [BACKGROUNDS[i % BACKGROUNDS.length]],
  }).toString();
  writeFileSync(new URL(`${i}.svg`, out), svg);
}
console.log(`Wrote ${COUNT} avatars to public/avatars/`);
