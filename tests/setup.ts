// fake-indexeddb 在内存里模拟浏览器的 IndexedDB,让依赖 Dexie 的代码可以在 Node 里真实地读写。
// 每个测试文件在独立的进程里运行(见 vitest.config.ts),内存数据库不会在文件之间共享,
// 也不会碰到任何真实的浏览器数据。同一个文件里的测试用 tests/helpers/db.ts 的 resetDb() 重置。
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll } from 'vitest';

// Mock Chrome APIs
beforeAll(() => {
  global.chrome = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(),
    },
  } as any;
});

afterAll(() => {
  // Cleanup
});
