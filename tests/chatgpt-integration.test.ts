import { describe, test, expect, vi, beforeEach } from 'vitest';
import { chatGPTAdapter } from '../src/content/adapters/chatgpt';

// ChatGPT 特定的 DOM 结构测试
describe('ChatGPTAdapter Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches URL correctly', () => {
    expect(chatGPTAdapter.matches('https://chat.openai.com/chat')).toBe(true);
    expect(chatGPTAdapter.matches('https://chatgpt.com/')).toBe(true);
    expect(chatGPTAdapter.matches('https://claude.ai/')).toBe(false);
    expect(chatGPTAdapter.matches('https://gemini.google.com/')).toBe(false);
  });

  test('finds assistant messages with data-testid', () => {
    // 模拟 ChatGPT 的 DOM 结构
    document.body.innerHTML = `
      <div class="chat-container">
        <div data-testid="user-message">
          <div class="markdown">User: Hello</div>
        </div>
        <div data-testid="assistant-message">
          <div class="markdown">AI: Hi there!</div>
        </div>
        <div data-testid="user-message">
          <div class="markdown">User: How are you?</div>
        </div>
        <div data-testid="assistant-message">
          <div class="markdown">AI: I'm good, thanks!</div>
        </div>
      </div>
    `;

    const messages = chatGPTAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].getAttribute('data-testid')).toBe('assistant-message');
  });

  test('finds assistant messages with data-message-author-role', () => {
    // 新版 ChatGPT DOM 结构
    document.body.innerHTML = `
      <div>
        <div data-message-author-role="user">
          <div class="markdown">User prompt</div>
        </div>
        <div data-message-author-role="assistant">
          <div class="markdown">Assistant response</div>
        </div>
      </div>
    `;

    const messages = chatGPTAdapter.findAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].getAttribute('data-message-author-role')).toBe('assistant');
  });

  test('extracts message text from markdown content', () => {
    const assistantMessage = document.createElement('div');
    assistantMessage.innerHTML = `
      <div class="markdown">
        <p>This is an <strong>AI response</strong> with code:</p>
        <pre><code>console.log("hello");</code></pre>
        <p>And some <em>emphasized</em> text.</p>
      </div>
    `;

    const extractedText = chatGPTAdapter.extractMessageText(assistantMessage);
    expect(extractedText).toContain('This is an AI response with code:');
    expect(extractedText).toContain('console.log("hello");');
    expect(extractedText).not.toContain('<strong>'); // HTML 标签应该被移除
  });

  test('finds user message corresponding to assistant message', () => {
    document.body.innerHTML = `
      <div class="message-group">
        <div data-testid="user-message" class="message">
          <div class="content">What is TypeScript?</div>
        </div>
        <div data-testid="assistant-message" class="message">
          <div class="content">TypeScript is a typed superset of JavaScript.</div>
        </div>
      </div>
    `;

    const assistantMessages = chatGPTAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    
    const assistantMessage = assistantMessages[0];
    const userMessage = chatGPTAdapter.findUserMessage(assistantMessage);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.getAttribute('data-testid')).toBe('user-message');
    expect(userMessage!.querySelector('.content')!.textContent).toBe('What is TypeScript?');
  });

  test('extracts attachments from message', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="markdown">
        <p>Here's an image:</p>
        <img src="https://example.com/image.png" alt="Example image">
        <p>And a blob file:</p>
        <a href="blob:https://chat.openai.com/abc-123">download.txt</a>
      </div>
    `;

    const attachments = chatGPTAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(2);
    
    const imageAttachment = attachments.find(a => a.mimeType.startsWith('image/'));
    expect(imageAttachment).toBeDefined();
    expect(imageAttachment!.name).toBe('Example image');
    expect(imageAttachment!.sourceUrl).toBe('https://example.com/image.png');
    
    const blobAttachment = attachments.find(a => a.mimeType === 'application/octet-stream');
    expect(blobAttachment).toBeDefined();
    expect(blobAttachment!.name).toBe('download.txt');
  });

  test('excludes avatar images from attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="markdown">
        <img src="https://example.com/avatar.jpg" alt="User avatar">
        <p>User's avatar should not be extracted</p>
        <img src="https://example.com/diagram.png" alt="Diagram" width="200" height="150">
      </div>
    `;

    const attachments = chatGPTAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(1); // 只有图表图片，没有头像
    expect(attachments[0].name).toBe('Diagram');
  });

  test('finds copy buttons in message', () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message">
        <div class="markdown">
          <pre><code>const x = 5;</code></pre>
        </div>
        <div class="actions">
          <button aria-label="Copy code">Copy</button>
          <button aria-label="Regenerate">↻</button>
          <button aria-label="Like">👍</button>
        </div>
      </div>
    `;

    const copyButtons = chatGPTAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(1);
    expect(copyButtons[0].getAttribute('aria-label')).toBe('Copy code');
  });

  test('gets current conversation URL', () => {
    const originalLocation = window.location.href;
    
    // 模拟 ChatGPT 页面
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: 'https://chat.openai.com/c/abc-123' }
    });

    const url = chatGPTAdapter.getConversationUrl();
    expect(url).toBe('https://chat.openai.com/c/abc-123');

    // 恢复原始 location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: originalLocation }
    });
  });

  test('handles complex DOM structure with nested elements', () => {
    document.body.innerHTML = `
      <div class="conversation">
        <div class="message-container" data-message-id="1">
          <div data-testid="user-message">
            <div class="flex items-center">
              <img src="avatar.jpg" alt="avatar" class="w-6 h-6">
              <div class="markdown">
                <p>First question</p>
              </div>
            </div>
          </div>
        </div>
        <div class="message-container" data-message-id="2">
          <div data-testid="assistant-message">
            <div class="flex items-center">
              <div class="markdown">
                <p>First answer</p>
                <pre><code>code block</code></pre>
              </div>
              <div class="actions">
                <button aria-label="Copy">📋</button>
              </div>
            </div>
          </div>
        </div>
        <div class="message-container" data-message-id="3">
          <div data-testid="user-message">
            <div class="markdown">
              <p>Follow-up question</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = chatGPTAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    
    const assistantMessage = assistantMessages[0];
    const text = chatGPTAdapter.extractMessageText(assistantMessage);
    expect(text).toContain('First answer');
    expect(text).toContain('code block');
    expect(text).not.toContain('📋'); // 按钮文本应该被移除
    
    const copyButtons = chatGPTAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(1);
  });
});

