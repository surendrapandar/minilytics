// Colours that change in dark mode read CSS variables (set in styles.css), so components need no dark: classes.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (hue, shades) => Object.fromEntries(shades.map((n) => [n, v(`${hue}-${n}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/dashboard/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        paper: v('paper'),
        surface: v('surface'),
        ink: v('ink'),
        visitors: '#8dbdf0',
        revenue: '#e07b5f',
        revenueSoft: v('revenue-soft'),
        visitorsSoft: v('visitors-soft'),
        stone: scale('stone', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        amber: scale('amber', [50, 200, 700, 800, 900]),
        red: scale('red', [50, 200, 700]),
        emerald: scale('emerald', [50, 800]),
        violet: scale('violet', [50, 200, 700]),
      },
      boxShadow: { card: '0 1px 2px rgba(28,25,23,0.04), 0 1px 1px rgba(28,25,23,0.02)' },
    },
  },
  plugins: [],
};
