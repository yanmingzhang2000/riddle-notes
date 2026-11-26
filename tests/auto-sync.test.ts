/**
 * 自动同步管理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { autoSyncManager, STORAGE_KEYS } from '../src/shared/auto-sync';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: vi.fn((keys) => {
        // 返回空对象（模拟没有存储任何值）
        if (Array.isArray(keys)) {
          return Promise.resolve({});
        } else if (typeof keys === 'string') {
          return Promise.resolve({});
        } else {
          return Promise.resolve({});
        }
      }),
      set: vi.fn(() => Promise.resolve()),
    },
  },
  notifications: {
    create: vi.fn(() => Promise.resolve('notification-id')),
  },
  runtime: {
    getURL: vi.fn((path) => `chrome-extension://test/${path}`),
  },
} as any;

// vi.mock 会被提升到文件顶部，因此统一在这里声明，并用 vi.hoisted 暴露可控的 mock 函数
const { mockGetCurrentUserEmail } = vi.hoisted(() => ({
  mockGetCurrentUserEmail: vi.fn(),
}));
vi.mock('../src/shared/sync-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getCurrentUserEmail: mockGetCurrentUserEmail,
}));

describe('AutoSyncManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每次测试前重新设置 mock 实现，确保 get 始终返回对象（模拟存储为空）
    (chrome.storage.local.get as any).mockImplementation(() => Promise.resolve({}));
    (chrome.storage.local.set as any).mockImplementation(() => Promise.resolve());
    // 默认已登录；需要未登录的用例用 mockResolvedValueOnce(null) 覆盖
    mockGetCurrentUserEmail.mockReset();
    mockGetCurrentUserEmail.mockResolvedValue('test@example.com');
  });

  describe('配置管理', () => {
    it('默认启用自动同步', async () => {
      const enabled = await autoSyncManager.isEnabled();
      expect(enabled).toBe(true);
    });

    it('可以禁用自动同步', async () => {
      await autoSyncManager.setEnabled(false);
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.SYNC_ENABLED]: false,
      });
    });
  });

  describe('口令缓存', () => {
    it('可以缓存口令', () => {
      autoSyncManager.cachePassphrase('test-passphrase-123');
      expect(autoSyncManager.hasPassphraseCache()).toBe(true);
      expect(autoSyncManager.getCachedPassphrase()).toBe('test-passphrase-123');
    });

    it('可以清除口令缓存', () => {
      autoSyncManager.cachePassphrase('test-passphrase-123');
      autoSyncManager.clearPassphraseCache();
      
      expect(autoSyncManager.hasPassphraseCache()).toBe(false);
      expect(autoSyncManager.getCachedPassphrase()).toBeNull();
    });
  });

  describe('本地修改标记', () => {
    it('可以标记本地修改时间', async () => {
      await autoSyncManager.markLocalModified();
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [STORAGE_KEYS.SYNC_LOCAL_LAST_MODIFIED]: expect.any(String),
        })
      );
    });
  });

  describe('待上传标记', () => {
    it('可以标记待上传', async () => {
      await autoSyncManager.markPendingUpload();
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: true,
      });
    });

    it('可以清除待上传标记', async () => {
      await autoSyncManager.clearPendingUpload();
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: false,
      });
    });

    it('可以查询是否有待上传数据', async () => {
      // Mock storage 返回 false
      (chrome.storage.local.get as any).mockResolvedValueOnce({
        [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: false,
      });
      
      const hasPending = await autoSyncManager.hasPendingUpload();
      expect(hasPending).toBe(false);
    });
  });

  describe('自动同步调度', () => {
    it('未登录时跳过自动同步', async () => {
      // Mock getCurrentUserEmail 返回 null
      mockGetCurrentUserEmail.mockResolvedValueOnce(null);

      await autoSyncManager.scheduleAutoSync();
      
      // 不应该设置定时器
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('没有缓存口令时标记待上传', async () => {
      // Mock 已登录
      mockGetCurrentUserEmail.mockResolvedValueOnce('test@example.com');

      autoSyncManager.clearPassphraseCache();
      await autoSyncManager.scheduleAutoSync();
      
      // 没有缓存口令时应标记待上传（实现调用的是 markPendingUpload）
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: true,
      });
    });
  });

  describe('冲突检测', () => {
    it('未登录时不检查冲突', async () => {
      // Mock getCurrentUserEmail 返回 null
      mockGetCurrentUserEmail.mockResolvedValueOnce(null);

      const hasConflict = await autoSyncManager.checkConflictOnStartup();
      expect(hasConflict).toBe(false);
    });

    it('离线时不检查冲突', async () => {
      // Mock navigator.onLine
      Object.defineProperty(global.navigator, 'onLine', {
        writable: true,
        value: false,
      });

      const hasConflict = await autoSyncManager.checkConflictOnStartup();
      expect(hasConflict).toBe(false);
    });
  });
});
