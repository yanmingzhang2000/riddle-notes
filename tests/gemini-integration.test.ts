import { describe, test, expect, beforeEach } from 'vitest';
import { geminiAdapter } from '../src/content/adapters/gemini';

// Gemini 平台适配器集成测试
describe('GeminiAdapter Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches URL correctly', () => {
    expect(geminiAdapter.matches('https://gemini.google.com')).toBe(true);
    expect(geminiAdapter.matches('https://gemini.google.com/chat')).toBe(true);
    expect(geminiAdapter.matches('https://gemini.google.com/app')).toBe(true);
    expect(geminiAdapter.matches('https://chat.openai.com')).toBe(false);
    expect(geminiAdapter.matches('https://claude.ai')).toBe(false);
  });

  test('platform metadata', () => {
    expect(geminiAdapter.platformId).toBe('gemini');
    expect(geminiAdapter.platformName).toBe('Gemini');
  });

  test('finds assistant messages with role attribute', () => {
    // 模拟 Gemini 的 DOM 结构（Material Design 风格）
    document.body.innerHTML = `
      <div class="chat-container">
        <div role="user" class="user-message">
          <div class="message-content">
            <p>What is machine learning?</p>
          </div>
        </div>
        <div role="assistant" class="model-response">
          <div class="response-content">
            <p>Machine learning is a subset of AI that enables systems to learn from data.</p>
          </div>
        </div>
        <div data-message-type="user" class="user-query">
          <div class="query-text">
            <p>Give me an example</p>
          </div>
        </div>
        <div data-message-type="model" class="assistant-message">
          <div class="model-response-text">
            <p>Classification algorithms like logistic regression are examples of ML.</p>
          </div>
        </div>
      </div>
    `;

    const messages = geminiAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    expect(messages[0].getAttribute('role')).toBe('assistant');
    expect(messages[0].querySelector('.response-content')?.textContent).toContain('Machine learning');
    
    expect(messages[1].getAttribute('data-message-type')).toBe('model');
    expect(messages[1].querySelector('.model-response-text')?.textContent).toContain('Classification');
  });

  test('extracts message text with Material Design components', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="model-response-text">
        <h3>Explanation</h3>
        <p>Here is a <strong>detailed</strong> explanation.</p>
        <pre><code class="language-typescript">const example: string = "code";</code></pre>
        <div class="mat-chip-list">
          <mat-chip>Concept 1</mat-chip>
          <mat-chip>Concept 2</mat-chip>
        </div>
      </div>
    `;

    const extractedText = geminiAdapter.extractMessageText(message);
    expect(extractedText).toContain('Explanation');
    expect(extractedText).toContain('detailed');
    expect(extractedText).toContain('const example: string = "code"');
    expect(extractedText).not.toContain('mat-chip'); // Material Design 组件应该被排除
  });

  test('finds user message using role-based search', () => {
    document.body.innerHTML = `
      <div class="message-thread">
        <div role="user" data-message-id="1">
          <div class="content">Explain quantum computing</div>
        </div>
        <div role="assistant" data-message-id="2">
          <div class="content">Quantum computing uses qubits instead of bits.</div>
        </div>
        <div data-message-type="user" data-message-id="3">
          <div class="content">What are qubits?</div>
        </div>
        <div data-message-type="model" data-message-id="4">
          <div class="content">Qubits can be in superposition states.</div>
        </div>
      </div>
    `;

    const assistantMessages = geminiAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = geminiAdapter.findUserMessage(firstAssistant);
    
    expect(firstUser).not.toBeNull();
    expect(firstUser!.getAttribute('role')).toBe('user');
    expect(firstUser!.querySelector('.content')?.textContent).toBe('Explain quantum computing');
    
    const secondAssistant = assistantMessages[1];
    const secondUser = geminiAdapter.findUserMessage(secondAssistant);
    
    expect(secondUser).not.toBeNull();
    expect(secondUser!.getAttribute('data-message-type')).toBe('user');
    expect(secondUser!.querySelector('.content')?.textContent).toBe('What are qubits?');
  });

  test('extracts various types of attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="model-response">
        <div class="attachments-section">
          <div data-test-id="image-preview" class="uploaded-image">
            <img src="https://example.com/chart.png" alt="Data visualization chart">
          </div>
          <div class="file-attachment">
            <a href="https://example.com/document.pdf" aria-label="Research paper PDF">
              research-paper.pdf
            </a>
          </div>
          <div class="code-snippet">
            <pre><code>function example() { return "code"; }</code></pre>
          </div>
          <div class="user-avatar">
            <img src="avatar.jpg" alt="User profile picture">
          </div>
        </div>
      </div>
    `;

    const attachments = geminiAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(3); // 图表图片 + PDF + 代码片段，不包括头像
    
    const imageAttachment = attachments.find(a => a.mimeType.startsWith('image/'));
    expect(imageAttachment).toBeDefined();
    expect(imageAttachment!.name).toBe('Data visualization chart');
    expect(imageAttachment!.sourceUrl).toBe('https://example.com/chart.png');
    
    const pdfAttachment = attachments.find(a => a.mimeType === 'application/pdf');
    expect(pdfAttachment).toBeDefined();
    expect(pdfAttachment!.name).toBe('Research paper PDF');
    expect(pdfAttachment!.sourceUrl).toBe('https://example.com/document.pdf');
    
    const codeAttachment = attachments.find(a => a.mimeType === 'text/plain');
    expect(codeAttachment).toBeDefined();
    expect(codeAttachment!.name).toBe('code-snippet-1.txt');
  });

  test('finds Material Design copy buttons', () => {
    document.body.innerHTML = `
      <div role="assistant">
        <div class="response-text">Response content</div>
        <div class="action-buttons">
          <mat-icon-button aria-label="Copy response">
            <mat-icon>content_copy</mat-icon>
          </mat-icon-button>
          <mat-icon-button title="Regenerate">
            <mat-icon>refresh</mat-icon>
          </mat-icon-button>
          <button mat-icon-button aria-label="Thumbs up">
            <mat-icon>thumb_up</mat-icon>
          </button>
          <button aria-label="Copy to clipboard">Copy</button>
        </div>
      </div>
    `;

    const copyButtons = geminiAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(2); // 两个复制按钮
    
    const matButton = copyButtons.find(b => b.tagName === 'MAT-ICON-BUTTON');
    expect(matButton).toBeDefined();
    expect(matButton!.getAttribute('aria-label')).toBe('Copy response');
    
    const regularButton = copyButtons.find(b => b.tagName === 'BUTTON' && b.textContent === 'Copy');
    expect(regularButton).toBeDefined();
  });

  test('handles file upload attachments with previews', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="assistant-message">
        <p>Here's the analysis of your uploaded files:</p>
        <div class="file-previews">
          <div class="file-preview" data-filename="data.csv">
            <div class="preview-thumbnail">
              <img src="https://gemini.google.com/preview/data.csv.png" alt="CSV preview">
            </div>
            <span class="file-name">data.csv</span>
          </div>
          <div class="uploaded-file">
            <img src="blob:https://gemini.google.com/abc123" alt="Uploaded image">
          </div>
        </div>
      </div>
    `;

    const attachments = geminiAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(2);
    
    const csvAttachment = attachments.find(a => a.name.includes('.csv'));
    expect(csvAttachment).toBeDefined();
    expect(csvAttachment!.mimeType).toBe('text/csv');
    
    const imageAttachment = attachments.find(a => a.sourceUrl?.includes('blob:'));
    expect(imageAttachment).toBeDefined();
    expect(imageAttachment!.mimeType).toBe('image/jpeg'); // 默认猜测 JPEG
  });

  test('excludes Material Design icons and avatars from text extraction', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="model-response">
        <div class="header">
          <mat-icon class="model-icon">smart_toy</mat-icon>
          <span class="model-name">Gemini</span>
        </div>
        <div class="content">
          <p>This is the actual response content.</p>
          <mat-chip-set>
            <mat-chip>Topic 1</mat-chip>
            <mat-chip>Topic 2</mat-chip>
          </mat-chip-set>
        </div>
        <div class="footer">
          <mat-icon-button aria-label="Copy">
            <mat-icon>content_copy</mat-icon>
          </mat-icon-button>
        </div>
      </div>
    `;

    const text = geminiAdapter.extractMessageText(message);
    expect(text).toContain('This is the actual response content.');
    expect(text).not.toContain('smart_toy'); // Material 图标应该被排除
    expect(text).not.toContain('Gemini'); // 模型名称可能被排除
    expect(text).not.toContain('Topic'); // Material chips 应该被排除
    expect(text).not.toContain('content_copy'); // 按钮文本应该被排除
  });

  test('handles complex conversation structure', () => {
    document.body.innerHTML = `
      <div class="chat-interface">
        <div class="message-list" role="list">
          <div role="listitem" class="message-item">
            <div role="user" class="message-role">
              <div class="message-bubble">
                <p>First question</p>
                <div class="user-avatar">
                  <img src="avatar1.jpg" alt="Avatar">
                </div>
              </div>
            </div>
          </div>
          <div role="listitem" class="message-item">
            <div role="assistant" class="message-role">
              <div class="message-bubble">
                <p>First answer with <a href="https://example.com">link</a></p>
                <div class="actions">
                  <mat-icon-button aria-label="Copy message">
                    <mat-icon>content_copy</mat-icon>
                  </mat-icon-button>
                </div>
              </div>
            </div>
          </div>
          <div role="listitem" class="message-item">
            <div data-message-type="user">
              <div class="message-bubble">
                <p>Follow-up question</p>
                <div class="timestamp">2 min ago</div>
              </div>
            </div>
          </div>
          <div role="listitem" class="message-item">
            <div data-message-type="model">
              <div class="message-bubble">
                <p>Follow-up answer</p>
                <pre><code>console.log("example");</code></pre>
                <div class="file-attachments">
                  <div class="attachment">
                    <img src="diagram.png" alt="Diagram" width="300">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = geminiAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = geminiAdapter.findUserMessage(firstAssistant);
    expect(firstUser).not.toBeNull();
    expect(firstUser!.querySelector('p')?.textContent).toBe('First question');
    
    const attachments = geminiAdapter.extractAttachments(assistantMessages[1]);
    expect(attachments).toHaveLength(2); // 链接 + 图表图片
  });

  test('finds user message using position-based search when no containers found', () => {
    // 模拟扁平化的 DOM 结构
    document.body.innerHTML = `
      <div class="user-query-text">
        <p>Question about physics</p>
      </div>
      <div class="some-other-element">
        <span>Not a message</span>
      </div>
      <div class="model-response-text">
        <p>Physics is the study of matter and energy</p>
      </div>
    `;

    const assistantMessages = geminiAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    
    const assistantMessage = assistantMessages[0];
    const userMessage = geminiAdapter.findUserMessage(assistantMessage);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.className).toBe('user-query-text');
  });

  test('guesses file MIME types correctly', () => {
    // 测试 guessFileMimeType 方法（通过测试附件提取来间接测试）
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="response">
        <div class="attachments">
          <a href="/files/report.pdf">report.pdf</a>
          <a href="/files/data.xlsx">data.xlsx</a>
          <a href="/files/notes.txt">notes.txt</a>
          <a href="/files/config.json">config.json</a>
          <a href="/files/unknown.custom">unknown.custom</a>
        </div>
      </div>
    `;

    const attachments = geminiAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(5);
    
    const pdfAttachment = attachments.find(a => a.name === 'report.pdf');
    expect(pdfAttachment!.mimeType).toBe('application/pdf');
    
    const excelAttachment = attachments.find(a => a.name === 'data.xlsx');
    expect(excelAttachment!.mimeType).toBe('application/vnd.ms-excel');
    
    const txtAttachment = attachments.find(a => a.name === 'notes.txt');
    expect(txtAttachment!.mimeType).toBe('text/plain');
    
    const jsonAttachment = attachments.find(a => a.name === 'config.json');
    expect(jsonAttachment!.mimeType).toBe('application/json');
    
    const unknownAttachment = attachments.find(a => a.name === 'unknown.custom');
    expect(unknownAttachment!.mimeType).toBe('application/octet-stream');
  });
});

