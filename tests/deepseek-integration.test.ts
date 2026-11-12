import { describe, test, expect, beforeEach } from 'vitest';
import { deepseekAdapter } from '../src/content/adapters/deepseek';

// DeepSeek 平台适配器集成测试
describe('DeepSeekAdapter Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches URL correctly', () => {
    expect(deepseekAdapter.matches('https://chat.deepseek.com')).toBe(true);
    expect(deepseekAdapter.matches('https://chat.deepseek.com/chat')).toBe(true);
    expect(deepseekAdapter.matches('https://chat.openai.com')).toBe(false);
    expect(deepseekAdapter.matches('https://gemini.google.com')).toBe(false);
  });

  test('platform metadata', () => {
    expect(deepseekAdapter.platformId).toBe('deepseek');
    expect(deepseekAdapter.platformName).toBe('DeepSeek');
  });

  test('finds assistant messages with data attributes', () => {
    // 模拟 DeepSeek 的 DOM 结构
    document.body.innerHTML = `
      <div class="chat-container">
        <div data-role="user" class="user-message">
          <div class="message-content">
            <p>Explain neural networks</p>
          </div>
        </div>
        <div data-role="assistant" class="assistant-message">
          <div class="response-content prose">
            <p>Neural networks are computing systems inspired by biological neural networks.</p>
          </div>
        </div>
        <div data-type="user" class="user-query">
          <div class="query-text">
            <p>Give an example</p>
          </div>
        </div>
        <div data-type="assistant" class="model-response">
          <div class="deepseek-answer">
            <p>Convolutional Neural Networks (CNNs) are used for image recognition.</p>
          </div>
        </div>
      </div>
    `;

    const messages = deepseekAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    expect(messages[0].getAttribute('data-role')).toBe('assistant');
    expect(messages[0].querySelector('.prose')?.textContent).toContain('Neural networks');
    
    expect(messages[1].getAttribute('data-type')).toBe('assistant');
    expect(messages[1].querySelector('.deepseek-answer')?.textContent).toContain('Convolutional');
  });

  test('extracts message text excluding thinking sections', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="thinking-section" style="display: none;">
          <p>Let me think about this...</p>
        </div>
        <div class="final-answer prose">
          <h3>Explanation</h3>
          <p>Here is the <strong>final answer</strong>.</p>
          <div class="reasoning">
            <p>Reasoning process hidden</p>
          </div>
        </div>
        <div class="code-block">
          <pre><code class="language-python">def example(): pass</code></pre>
        </div>
        <div class="toolbar">
          <button class="copy-button">Copy</button>
        </div>
      </div>
    `;

    const extractedText = deepseekAdapter.extractMessageText(message);
    expect(extractedText).toContain('Explanation');
    expect(extractedText).toContain('final answer');
    expect(extractedText).toContain('def example(): pass');
    expect(extractedText).not.toContain('Let me think'); // 思考部分应该被排除
    expect(extractedText).not.toContain('Reasoning'); // 推理部分应该被排除
    expect(extractedText).not.toContain('Copy'); // 按钮文本应该被排除
  });

  test('finds user message using data attributes', () => {
    document.body.innerHTML = `
      <div class="conversation-thread">
        <div data-role="user" data-message-id="1">
          <div class="content">What is machine learning?</div>
        </div>
        <div data-role="assistant" data-message-id="2">
          <div class="content">ML enables computers to learn from data.</div>
        </div>
        <div data-type="user" data-message-id="3">
          <div class="content">Examples?</div>
        </div>
        <div data-type="assistant" data-message-id="4">
          <div class="content">Classification, regression, clustering.</div>
        </div>
      </div>
    `;

    const assistantMessages = deepseekAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = deepseekAdapter.findUserMessage(firstAssistant);
    
    expect(firstUser).not.toBeNull();
    expect(firstUser!.getAttribute('data-role')).toBe('user');
    expect(firstUser!.querySelector('.content')?.textContent).toBe('What is machine learning?');
    
    const secondAssistant = assistantMessages[1];
    const secondUser = deepseekAdapter.findUserMessage(secondAssistant);
    
    expect(secondUser).not.toBeNull();
    expect(secondUser!.getAttribute('data-type')).toBe('user');
    expect(secondUser!.querySelector('.content')?.textContent).toBe('Examples?');
  });

  test('extracts code blocks with language detection', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="model-response">
        <p>Here's some example code:</p>
        <div class="code-snippet">
          <pre><code class="language-python">
def calculate_sum(numbers):
    return sum(numbers)
          </code></pre>
        </div>
        <div class="another-code">
          <pre><code class="language-javascript">
function multiply(a, b) {
  return a * b;
}
          </code></pre>
        </div>
        <div class="plain-code">
          <pre><code>
Just plain text here
          </code></pre>
        </div>
      </div>
    `;

    const attachments = deepseekAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(3);
    
    const pythonAttachment = attachments.find(a => a.name === 'code-1.py');
    expect(pythonAttachment).toBeDefined();
    expect(pythonAttachment!.mimeType).toBe('text/x-python');
    
    const jsAttachment = attachments.find(a => a.name === 'code-2.js');
    expect(jsAttachment).toBeDefined();
    expect(jsAttachment!.mimeType).toBe('application/javascript');
    
    const txtAttachment = attachments.find(a => a.name === 'code-3.txt');
    expect(txtAttachment).toBeDefined();
    expect(txtAttachment!.mimeType).toBe('text/plain');
  });

  test('finds copy buttons for code blocks', () => {
    document.body.innerHTML = `
      <div data-role="assistant">
        <div class="response-text">Response content</div>
        <div class="code-container">
          <pre><code>console.log("test");</code></pre>
          <button aria-label="Copy code">Copy</button>
        </div>
        <div class="actions">
          <button title="Copy response">
            <span>Copy</span>
          </button>
          <button class="copy-icon" aria-label="复制">
            <svg>Copy</svg>
          </button>
          <button class="share-button">Share</button>
        </div>
      </div>
    `;

    const copyButtons = deepseekAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(3); // 三个复制按钮
    
    const codeCopyButton = copyButtons.find(b => b.getAttribute('aria-label') === 'Copy code');
    expect(codeCopyButton).toBeDefined();
    
    const titleButton = copyButtons.find(b => b.getAttribute('title') === 'Copy response');
    expect(titleButton).toBeDefined();
    
    const chineseButton = copyButtons.find(b => b.getAttribute('aria-label') === '复制');
    expect(chineseButton).toBeDefined();
  });

  test('handles tables as CSV attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="deepseek-answer">
        <p>Here's a data table:</p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Alice</td>
              <td>25</td>
              <td>95</td>
            </tr>
            <tr>
              <td>Bob</td>
              <td>30</td>
              <td>88</td>
            </tr>
          </tbody>
        </table>
        <p>And another simple table:</p>
        <table>
          <tr>
            <td>Item</td>
            <td>Quantity</td>
          </tr>
          <tr>
            <td>Apples</td>
            <td>10</td>
          </tr>
        </table>
      </div>
    `;

    const attachments = deepseekAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(2);
    
    const firstTable = attachments.find(a => a.name === 'table-1.csv');
    expect(firstTable).toBeDefined();
    expect(firstTable!.mimeType).toBe('text/csv');
    
    const secondTable = attachments.find(a => a.name === 'table-2.csv');
    expect(secondTable).toBeDefined();
    expect(secondTable!.mimeType).toBe('text/csv');
  });

  test('excludes thinking and reasoning sections', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="thinking" style="display: none;">
          <p>I need to consider several factors...</p>
          <div class="reasoning-step">
            <p>Step 1: Analyze the problem</p>
          </div>
        </div>
        <div class="final-response">
          <p>The answer is 42.</p>
          <div class="推理过程">
            <p>Detailed reasoning in Chinese</p>
          </div>
        </div>
        <div class="system-prompt">
          <p>You are a helpful assistant.</p>
        </div>
      </div>
    `;

    const text = deepseekAdapter.extractMessageText(message);
    expect(text).toContain('The answer is 42.');
    expect(text).not.toContain('I need to consider'); // 思考部分应该被排除
    expect(text).not.toContain('Analyze the problem'); // 推理步骤应该被排除
    expect(text).not.toContain('Detailed reasoning'); // 中文推理应该被排除
    expect(text).not.toContain('helpful assistant'); // 系统提示应该被排除
  });

  test('handles complex conversation with thread containers', () => {
    document.body.innerHTML = `
      <div class="deepseek-app">
        <div class="sidebar">
          <nav>Navigation</nav>
        </div>
        <div class="main">
          <div class="conversation-thread" role="log">
            <div class="message-item">
              <div data-role="user" class="human-input">
                <div class="message-bubble">
                  <p>First question</p>
                </div>
              </div>
            </div>
            <div class="message-item">
              <div data-role="assistant" class="ai-response">
                <div class="message-bubble prose">
                  <p>First answer with <a href="https://example.com">link</a></p>
                  <div class="code">
                    <pre><code>console.log("hello");</code></pre>
                    <button aria-label="Copy code">Copy</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="message-item">
              <div data-type="user" class="user-query">
                <div class="message-bubble">
                  <p>Follow-up</p>
                  <div class="timestamp">Just now</div>
                </div>
              </div>
            </div>
            <div class="message-item">
              <div data-type="assistant" class="deepseek-answer">
                <div class="message-bubble">
                  <p>Follow-up answer</p>
                  <table>
                    <tr><td>Data</td><td>Value</td></tr>
                    <tr><td>A</td><td>1</td></tr>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = deepseekAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = deepseekAdapter.findUserMessage(firstAssistant);
    expect(firstUser).not.toBeNull();
    expect(firstUser!.querySelector('p')?.textContent).toBe('First question');
    
    const attachments = deepseekAdapter.extractAttachments(assistantMessages[1]);
    expect(attachments).toHaveLength(1); // 表格附件
    
    const copyButtons = deepseekAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(1);
    expect(copyButtons[0].getAttribute('aria-label')).toBe('Copy code');
  });

  test('guesses file MIME types for various extensions', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="response">
        <div class="files">
          <a href="/files/script.py">script.py</a>
          <a href="/files/app.js">app.js</a>
          <a href="/files/module.ts">module.ts</a>
          <a href="/files/Program.java">Program.java</a>
          <a href="/files/data.csv">data.csv</a>
          <a href="/files/config.json">config.json</a>
          <a href="/files/report.pdf">report.pdf</a>
          <a href="/data.xlsx">data.xlsx</a>
          <a href="/notes.txt">notes.txt</a>
          <a href="/unknown.xyz">unknown.xyz</a>
        </div>
      </div>
    `;

    const attachments = deepseekAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(10);
    
    const pythonFile = attachments.find(a => a.name === 'script.py');
    expect(pythonFile!.mimeType).toBe('text/x-python');
    
    const jsFile = attachments.find(a => a.name === 'app.js');
    expect(jsFile!.mimeType).toBe('application/javascript');
    
    const tsFile = attachments.find(a => a.name === 'module.ts');
    expect(tsFile!.mimeType).toBe('application/typescript');
    
    const javaFile = attachments.find(a => a.name === 'Program.java');
    expect(javaFile!.mimeType).toBe('text/x-java-source');
    
    const csvFile = attachments.find(a => a.name === 'data.csv');
    expect(csvFile!.mimeType).toBe('text/csv');
    
    const jsonFile = attachments.find(a => a.name === 'config.json');
    expect(jsonFile!.mimeType).toBe('application/json');
    
    const pdfFile = attachments.find(a => a.name === 'report.pdf');
    expect(pdfFile!.mimeType).toBe('application/pdf');
    
    const excelFile = attachments.find(a => a.name === 'data.xlsx');
    expect(excelFile!.mimeType).toBe('application/vnd.ms-excel');
    
    const txtFile = attachments.find(a => a.name === 'notes.txt');
    expect(txtFile!.mimeType).toBe('text/plain');
    
    const unknownFile = attachments.find(a => a.name === 'unknown.xyz');
    expect(unknownFile!.mimeType).toBe('application/octet-stream');
  });

  test('detects code language from content', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="code-content">
        <pre><code>
<?php
echo "Hello World";
?>
        </code></pre>
        <pre><code>
def hello():
    print("Hello")
        </code></pre>
        <pre><code>
public class Main {
  public static void main(String[] args) {
    System.out.println("Hello");
  }
}
        </code></pre>
        <pre><code>
function test() {
  console.log("test");
}
        </code></pre>
      </div>
    `;

    const attachments = deepseekAdapter.extractAttachments(message);
    expect(attachments.length).toBeGreaterThan(0);
    
    // 至少应该检测到一些语言
    const phpAttachment = attachments.find(a => a.name.endsWith('.php'));
    expect(phpAttachment).toBeDefined();
    
    const pythonAttachment = attachments.find(a => a.name.endsWith('.py'));
    expect(pythonAttachment).toBeDefined();
    
    const javaAttachment = attachments.find(a => a.name.endsWith('.java'));
    expect(javaAttachment).toBeDefined();
    
    const jsAttachment = attachments.find(a => a.name.endsWith('.js'));
    expect(jsAttachment).toBeDefined();
  });
});

describe('DeepSeekAdapter - Edge Cases', () => {
  test('handles empty or minimal content', () => {
    document.body.innerHTML = `
      <div data-role="assistant">
        <div class="content"></div>
      </div>
      <div data-type="assistant">
        <div class="response">
          <p>   </p>
        </div>
      </div>
    `;

    const messages = deepseekAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    const text1 = deepseekAdapter.extractMessageText(messages[0]);
    expect(text1).toBe('');
    
    const text2 = deepseekAdapter.extractMessageText(messages[1]);
    expect(text2).toBe('');
    
    const attachments = deepseekAdapter.extractAttachments(messages[0]);
    expect(attachments).toHaveLength(0);
  });

  test('excludes small avatar images', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="avatar">
          <img src="avatar.jpg" alt="User avatar" width="32" height="32">
        </div>
        <div class="content">
          <p>Response text</p>
          <div class="diagram">
            <img src="chart.png" alt="Data chart" width="400" height="300">
          </div>
        </div>
      </div>
    `;

    const attachments = deepseekAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(1); // 只有图表图片，不包括头像
    
    const chartAttachment = attachments[0];
    expect(chartAttachment.name).toBe('Data chart');
    expect(chartAttachment.sourceUrl).toBe('https://example.com/chart.png');
  });

  test('handles nested message structures', () => {
    document.body.innerHTML = `
      <div class="deepseek-chat">
        <div class="message-thread">
          <div class="thread-item">
            <div class="user-container">
              <div data-role="user">
                <div class="message">
                  <div class="text">
                    <p>Question about AI</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="assistant-container">
              <div data-role="assistant">
                <div class="message">
                  <div class="text">
                    <div class="nested">
                      <div class="deeper">
                        <p>AI is artificial intelligence</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = deepseekAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    
    const assistantMessage = assistantMessages[0];
    const text = deepseekAdapter.extractMessageText(assistantMessage);
    expect(text).toContain('AI is artificial intelligence');
    
    const userMessage = deepseekAdapter.findUserMessage(assistantMessage);
    expect(userMessage).not.toBeNull();
    expect(userMessage!.querySelector('p')?.textContent).toBe('Question about AI');
  });

  test('extracts text from complex prose content', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="prose">
        <h1>Main Title</h1>
        <h2>Subtitle</h2>
        <p>First paragraph with <strong>bold</strong> text.</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
        <blockquote>
          <p>Quoted text</p>
        </blockquote>
        <p>Last paragraph.</p>
        <div class="hidden-toolbar">
          <button>Copy</button>
          <button>Share</button>
        </div>
      </div>
    `;

    const text = deepseekAdapter.extractMessageText(message);
    expect(text).toContain('Main Title');
    expect(text).toContain('Subtitle');
    expect(text).toContain('First paragraph with bold text.');
    expect(text).toContain('Item 1');
    expect(text).toContain('Item 2');
    expect(text).toContain('Item 3');
    expect(text).toContain('Quoted text');
    expect(text).toContain('Last paragraph.');
    expect(text).not.toContain('Copy'); // 按钮文本应该被排除
    expect(text).not.toContain('Share'); // 按钮文本应该被排除
  });

  test('handles RTL/LTR text direction', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="response" dir="rtl">
        <p>هذا نص باللغة العربية</p>
        <p>This is English text</p>
        <p>זה טקסט בעברית</p>
      </div>
    `;

    const text = deepseekAdapter.extractMessageText(message);
    expect(text).toContain('هذا نص باللغة العربية');
    expect(text).toContain('This is English text');
    expect(text).toContain('זה טקסט בעברית');
  });
});