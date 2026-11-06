import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relativer Pfad: funktioniert unter https://hjorven.github.io/Watertrade/
  // unabhängig von Groß-/Kleinschreibung und auch bei späterer Umbenennung.
  base: './',
  build: {
    // Three.js allein ist gut 500 kB groß
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
