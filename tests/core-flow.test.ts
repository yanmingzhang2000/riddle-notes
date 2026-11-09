import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';

/**
 * 核心流程测试
 * 测试完整的 Prompt 收藏、保存、查看流程
 */
describe('Core Flow - Prompt Collection', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.folders.clear();
    await db.prompts.clear();
    await db.promptVersions.clear();
    await db.runs.clear();
  });

  describe('Step 1: Save Prompt', () => {
    it('should save prompt from ChatGPT', async () => {
      // 模拟从 ChatGPT 保存 Prompt 的过程
      const promptData = {
        promptText: '请帮我写一个产品分析报告',
        outputText: '好的，我将为您撰写产品分析报告...',
        sourcePlatform: 'chatgpt',
        conversationUrl: 'https://chat.openai.com/c/example',
      };

      // 1. 创建 Prompt
      const promptId = await db.prompts.add({
        title: promptData.promptText.substring(0, 50),
        description: promptData.promptText.substring(0, 200),
        sourcePlatform: promptData.sourcePlatform,
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        folderId: 1, // 默认"未分类"
      });

      // 2. 创建第一个版本
      const versionId = await db.promptVersions.add({
        promptId,
        versionNumber: 1,
        content: promptData.promptText,
        changeNote: '初始版本',
        createdAt: new Date(),
      });

      // 3. 创建运行记录
      const runId = await db.runs.add({
        promptId,
        promptVersionId: versionId,
        inputText: promptData.promptText,
        outputText: promptData.outputText,
        sourcePlatform: promptData.sourcePlatform,
        conversationUrl: promptData.conversationUrl,
        createdAt: new Date(),
      });

      // 验证保存结果
      expect(promptId).toBeDefined();
      expect(versionId).toBeDefined();
      expect(runId).toBeDefined();

      // 验证可以查询到数据
      const savedPrompt = await db.prompts.get(promptId);
      expect(savedPrompt?.title).toBe(promptData.promptText.substring(0, 50));

      const savedVersion = await db.promptVersions.get(versionId);
      expect(savedVersion?.content).toBe(promptData.promptText);

      const savedRun = await db.runs.get(runId);
      expect(savedRun?.outputText).toBe(promptData.outputText);
    });
  });

  describe('Step 2: View in Side Panel', () => {
    it('should list all prompts', async () => {
      // 创建多个测试 Prompt
      await db.prompts.bulkAdd([
        {
          title: 'Prompt 1',
          sourcePlatform: 'chatgpt',
          isFavorite: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: 'Prompt 2',
          sourcePlatform: 'chatgpt',
          isFavorite: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const prompts = await db.prompts.toArray();
      expect(prompts).toHaveLength(2);
    });

    it('should filter by favorite', async () => {
      await db.prompts.bulkAdd([
        {
          title: 'Regular Prompt',
          sourcePlatform: 'chatgpt',
          isFavorite: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: 'Favorite Prompt',
          sourcePlatform: 'chatgpt',
          isFavorite: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const favorites = await db.prompts.filter(p => p.isFavorite).toArray();
      expect(favorites).toHaveLength(1);
      expect(favorites[0].title).toBe('Favorite Prompt');
    });

    it('should search by title', async () => {
      await db.prompts.bulkAdd([
        {
          title: 'Product Analysis',
          description: 'Analyze product metrics',
          sourcePlatform: 'chatgpt',
          isFavorite: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: 'Code Review',
          description: 'Review code quality',
          sourcePlatform: 'chatgpt',
          isFavorite: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const results = await db.prompts
        .filter(p => p.title.toLowerCase().includes('product'))
        .toArray();
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Product Analysis');
    });
  });

  describe('Step 3: Version Management', () => {
    it('should create new version', async () => {
      const promptId = await db.prompts.add({
        title: 'Test Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 创建第一个版本
      await db.promptVersions.add({
        promptId,
        versionNumber: 1,
        content: 'Original content',
        createdAt: new Date(),
      });

      // 创建第二个版本
      await db.promptVersions.add({
        promptId,
        versionNumber: 2,
        content: 'Updated content',
        changeNote: 'Added more details',
        createdAt: new Date(),
      });

      const versions = await db.promptVersions
        .where('promptId')
        .equals(promptId)
        .toArray();

      expect(versions).toHaveLength(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
    });
  });

  describe('Step 4: Data Persistence', () => {
    it('should persist data across sessions', async () => {
      // 模拟第一次会话保存数据
      const promptId = await db.prompts.add({
        title: 'Persistent Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 模拟重新打开浏览器（重新查询数据库）
      const retrievedPrompt = await db.prompts.get(promptId);
      
      expect(retrievedPrompt).toBeDefined();
      expect(retrievedPrompt?.title).toBe('Persistent Prompt');
    });
  });

  describe('Step 5: Copy Prompt Content', () => {
    it('should get latest version content for copying', async () => {
      const promptId = await db.prompts.add({
        title: 'Test Prompt',
        sourcePlatform: 'chatgpt',
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.promptVersions.bulkAdd([
        {
          promptId,
          versionNumber: 1,
          content: 'Version 1',
          createdAt: new Date(),
        },
        {
          promptId,
          versionNumber: 2,
          content: 'Version 2 (Latest)',
          createdAt: new Date(),
        },
      ]);

      // 获取最新版本
      const latestVersion = await db.promptVersions
        .where('promptId')
        .equals(promptId)
        .reverse()
        .first();

      expect(latestVersion?.content).toBe('Version 2 (Latest)');
    });
  });
});
