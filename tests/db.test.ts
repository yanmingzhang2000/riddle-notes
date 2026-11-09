import { describe, it, expect, beforeEach } from 'vitest';
import { db, initializeDefaultData, Folder } from '../src/db/schema';

describe('Database Schema', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.folders.clear();
    await db.tags.clear();
    await db.prompts.clear();
    await db.promptVersions.clear();
    await db.runs.clear();
  });

  describe('Folders', () => {
    it('should create a folder', async () => {
      const folderId = await db.folders.add({
        name: 'Test Folder',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const folder = await db.folders.get(folderId);
      expect(folder).toBeDefined();
      expect(folder?.name).toBe('Test Folder');
    });

    it('should list all folders', async () => {
      await db.folders.bulkAdd([
        { name: 'Folder 1', sortOrder: 0, createdAt: new Date(), updatedAt: new Date() },
        { name: 'Folder 2', sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);

      const folders = await db.folders.toArray();
      expect(folders).toHaveLength(2);
    });
  });

  describe('Prompts', () => {
    it('should create a prompt', async () => {
      const promptId = await db.prompts.add({
        title: 'Test Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const prompt = await db.prompts.get(promptId);
      expect(prompt).toBeDefined();
      expect(prompt?.title).toBe('Test Prompt');
    });

    it('should create prompt with version', async () => {
      const promptId = await db.prompts.add({
        title: 'Test Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const versionId = await db.promptVersions.add({
        promptId,
        versionNumber: 1,
        content: 'This is a test prompt',
        changeNote: 'Initial version',
        createdAt: new Date(),
      });

      const version = await db.promptVersions.get(versionId);
      expect(version).toBeDefined();
      expect(version?.promptId).toBe(promptId);
    });
  });

  describe('Initialize Default Data', () => {
    it('should create default folders on first run', async () => {
      await initializeDefaultData();
      
      const folders = await db.folders.toArray();
      expect(folders.length).toBeGreaterThan(0);
      expect(folders.find(f => f.name === '未分类')).toBeDefined();
    });

    it('should not create duplicate default folders', async () => {
      await initializeDefaultData();
      await initializeDefaultData();
      
      const folders = await db.folders.toArray();
      const unsortedCount = folders.filter(f => f.name === '未分类').length;
      expect(unsortedCount).toBe(1);
    });
  });
});
