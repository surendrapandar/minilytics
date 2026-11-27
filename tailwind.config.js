/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/dashboard/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        paper: '#f8f6f3',
        ink: '#1c1917',
        visitors: '#8dbdf0',
        revenue: '#e07b5f',
        revenueSoft: '#fadbd1',
        visitorsSoft: '#e4f0fc',
        chartVisitors: '#7b6ff0',
        chartRevenue: '#e2a24f',
      },
      boxShadow: { card: '0 1px 2px rgba(28,25,23,0.04), 0 1px 1px rgba(28,25,23,0.02)' },
    },
  },
  plugins: [],
};
