/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/dashboard/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        // Theme-aware: the values live in styles.css and flip under `.dark`.
        stone: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, v(`stone-${n}`)])),
        paper: v('paper'),
        surface: v('surface'),
        ink: v('ink'),
        revenueSoft: v('revenue-soft'),
        visitorsSoft: v('visitors-soft'),
        visitors: '#8dbdf0',
        revenue: '#e07b5f',
      },
      boxShadow: { card: '0 1px 2px rgba(28,25,23,0.04), 0 1px 1px rgba(28,25,23,0.02)' },
    },
  },
  plugins: [],
};
