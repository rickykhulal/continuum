import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:8787' } },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          satellite: ['satellite.js'],
        },
      },
    },
  },
});
