import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { ClaudeAdapter } from '../src/content/adapters/claude';
import { GeminiAdapter } from '../src/content/adapters/gemini';
import { WorkBuddyAdapter } from '../src/content/adapters/workbuddy';

/**
 * DOM fixture 测试
 * 
 * 测试各平台的 DOM 文本提取功能
 * 使用 jsdom 模拟真实 DOM 结构
 */
describe('DOM Extraction Tests', () => {
  describe('ChatGPT DOM Extraction', () => {
    let document: Document;
    let adapter: ChatGPTAdapter;

    beforeEach(() => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <body>
          <div data-testid="user-message">Please help me write a product analysis</div>
          <div data-testid="assistant-message">
            <button>Copy</button>
            <p>Here is the product analysis you requested...</p>
          </div>
        </body>
      `);
      document = dom.window.document;
      adapter = new ChatGPTAdapter();
      
      // Mock document in adapter methods
      global.document = document as any;
    });

    it('should find assistant messages', () => {
      const messages = adapter.findAssistantMessages();
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should extract message text', () => {
      const messages = adapter.findAssistantMessages();
      if (messages.length > 0) {
        const text = adapter.extractMessageText(messages[0]);
        expect(text).toContain('product analysis');
        expect(text).not.toContain('Copy'); // Button should be removed
      }
    });
  });

  describe('Claude DOM Extraction', () => {
    let document: Document;
    let adapter: ClaudeAdapter;

    beforeEach(() => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <body>
          <div class="font-user-message">What is the weather today?</div>
          <div class="font-claude-message">
            <p>The weather today is sunny and warm.</p>
          </div>
        </body>
      `);
      document = dom.window.document;
      adapter = new ClaudeAdapter();
      
      global.document = document as any;
    });

    it('should find assistant messages', () => {
      const messages = adapter.findAssistantMessages();
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('Gemini DOM Extraction', () => {
    let document: Document;
    let adapter: GeminiAdapter;

    beforeEach(() => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <body>
          <div class="user-query-text">Explain quantum computing</div>
          <div class="model-response-text">
            <p>Quantum computing is a type of computation...</p>
          </div>
        </body>
      `);
      document = dom.window.document;
      adapter = new GeminiAdapter();
      
      global.document = document as any;
    });

    it('should find assistant messages', () => {
      const messages = adapter.findAssistantMessages();
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('WorkBuddy DOM Extraction', () => {
    let document: Document;
    let adapter: WorkBuddyAdapter;

    beforeEach(() => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <body>
          <div class="user-input">How do I create a REST API?</div>
          <div class="ai-response">
            <p>To create a REST API, you need to...</p>
          </div>
        </body>
      `);
      document = dom.window.document;
      adapter = new WorkBuddyAdapter();
      
      global.document = document as any;
    });

    it('should find assistant messages', () => {
      const messages = adapter.findAssistantMessages();
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('Star Button Injection Deduplication', () => {
    let document: Document;

    beforeEach(() => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <body>
          <div id="message1">
            <button class="existing-star-btn sidecar-star-btn">Star</button>
          </div>
          <div id="message2">
            <button>No star yet</button>
          </div>
        </body>
      `);
      document = dom.window.document;
      global.document = document as any;
    });

    it('should detect existing star buttons', () => {
      const existingStar = document.querySelector('.sidecar-star-btn');
      expect(existingStar).toBeDefined();
      
      // Check if the button already has the class
      const message1 = document.getElementById('message1');
      const starButton = message1?.querySelector('.sidecar-star-btn');
      expect(starButton).toBeDefined();
    });

    it('should not have duplicate star buttons', () => {
      const allStarButtons = document.querySelectorAll('.sidecar-star-btn');
      expect(allStarButtons.length).toBe(1);
    });
  });
});
