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
