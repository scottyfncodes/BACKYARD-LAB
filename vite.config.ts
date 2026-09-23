import { defineConfig } from 'vite';

// Relative base so the build works at any GitHub Pages path (e.g. /backyard-lab/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Physics (WASM) and three.js change rarely; keep them in their own cached chunks.
        manualChunks: { rapier: ['@dimforge/rapier3d-compat'], three: ['three'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
} as any);
