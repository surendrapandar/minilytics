import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/dashboard',
  publicDir: '../../public',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/dashboard', import.meta.url)) } },
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/api', '/mcp', '/oauth', '/.well-known'].map((p) => [p, 'http://localhost:8787'])),
  },
});
