/**
 * 云同步服务测试
 * 
 * 注意：这些测试需要 Supabase 数据库表已创建
 * 请先执行 supabase-migration.sql，参考 SUPABASE-SETUP.md
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  signUp,
  signIn,
  signOut,
  getCurrentUserEmail,
  uploadSnapshot,
  downloadLatestSnapshot,
  getLatestVersion,
  getSyncMetadata,
  listSnapshots,
  NotAuthenticatedError,
  ConflictError,
} from '../src/shared/sync-service';
import { createBackup } from '../src/shared/backup';
import type { BackupFile } from '../src/shared/backup';

// 测试账号（每次运行需要用新邮箱，或清理数据库）
const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'test-password-12345';
const TEST_PASSPHRASE = 'test-sync-passphrase-67890';

describe.skip('sync-service', () => {
  // 跳过测试（需要真实 Supabase 环境）
  // 要运行测试：
  // 1. 执行 supabase-migration.sql
  // 2. 移除 describe.skip 中的 .skip
  // 3. 运行 npm test -- tests/sync-service.test.ts

  describe('认证', () => {
    it('应成功注册账号', async () => {
      await expect(signUp(TEST_EMAIL, TEST_PASSWORD)).resolves.toBeUndefined();
    }, 10000);

    it('应成功登录', async () => {
      await expect(signIn(TEST_EMAIL, TEST_PASSWORD)).resolves.toBeUndefined();
    }, 10000);

    it('应获取当前用户邮箱', async () => {
      const email = await getCurrentUserEmail();
      expect(email).toBe(TEST_EMAIL);
    }, 10000);

    it('应成功登出', async () => {
      await expect(signOut()).resolves.toBeUndefined();
    }, 10000);
  });

  describe('快照上传', () => {
    beforeAll(async () => {
      await signIn(TEST_EMAIL, TEST_PASSWORD);
    });

    it('应上传第一个快照', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: new Date().toISOString(),
        counts: {
          folders: 1,
          tags: 0,
          prompts: 1,
          promptVersions: 1,
          runs: 1,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: [{ id: 1, name: '测试', sortOrder: 0, createdAt: '2026-11-26T10:00:00Z' as any, updatedAt: '2026-11-26T10:00:00Z' as any }],
        tags: [],
        prompts: [
          {
            id: 1,
            uid: 'test',
            type: 'ai',
            title: '测试笔记',
            folderId: 1,
            createdAt: '2026-11-26T10:00:00Z' as any,
            updatedAt: '2026-11-26T10:00:00Z' as any,
          },
        ],
        promptVersions: [{ id: 1, promptId: 1, content: 'test', versionNumber: 1, createdAt: '2026-11-26T10:00:00Z' as any }],
        runs: [{ id: 1, promptId: 1, outputText: 'response', createdAt: '2026-11-26T10:00:00Z' as any }],
        attachments: [],
        improvementRequests: [],
      };

      const version = await uploadSnapshot(mockBackup, TEST_PASSPHRASE, 0);
      expect(version).toBe(1);
    }, 15000);

    it('应上传第二个快照', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: new Date().toISOString(),
        counts: {
          folders: 2,
          tags: 0,
          prompts: 2,
          promptVersions: 2,
          runs: 2,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: [
          { id: 1, name: '测试 1', sortOrder: 0, createdAt: '2026-11-26T10:00:00Z' as any, updatedAt: '2026-11-26T10:00:00Z' as any },
          { id: 2, name: '测试 2', sortOrder: 1, createdAt: '2026-11-26T10:00:00Z' as any, updatedAt: '2026-11-26T10:00:00Z' as any },
        ],
        tags: [],
        prompts: [
          {
            id: 1,
            uid: 'test-1',
            type: 'ai',
            title: '测试笔记 1',
            folderId: 1,
            createdAt: '2026-11-26T10:00:00Z' as any,
            updatedAt: '2026-11-26T10:00:00Z' as any,
          },
          {
            id: 2,
            uid: 'test-2',
            type: 'ai',
            title: '测试笔记 2',
            folderId: 2,
            createdAt: '2026-11-26T10:00:00Z' as any,
            updatedAt: '2026-11-26T10:00:00Z' as any,
          },
        ],
        promptVersions: [
          { id: 1, promptId: 1, content: 'test 1', versionNumber: 1, createdAt: '2026-11-26T10:00:00Z' as any },
          { id: 2, promptId: 2, content: 'test 2', versionNumber: 1, createdAt: '2026-11-26T10:00:00Z' as any },
        ],
        runs: [
          { id: 1, promptId: 1, outputText: 'response 1', createdAt: '2026-11-26T10:00:00Z' as any },
          { id: 2, promptId: 2, outputText: 'response 2', createdAt: '2026-11-26T10:00:00Z' as any },
        ],
        attachments: [],
        improvementRequests: [],
      };

      const version = await uploadSnapshot(mockBackup, TEST_PASSPHRASE, 1);
      expect(version).toBe(2);
    }, 15000);

    it('应检测版本冲突', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: new Date().toISOString(),
        counts: {
          folders: 0,
          tags: 0,
          prompts: 0,
          promptVersions: 0,
          runs: 0,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: [],
        tags: [],
        prompts: [],
        promptVersions: [],
        runs: [],
        attachments: [],
        improvementRequests: [],
      };

      // 尝试用旧版本号上传（应该失败）
      await expect(uploadSnapshot(mockBackup, TEST_PASSPHRASE, 0)).rejects.toThrow(ConflictError);
    }, 15000);
  });

  describe('快照下载', () => {
    beforeAll(async () => {
      await signIn(TEST_EMAIL, TEST_PASSWORD);
    });

    it('应下载最新快照', async () => {
      const result = await downloadLatestSnapshot(TEST_PASSPHRASE);
      
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2); // 前面上传了 2 个版本
      expect(result!.backup.app).toBe('riddle-notes');
      expect(result!.backup.counts.folders).toBe(2);
    }, 15000);

    it('错误的口令应无法解密', async () => {
      await expect(downloadLatestSnapshot('wrong-passphrase')).rejects.toThrow('同步口令错误');
    }, 15000);
  });

  describe('元数据查询', () => {
    beforeAll(async () => {
      await signIn(TEST_EMAIL, TEST_PASSWORD);
    });

    it('应获取最新版本号', async () => {
      const version = await getLatestVersion();
      expect(version).toBe(2);
    }, 10000);

    it('应获取同步元数据', async () => {
      const metadata = await getSyncMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata!.current_version).toBe(2);
      expect(metadata!.device_count).toBe(1);
    }, 10000);

    it('应列出所有快照', async () => {
      const snapshots = await listSnapshots();
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      expect(snapshots[0].version).toBe(2); // 最新的在前
      expect(snapshots[1].version).toBe(1);
    }, 10000);
  });

  describe('未登录时的行为', () => {
    beforeAll(async () => {
      await signOut();
    });

    it('上传快照应抛出未登录错误', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: new Date().toISOString(),
        counts: {
          folders: 0,
          tags: 0,
          prompts: 0,
          promptVersions: 0,
          runs: 0,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: [],
        tags: [],
        prompts: [],
        promptVersions: [],
        runs: [],
        attachments: [],
        improvementRequests: [],
      };

      await expect(uploadSnapshot(mockBackup, TEST_PASSPHRASE, 0)).rejects.toThrow(NotAuthenticatedError);
    }, 10000);

    it('下载快照应抛出未登录错误', async () => {
      await expect(downloadLatestSnapshot(TEST_PASSPHRASE)).rejects.toThrow(NotAuthenticatedError);
    }, 10000);
  });
});

// ============================================================================
// 离线模拟测试（不依赖 Supabase）
// ============================================================================

describe('sync-service (offline)', () => {
  it('应正确抛出未登录错误', async () => {
    // 确保未登录状态
    await signOut().catch(() => {});

    const mockBackup: BackupFile = {
      app: 'riddle-notes',
      version: '2.1.0',
      exportedAt: new Date().toISOString(),
      counts: {
        folders: 0,
        tags: 0,
        prompts: 0,
        promptVersions: 0,
        runs: 0,
        attachments: 0,
        improvementRequests: 0,
      },
      folders: [],
      tags: [],
      prompts: [],
      promptVersions: [],
      runs: [],
      attachments: [],
      improvementRequests: [],
    };

    await expect(uploadSnapshot(mockBackup, 'test', 0)).rejects.toThrow(NotAuthenticatedError);
  });

  it('ConflictError 应包含版本号', () => {
    const error = new ConflictError(1, 3);
    expect(error.localVersion).toBe(1);
    expect(error.remoteVersion).toBe(3);
    expect(error.message).toContain('v1');
    expect(error.message).toContain('v3');
  });
});
