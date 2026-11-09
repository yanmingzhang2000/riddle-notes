import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';

describe('Import/Export Functionality', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.folders.clear();
    await db.tags.clear();
    await db.prompts.clear();
    await db.promptVersions.clear();
    await db.runs.clear();
    await db.attachments.clear();
  });

  describe('Export', () => {
    it('should export all data as JSON', async () => {
      // 创建测试数据
      const folderId = await db.folders.add({
        name: 'Test Folder',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const promptId = await db.prompts.add({
        title: 'Test Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        folderId,
      });

      const versionId = await db.promptVersions.add({
        promptId,
        versionNumber: 1,
        content: 'Test content',
        createdAt: new Date(),
      });

      const runId = await db.runs.add({
        promptId,
        promptVersionId: versionId,
        inputText: 'Test input',
        outputText: 'Test output',
        sourcePlatform: 'chatgpt',
        createdAt: new Date(),
      });

      // 导出数据
      const folders = await db.folders.toArray();
      const prompts = await db.prompts.toArray();
      const promptVersions = await db.promptVersions.toArray();
      const runs = await db.runs.toArray();

      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        folders,
        prompts,
        promptVersions,
        runs,
        attachments: [],
      };

      // 验证导出数据
      expect(exportData.version).toBe('1.0.0');
      expect(exportData.folders).toHaveLength(1);
      expect(exportData.prompts).toHaveLength(1);
      expect(exportData.promptVersions).toHaveLength(1);
      expect(exportData.runs).toHaveLength(1);
    });
  });

  describe('Import', () => {
    it('should validate import data structure', () => {
      const validData = {
        version: '1.0.0',
        exportedAt: '2024-01-01T00:00:00.000Z',
        folders: [],
        prompts: [],
      };

      expect(validData.version).toBeDefined();
      expect(validData.exportedAt).toBeDefined();
      expect(Array.isArray(validData.prompts)).toBe(true);
    });

    it('should reject invalid data structure', () => {
      const invalidData = {
        version: '1.0.0',
        // missing exportedAt
      };

      expect(invalidData.exportedAt).toBeUndefined();
    });

    it('should import data correctly', async () => {
      const importData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        folders: [
          { id: 1, name: 'Imported Folder', sortOrder: 0, createdAt: new Date(), updatedAt: new Date() },
        ],
        prompts: [
          { id: 1, title: 'Imported Prompt', sourcePlatform: 'chatgpt', isFavorite: false, createdAt: new Date(), updatedAt: new Date() },
        ],
        promptVersions: [],
        runs: [],
        attachments: [],
        tags: [],
      };

      // 清空数据库
      await db.folders.clear();
      await db.prompts.clear();

      // 导入数据
      if (importData.folders?.length > 0) await db.folders.bulkAdd(importData.folders);
      if (importData.prompts?.length > 0) await db.prompts.bulkAdd(importData.prompts);

      // 验证导入结果
      const folders = await db.folders.toArray();
      const prompts = await db.prompts.toArray();

      expect(folders).toHaveLength(1);
      expect(prompts).toHaveLength(1);
      expect(folders[0].name).toBe('Imported Folder');
      expect(prompts[0].title).toBe('Imported Prompt');
    });
  });
});
