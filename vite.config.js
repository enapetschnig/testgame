import { defineConfig } from 'vite';

// `base: './'` haelt den Build portabel: das Spiel laeuft so aus jedem
// Unterordner (GitHub Pages, file-Server, itch.io-Zip) ohne Anpassung.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
});
