/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/dashboard/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'] },
      colors: {
        paper: '#ffffff',
        surface: '#fcfcfd',
        ink: '#09090b',
        visitors: '#6366f1', // Modern Indigo
        revenue: '#10b981',  // Vibrant Emerald
        revenueSoft: '#d1fae5',
        visitorsSoft: '#e0e7ff',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        elevated: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};