describe('ChatGPTAdapter - Edge Cases', () => {
  test('handles empty page', () => {
    document.body.innerHTML = '';
    
    const messages = chatGPTAdapter.findAssistantMessages();
    expect(messages).toHaveLength(0);
    
    const buttons = chatGPTAdapter.findCopyButtons();
    expect(buttons).toHaveLength(0);
  });

  test('handles messages without markdown class', () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message">
        <div>Simple text without markdown class</div>
        <div class="actions">
          <button>Copy</button>
        </div>
      </div>
    `;

    const messages = chatGPTAdapter.findAssistantMessages();
    expect(messages).toHaveLength(1);
    
    const text = chatGPTAdapter.extractMessageText(messages[0]);
    expect(text).toBe('Simple text without markdown class');
  });

  test('filters out excluded elements from text extraction', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="markdown">
        <h1>Title</h1>
        <nav>
          <a href="#">Home</a>
          <a href="#">About</a>
        </nav>
        <p>Actual content</p>
        <header>
          <h2>Header content</h2>
        </header>
      </div>
    `;

    const text = chatGPTAdapter.extractMessageText(message);
    expect(text).toContain('Title');
    expect(text).toContain('Actual content');
    expect(text).not.toContain('Home'); // nav 内容应该被排除
    expect(text).not.toContain('Header content'); // header 内容应该被排除
  });
});