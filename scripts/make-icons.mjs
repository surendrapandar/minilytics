// Generates favicons, the apple-touch-icon and the social share image into public/.
// Run with: node scripts/make-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c1917"/><path d="M8 22l5-7 4 4 7-10" stroke="#e07b5f" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// iOS rounds corners itself, so the touch icon is a full square.
const square = mark.replace('rx="8"', 'rx="0"');

writeFileSync('public/favicon.svg', mark + '\n');
await sharp(Buffer.from(mark), { density: 300 }).resize(32, 32).png().toFile('public/favicon-32x32.png');
await sharp(Buffer.from(mark), { density: 300 }).resize(48, 48).png().toFile('public/favicon-48x48.png');

// favicon.ico: browsers and crawlers request it directly. Holds PNG frames at 16, 32 and 48px.
const frames = await Promise.all([16, 32, 48].map((n) => sharp(Buffer.from(mark), { density: 300 }).resize(n, n).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((png, i) => {
  const n = [16, 32, 48][i];
  const e = 6 + 16 * i;
  header.writeUInt8(n, e);
  header.writeUInt8(n, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, ...frames]));

await sharp(Buffer.from(square), { density: 600 }).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(square), { density: 600 }).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(square), { density: 1200 }).resize(512, 512).png().toFile('public/icon-512.png');

// 1200x630 share card: headline on the left of a cropped dashboard screenshot.
const W = 1200, H = 630;
const shot = await sharp('public/landing/dashboard.png').resize(700).extract({ left: 0, top: 0, width: 700, height: 430 }).png().toBuffer();
const font = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#f8f6f3"/>
  <g transform="translate(64,64) scale(1.5)">${mark.replace(/<\/?svg[^>]*>/g, '')}</g>
  <text x="124" y="101" ${font} font-size="34" font-weight="700" fill="#1c1917">Minilytics</text>
  <text x="64" y="250" ${font} font-size="58" font-weight="700" fill="#1c1917" letter-spacing="-1.5">See which tweet,</text>
  <text x="64" y="320" ${font} font-size="58" font-weight="700" fill="#1c1917" letter-spacing="-1.5">post or AI chat</text>
  <text x="64" y="390" ${font} font-size="58" font-weight="700" fill="#e07b5f" letter-spacing="-1.5">made you money.</text>
  <text x="64" y="470" ${font} font-size="26" fill="#57534e">Revenue-first web analytics</text>
  <text x="64" y="506" ${font} font-size="26" fill="#57534e">for indie makers.</text>
  <text x="64" y="578" ${font} font-size="24" font-weight="700" fill="#1c1917">minilytics.app</text>
  <rect x="566" y="126" width="704" height="434" rx="18" fill="#1c1917" opacity="0.08"/>
</svg>`;
const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="430"><rect width="700" height="430" rx="16" fill="#fff"/></svg>`);
const rounded = await sharp(shot).composite([{ input: frame, blend: 'dest-in' }]).png().toBuffer();
await sharp(Buffer.from(bg)).composite([{ input: rounded, left: 564, top: 122 }]).png().toFile('public/og-image.png');
console.log('done');
