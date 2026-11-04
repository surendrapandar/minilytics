/** @type {import('tailwindcss').Config} */
// Colours are "r g b" triplets in styles.css, so opacity modifiers (bg-white/90) work and dark mode can swap them.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const STONE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ['./src/dashboard/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // The UI is built from white, stone and ink. In dark mode the stone scale flips and white
        // becomes the card colour, so every page follows without per-component dark: variants.
        white: token('white'),
        stone: Object.fromEntries(STONE.map((n) => [n, token(`stone-${n}`)])),
        paper: token('paper'),
        // Code blocks stay dark in both themes.
        night: { DEFAULT: token('night'), fg: '#f5f5f4', muted: '#a8a29e', line: 'rgb(255 255 255 / 0.1)' },
        ink: token('ink'),
        // Same as --dither-color-blue / --dither-color-orange, so dithered charts match the rest of the UI.
        visitors: token('visitors'),
        revenue: token('revenue'),
        revenueSoft: token('revenue-soft'),
        visitorsSoft: token('visitors-soft'),
        // Names the dithercn components use (shadcn's).
        background: token('background'),
        foreground: token('foreground'),
        border: token('border'),
        'muted-foreground': token('muted-foreground'),
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        ring: token('ring'),
      },
      boxShadow: { card: '0 1px 2px rgba(28,25,23,0.04), 0 1px 1px rgba(28,25,23,0.02)' },
    },
  },
  plugins: [],
};
