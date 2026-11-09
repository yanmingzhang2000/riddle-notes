import { describe, it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { ClaudeAdapter } from '../src/content/adapters/claude';
import { GeminiAdapter } from '../src/content/adapters/gemini';
import { WorkBuddyAdapter } from '../src/content/adapters/workbuddy';

describe('Multi-Platform Adapters', () => {
  describe('ChatGPT Adapter', () => {
    const adapter = new ChatGPTAdapter();

    it('should match ChatGPT URLs', () => {
      expect(adapter.matches('https://chat.openai.com')).toBe(true);
      expect(adapter.matches('https://chat.openai.com/chat')).toBe(true);
      expect(adapter.matches('https://chatgpt.com')).toBe(true);
      expect(adapter.matches('https://chatgpt.com/c/example')).toBe(true);
    });

    it('should not match other URLs', () => {
      expect(adapter.matches('https://claude.ai')).toBe(false);
      expect(adapter.matches('https://gemini.google.com')).toBe(false);
      expect(adapter.matches('https://workbuddy.ai')).toBe(false);
    });

    it('should have correct platform metadata', () => {
      expect(adapter.platformId).toBe('chatgpt');
      expect(adapter.platformName).toBe('ChatGPT');
    });
  });

  describe('Claude Adapter', () => {
    const adapter = new ClaudeAdapter();

    it('should match Claude URLs', () => {
      expect(adapter.matches('https://claude.ai')).toBe(true);
      expect(adapter.matches('https://claude.ai/chat')).toBe(true);
    });

    it('should not match other URLs', () => {
      expect(adapter.matches('https://chat.openai.com')).toBe(false);
      expect(adapter.matches('https://chatgpt.com')).toBe(false);
      expect(adapter.matches('https://gemini.google.com')).toBe(false);
    });

    it('should have correct platform metadata', () => {
      expect(adapter.platformId).toBe('claude');
      expect(adapter.platformName).toBe('Claude');
    });
  });

  describe('Gemini Adapter', () => {
    const adapter = new GeminiAdapter();

    it('should match Gemini URLs', () => {
      expect(adapter.matches('https://gemini.google.com')).toBe(true);
      expect(adapter.matches('https://gemini.google.com/app')).toBe(true);
    });

    it('should not match other URLs', () => {
      expect(adapter.matches('https://chat.openai.com')).toBe(false);
      expect(adapter.matches('https://claude.ai')).toBe(false);
      expect(adapter.matches('https://workbuddy.ai')).toBe(false);
    });

    it('should have correct platform metadata', () => {
      expect(adapter.platformId).toBe('gemini');
      expect(adapter.platformName).toBe('Gemini');
    });
  });

  describe('WorkBuddy Adapter', () => {
    const adapter = new WorkBuddyAdapter();

    it('should match WorkBuddy URLs', () => {
      expect(adapter.matches('https://workbuddy.ai')).toBe(true);
      expect(adapter.matches('https://workbuddy.ai/chat')).toBe(true);
    });

    it('should not match other URLs', () => {
      expect(adapter.matches('https://chat.openai.com')).toBe(false);
      expect(adapter.matches('https://claude.ai')).toBe(false);
      expect(adapter.matches('https://gemini.google.com')).toBe(false);
    });

    it('should have correct platform metadata', () => {
      expect(adapter.platformId).toBe('workbuddy');
      expect(adapter.platformName).toBe('WorkBuddy');
    });
  });

  describe('Adapter Interface', () => {
    const adapters = [
      new ChatGPTAdapter(),
      new ClaudeAdapter(),
      new GeminiAdapter(),
      new WorkBuddyAdapter(),
    ];

    it('should implement all required methods', () => {
      adapters.forEach(adapter => {
        expect(adapter.findAssistantMessages).toBeDefined();
        expect(adapter.findUserMessage).toBeDefined();
        expect(adapter.findCopyButtons).toBeDefined();
        expect(adapter.extractMessageText).toBeDefined();
        expect(adapter.extractAttachments).toBeDefined();
        expect(adapter.getConversationUrl).toBeDefined();
      });
    });
  });
});
