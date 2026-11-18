import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // 每个测试文件在独立的进程里运行。内存里的 IndexedDB 不会在文件之间共享,
    // 备份与恢复的测试会清空和覆盖数据库,必须保证互不污染。
    pool: 'forks',
    poolOptions: { forks: { isolate: true } },
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