describe('GeminiAdapter - Edge Cases', () => {
  test('handles empty messages', () => {
    document.body.innerHTML = `
      <div role="assistant">
        <div class="content"></div>
      </div>
    `;

    const messages = geminiAdapter.findAssistantMessages();
    expect(messages).toHaveLength(1);
    
    const text = geminiAdapter.extractMessageText(messages[0]);
    expect(text).toBe('');
    
    const attachments = geminiAdapter.extractAttachments(messages[0]);
    expect(attachments).toHaveLength(0);
  });

  test('handles messages with only images', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="model-response">
        <div class="image-only">
          <img src="https://example.com/diagram.png" alt="Diagram" width="400">
          <img src="avatar.jpg" alt="Avatar" width="30" height="30">
        </div>
      </div>
    `;

    const text = geminiAdapter.extractMessageText(message);
    expect(text).toBe(''); // 只有图片，没有文本
    
    const attachments = geminiAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(1); // 只有图表图片，不包括头像
  });

  test('handles duplicate assistant messages', () => {
    document.body.innerHTML = `
      <div role="assistant" class="message">
        <p>First response</p>
      </div>
      <div role="assistant" class="message">
        <p>Second response</p>
      </div>
      <div role="assistant" class="message">
        <p>First response</p> <!-- 重复内容 -->
      </div>
    `;

    const messages = geminiAdapter.findAssistantMessages();
    expect(messages).toHaveLength(3); // 仍然找到所有消息，重复检测由上层逻辑处理
    
    const userMessage = geminiAdapter.findUserMessage(messages[0]);
    expect(userMessage).toBeNull(); // 没有用户消息
  });

  test('extracts text from nested structures', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="rich-response">
        <div class="section">
          <h2>Introduction</h2>
          <p>This is the <em>intro</em>.</p>
        </div>
        <div class="section">
          <h3>Details</h3>
          <ul>
            <li>Point 1</li>
            <li>Point 2</li>
            <li>Point 3</li>
          </ul>
        </div>
        <div class="action-section" style="display: none;">
          <button>Hidden action</button>
        </div>
      </div>
    `;

    const text = geminiAdapter.extractMessageText(message);
    expect(text).toContain('Introduction');
    expect(text).toContain('intro');
    expect(text).toContain('Details');
    expect(text).toContain('Point 1');
    expect(text).not.toContain('Hidden action'); // 隐藏内容应该被排除
  });
});