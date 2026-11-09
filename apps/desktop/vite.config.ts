import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The renderer is plain static files loaded by Electron (or the dev host). base './' keeps asset paths relative.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/renderer', emptyOutDir: true, sourcemap: false },
});
