import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/dashboard',
  publicDir: '../../public',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
