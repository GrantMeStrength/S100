import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  // GitHub Pages serves the site at https://<owner>.github.io/<repo>/
  // Set base only when building for production (CI sets NODE_ENV=production).
  base: process.env.NODE_ENV === 'production' ? '/S100/' : '/',
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    port: 5173,
  },
});
