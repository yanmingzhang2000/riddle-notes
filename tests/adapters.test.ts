import { describe, it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';

describe('ChatGPT Adapter', () => {
  const adapter = new ChatGPTAdapter();

  describe('Platform Detection', () => {
    it('should match ChatGPT URLs', () => {
      expect(adapter.matches('https://chat.openai.com')).toBe(true);
      expect(adapter.matches('https://chat.openai.com/chat')).toBe(true);
      expect(adapter.matches('https://chatgpt.com')).toBe(true);
    });

    it('should not match other URLs', () => {
      expect(adapter.matches('https://claude.ai')).toBe(false);
      expect(adapter.matches('https://gemini.google.com')).toBe(false);
      expect(adapter.matches('https://google.com')).toBe(false);
    });
  });

  describe('Platform Metadata', () => {
    it('should have correct platform ID', () => {
      expect(adapter.platformId).toBe('chatgpt');
    });

    it('should have correct platform name', () => {
      expect(adapter.platformName).toBe('ChatGPT');
    });
  });

  // 注意：DOM 相关测试需要在浏览器环境中运行
  // 这里只测试基本的接口存在性
  describe('Interface Implementation', () => {
    it('should implement all required methods', () => {
      expect(adapter.findAssistantMessages).toBeDefined();
      expect(adapter.findUserMessage).toBeDefined();
      expect(adapter.findCopyButtons).toBeDefined();
      expect(adapter.extractMessageText).toBeDefined();
      expect(adapter.extractAttachments).toBeDefined();
      expect(adapter.getConversationUrl).toBeDefined();
    });
  });
});
