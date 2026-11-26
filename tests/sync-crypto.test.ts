/**
 * 云同步加密模块测试
 */

import { describe, it, expect } from 'vitest';
import {
  generateSyncKey,
  createDefaultKdf,
  deriveSyncWrapKey,
  deriveRecoveryWrapKey,
  wrapSyncKey,
  unwrapSyncKey,
  encryptSnapshot,
  decryptSnapshot,
  generateRecoveryKey,
  wipe,
  SyncAuthError,
  SyncCorruptError,
  SYNC_KEY_LENGTH,
} from '../src/shared/sync-crypto';
import type { BackupFile } from '../src/shared/backup';

describe('sync-crypto', () => {
  describe('密钥生成', () => {
    it('应生成 32 字节数据密钥', () => {
      const key = generateSyncKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(SYNC_KEY_LENGTH);
    });

    it('每次生成的密钥应不同', () => {
      const key1 = generateSyncKey();
      const key2 = generateSyncKey();
      expect(key1).not.toEqual(key2);
    });

    it('应生成恢复密钥和格式化字符串', async () => {
      const { bytes, formatted } = await generateRecoveryKey();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(SYNC_KEY_LENGTH);
      expect(formatted).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{5}){9}$/);
    });
  });

  describe('KDF', () => {
    it('应创建默认 KDF 参数', () => {
      const kdf = createDefaultKdf();
      expect(kdf.algorithm).toBe('PBKDF2-SHA256');
      expect(kdf.iterations).toBe(600_000);
      expect(kdf.salt).toBeInstanceOf(Uint8Array);
      expect(kdf.salt.length).toBe(32);
    });

    it('应从同步口令派生包装密钥', async () => {
      const kdf = createDefaultKdf();
      const wrapKey = await deriveSyncWrapKey('test-passphrase-12345', kdf);
      expect(wrapKey).toBeInstanceOf(CryptoKey);
      expect(wrapKey.type).toBe('secret');
    });

    it('相同口令和 KDF 参数应派生相同密钥', async () => {
      const kdf = createDefaultKdf();
      const wrapKey1 = await deriveSyncWrapKey('test-passphrase', kdf);
      const wrapKey2 = await deriveSyncWrapKey('test-passphrase', kdf);
      
      // 验证派生的密钥相同（通过包装/解包测试）
      const dataKey = generateSyncKey();
      const wrapped1 = await wrapSyncKey(dataKey, wrapKey1);
      const unwrapped = await unwrapSyncKey(wrapped1, wrapKey2);
      expect(unwrapped).toEqual(dataKey);
      wipe(dataKey);
      wipe(unwrapped);
    });

    it('不同口令应派生不同密钥', async () => {
      const kdf = createDefaultKdf();
      const wrapKey1 = await deriveSyncWrapKey('passphrase-1', kdf);
      const wrapKey2 = await deriveSyncWrapKey('passphrase-2', kdf);
      
      const dataKey = generateSyncKey();
      const wrapped = await wrapSyncKey(dataKey, wrapKey1);
      
      // 用错误的密钥解包应失败
      await expect(unwrapSyncKey(wrapped, wrapKey2)).rejects.toThrow(SyncAuthError);
      wipe(dataKey);
    });

    it('应从恢复密钥派生包装密钥', async () => {
      const { bytes } = await generateRecoveryKey();
      const wrapKey = await deriveRecoveryWrapKey(bytes);
      expect(wrapKey).toBeInstanceOf(CryptoKey);
      expect(wrapKey.type).toBe('secret');
      wipe(bytes);
    });
  });

  describe('密钥包装和解包', () => {
    it('应成功包装和解包数据密钥', async () => {
      const dataKey = generateSyncKey();
      const kdf = createDefaultKdf();
      const wrapKey = await deriveSyncWrapKey('test-passphrase', kdf);
      
      const wrapped = await wrapSyncKey(dataKey, wrapKey);
      expect(wrapped.wrappedKey).toBeInstanceOf(Uint8Array);
      expect(wrapped.iv).toBeInstanceOf(Uint8Array);
      expect(wrapped.wrappedKey.length).toBe(SYNC_KEY_LENGTH + 16); // 数据 + GCM tag
      expect(wrapped.iv.length).toBe(12);
      
      const unwrapped = await unwrapSyncKey(wrapped, wrapKey);
      expect(unwrapped).toEqual(dataKey);
      
      wipe(dataKey);
      wipe(unwrapped);
    });

    it('错误的包装密钥应无法解包', async () => {
      const dataKey = generateSyncKey();
      const kdf = createDefaultKdf();
      const wrapKey1 = await deriveSyncWrapKey('correct', kdf);
      const wrapKey2 = await deriveSyncWrapKey('wrong', kdf);
      
      const wrapped = await wrapSyncKey(dataKey, wrapKey1);
      
      await expect(unwrapSyncKey(wrapped, wrapKey2)).rejects.toThrow(SyncAuthError);
      wipe(dataKey);
    });

    it('篡改密文应无法解包', async () => {
      const dataKey = generateSyncKey();
      const kdf = createDefaultKdf();
      const wrapKey = await deriveSyncWrapKey('test', kdf);
      
      const wrapped = await wrapSyncKey(dataKey, wrapKey);
      
      // 篡改密文
      wrapped.wrappedKey[0] ^= 1;
      
      await expect(unwrapSyncKey(wrapped, wrapKey)).rejects.toThrow(SyncAuthError);
      wipe(dataKey);
    });
  });

  describe('快照加密和解密', () => {
    const mockBackup: BackupFile = {
      app: 'riddle-notes',
      version: '2.1.0',
      exportedAt: '2026-11-26T10:00:00Z',
      counts: {
        folders: 1,
        tags: 0,
        prompts: 2,
        promptVersions: 2,
        runs: 2,
        attachments: 0,
        improvementRequests: 0,
      },
      folders: [
        { id: 1, name: '未分类', sortOrder: 0, createdAt: '2026-11-26T10:00:00Z' as any, updatedAt: '2026-11-26T10:00:00Z' as any },
      ],
      tags: [],
      prompts: [
        {
          id: 1,
          uid: 'test-uid-1',
          type: 'ai',
          title: '测试笔记 1',
          folderId: 1,
          createdAt: '2026-11-26T10:00:00Z' as any,
          updatedAt: '2026-11-26T10:00:00Z' as any,
        },
        {
          id: 2,
          uid: 'test-uid-2',
          type: 'manual',
          title: '测试笔记 2',
          content: '手动笔记内容',
          folderId: 1,
          createdAt: '2026-11-26T10:00:00Z' as any,
          updatedAt: '2026-11-26T10:00:00Z' as any,
        },
      ],
      promptVersions: [
        { id: 1, promptId: 1, content: '提问 1', versionNumber: 1, createdAt: '2026-11-26T10:00:00Z' as any },
        { id: 2, promptId: 2, content: '提问 2', versionNumber: 1, createdAt: '2026-11-26T10:00:00Z' as any },
      ],
      runs: [
        { id: 1, promptId: 1, outputText: 'AI 回复 1', createdAt: '2026-11-26T10:00:00Z' as any },
        { id: 2, promptId: 2, outputText: 'AI 回复 2', createdAt: '2026-11-26T10:00:00Z' as any },
      ],
      attachments: [],
      improvementRequests: [],
    };

    it('应成功加密和解密快照', async () => {
      const dataKey = generateSyncKey();
      
      const encrypted = await encryptSnapshot(mockBackup, dataKey);
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(0);
      
      const decrypted = await decryptSnapshot(encrypted, dataKey);
      expect(decrypted).toEqual(mockBackup);
      
      wipe(dataKey);
    });

    it('错误的数据密钥应无法解密', async () => {
      const dataKey1 = generateSyncKey();
      const dataKey2 = generateSyncKey();
      
      const encrypted = await encryptSnapshot(mockBackup, dataKey1);
      
      await expect(decryptSnapshot(encrypted, dataKey2)).rejects.toThrow(SyncAuthError);
      
      wipe(dataKey1);
      wipe(dataKey2);
    });

    it('篡改密文应无法解密', async () => {
      const dataKey = generateSyncKey();
      
      const encrypted = await encryptSnapshot(mockBackup, dataKey);
      
      // 篡改密文
      encrypted[encrypted.length - 1] ^= 1;
      
      await expect(decryptSnapshot(encrypted, dataKey)).rejects.toThrow(SyncAuthError);
      
      wipe(dataKey);
    });

    it('加密快照应包含 IV', async () => {
      const dataKey = generateSyncKey();
      
      const encrypted = await encryptSnapshot(mockBackup, dataKey);
      
      // 前 12 字节应该是 IV
      expect(encrypted.length).toBeGreaterThan(12 + 16); // IV + 至少一些密文 + tag
      
      wipe(dataKey);
    });
  });

  describe('完整流程：口令包装 + 快照加密', () => {
    it('应完成端到端加密和解密', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: '2026-11-26T10:00:00Z',
        counts: {
          folders: 1,
          tags: 0,
          prompts: 1,
          promptVersions: 1,
          runs: 1,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: [{ id: 1, name: '未分类', sortOrder: 0, createdAt: '2026-11-26T10:00:00Z' as any, updatedAt: '2026-11-26T10:00:00Z' as any }],
        tags: [],
        prompts: [
          {
            id: 1,
            uid: 'test',
            type: 'ai',
            title: '测试',
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

      // 1. 生成数据密钥
      const dataKey = generateSyncKey();

      // 2. 生成 KDF 参数并派生包装密钥
      const kdf = createDefaultKdf();
      const wrapKey = await deriveSyncWrapKey('my-secure-passphrase', kdf);

      // 3. 包装数据密钥
      const wrappedDataKey = await wrapSyncKey(dataKey, wrapKey);

      // 4. 加密快照
      const encryptedSnapshot = await encryptSnapshot(mockBackup, dataKey);

      // --- 模拟上传到云端，然后在另一台设备下载 ---

      // 5. 解包数据密钥（使用相同口令）
      const unwrappedDataKey = await unwrapSyncKey(wrappedDataKey, wrapKey);

      // 6. 解密快照
      const decryptedBackup = await decryptSnapshot(encryptedSnapshot, unwrappedDataKey);

      expect(decryptedBackup).toEqual(mockBackup);

      wipe(dataKey);
      wipe(unwrappedDataKey);
    });

    it('错误的口令应无法恢复数据', async () => {
      const mockBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: '2026-11-26T10:00:00Z',
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

      const dataKey = generateSyncKey();
      const kdf = createDefaultKdf();
      const correctWrapKey = await deriveSyncWrapKey('correct-passphrase', kdf);
      const wrongWrapKey = await deriveSyncWrapKey('wrong-passphrase', kdf);

      const wrappedDataKey = await wrapSyncKey(dataKey, correctWrapKey);
      const encryptedSnapshot = await encryptSnapshot(mockBackup, dataKey);

      // 尝试用错误的口令解包
      await expect(unwrapSyncKey(wrappedDataKey, wrongWrapKey)).rejects.toThrow(SyncAuthError);

      wipe(dataKey);
    });
  });

  describe('恢复密钥流程', () => {
    it('应能用恢复密钥解包数据密钥', async () => {
      const dataKey = generateSyncKey();
      const { bytes: recoveryKeyBytes } = await generateRecoveryKey();
      const wrapKey = await deriveRecoveryWrapKey(recoveryKeyBytes);

      const wrapped = await wrapSyncKey(dataKey, wrapKey);
      const unwrapped = await unwrapSyncKey(wrapped, wrapKey);

      expect(unwrapped).toEqual(dataKey);

      wipe(dataKey);
      wipe(unwrapped);
      wipe(recoveryKeyBytes);
    });
  });

  describe('性能', () => {
    it('PBKDF2 60 万次应在合理时间内完成', async () => {
      const kdf = createDefaultKdf();
      const start = performance.now();
      await deriveSyncWrapKey('test-passphrase', kdf);
      const duration = performance.now() - start;

      // 应在 2 秒内完成（取决于设备性能）
      expect(duration).toBeLessThan(2000);
      console.log(`PBKDF2 ${kdf.iterations} iterations: ${duration.toFixed(0)}ms`);
    }, 5000);

    it('加密 1MB 快照应在 1 秒内完成', async () => {
      // 构造 1MB 左右的 mock 数据
      const largeBackup: BackupFile = {
        app: 'riddle-notes',
        version: '2.1.0',
        exportedAt: '2026-11-26T10:00:00Z',
        counts: {
          folders: 100,
          tags: 100,
          prompts: 1000,
          promptVersions: 1000,
          runs: 1000,
          attachments: 0,
          improvementRequests: 0,
        },
        folders: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `文件夹 ${i + 1}`,
          sortOrder: i,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        tags: Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `标签 ${i + 1}`,
          createdAt: new Date(),
        })),
        prompts: Array.from({ length: 1000 }, (_, i) => ({
          id: i + 1,
          uid: `uid-${i + 1}`,
          type: 'ai' as const,
          title: `笔记 ${i + 1} `.repeat(10), // 增加数据量
          folderId: (i % 100) + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        promptVersions: Array.from({ length: 1000 }, (_, i) => ({
          id: i + 1,
          promptId: i + 1,
          content: `提问内容 ${i + 1} `.repeat(50), // 更多数据
          versionNumber: 1,
          createdAt: new Date(),
        })),
        runs: Array.from({ length: 1000 }, (_, i) => ({
          id: i + 1,
          promptId: i + 1,
          outputText: `AI 回复内容 ${i + 1} `.repeat(100), // 更多数据
          createdAt: new Date(),
        })),
        attachments: [],
        improvementRequests: [],
      };

      const dataKey = generateSyncKey();

      const start = performance.now();
      const encrypted = await encryptSnapshot(largeBackup, dataKey);
      const duration = performance.now() - start;

      const sizeKB = encrypted.length / 1024;
      console.log(`Encrypted ${sizeKB.toFixed(0)}KB snapshot in ${duration.toFixed(0)}ms`);

      expect(duration).toBeLessThan(1000);
      wipe(dataKey);
    }, 5000);
  });
});
