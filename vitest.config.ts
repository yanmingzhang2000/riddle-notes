import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@background': resolve(__dirname, 'src/background'),
      '@content': resolve(__dirname, 'src/content'),
      '@sidepanel': resolve(__dirname, 'src/sidepanel'),
      '@db': resolve(__dirname, 'src/db'),
      '@ai': resolve(__dirname, 'src/ai'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
