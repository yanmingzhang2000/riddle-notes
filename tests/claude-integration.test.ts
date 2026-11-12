import { describe, test, expect, beforeEach } from 'vitest';
import { claudeAdapter } from '../src/content/adapters/claude';
import { CLAUDE_SELECTORS } from '../src/content/selectors';

// Claude 平台适配器集成测试
describe('ClaudeAdapter Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches URL correctly', () => {
    expect(claudeAdapter.matches('https://claude.ai')).toBe(true);
    expect(claudeAdapter.matches('https://claude.ai/chat')).toBe(true);
    expect(claudeAdapter.matches('https://claude.ai/new')).toBe(true);
    expect(claudeAdapter.matches('https://chat.openai.com')).toBe(false);
    expect(claudeAdapter.matches('https://gemini.google.com')).toBe(false);
    expect(claudeAdapter.matches('https://workbuddy.ai')).toBe(false);
  });

  test('platform metadata', () => {
    expect(claudeAdapter.platformId).toBe('claude');
    expect(claudeAdapter.platformName).toBe('Claude');
    expect(claudeAdapter.selectors).toBe(CLAUDE_SELECTORS);
  });

  test('finds assistant messages with data attributes', () => {
    // 模拟 Claude 的 DOM 结构
    document.body.innerHTML = `
      <div class="claude-chat-container">
        <div data-testid="user-message" class="user-message">
          <div class="message-content">
            <p>Explain the difference between AI and AGI</p>
          </div>
        </div>
        <div data-testid="assistant-message" class="assistant-message">
          <div class="response-content prose">
            <p>AI (Artificial Intelligence) refers to systems that can perform specific intelligent tasks...</p>
          </div>
        </div>
        <div data-role="user" class="font-user-message">
          <div class="human-content">
            <p>What about ASI?</p>
          </div>
        </div>
        <div data-role="assistant" class="font-claude-message">
          <div class="claude-message">
            <p>ASI (Artificial Superintelligence) refers to AI that surpasses human intelligence in all domains...</p>
          </div>
        </div>
      </div>
    `;

    const messages = claudeAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    // 检查找到的消息
    const message1 = messages[0];
    const message2 = messages[1];
    expect(message1.getAttribute('data-testid')).toBe('assistant-message');
    expect(message2.getAttribute('data-role')).toBe('assistant');
  });

  test('finds assistant messages with class selectors', () => {
    document.body.innerHTML = `
      <div class="conversation-log">
        <div class="message-bubble user">
          <p>Write a Python function to calculate factorial</p>
        </div>
        <div class="message-bubble assistant">
          <pre><code class="language-python">def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)</code></pre>
        </div>
        <div class="assistant-content">
          <p>The function uses recursion to calculate factorial</p>
        </div>
        <div class="model-response">
          <p>This is an efficient implementation for small n</p>
        </div>
      </div>
    `;

    const messages = claudeAdapter.findAssistantMessages();
    expect(messages).toHaveLength(3);
  });

  test('excludes non-message elements correctly', () => {
    document.body.innerHTML = `
      <div class="chat-interface">
        <nav class="sidebar">
          <img src="avatar.png" alt="User Avatar" />
          <div class="anthropic-brand">Claude AI</div>
        </nav>
        <div data-role="user" class="user-message">
          <p>Hello Claude</p>
        </div>
        <div data-role="assistant" class="assistant-message">
          <p>Hello! How can I help you today?</p>
        </div>
        <footer class="chat-footer">
          <div class="virtual-scroll-placeholder"></div>
        </footer>
      </div>
    `;

    const messages = claudeAdapter.findAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].getAttribute('data-role')).toBe('assistant');
  });

  test('finds user message for given assistant message', () => {
    document.body.innerHTML = `
      <div class="message-container">
        <div data-testid="user-message" id="user1">
          <p>What is machine learning?</p>
        </div>
        <div data-testid="assistant-message" id="assistant1">
          <p>Machine learning is a subset of AI...</p>
        </div>
        <div data-testid="user-message" id="user2">
          <p>Give examples</p>
        </div>
        <div data-testid="assistant-message" id="assistant2">
          <p>Examples include classification, regression...</p>
        </div>
      </div>
    `;

    const assistant2 = document.getElementById('assistant2')!;
    const userMessage = claudeAdapter.findUserMessage(assistant2);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.id).toBe('user2');
  });

  test('finds user message using data-role attributes', () => {
    document.body.innerHTML = `
      <div data-virtual-scroll="true" class="scroll-container">
        <div data-role="user" class="font-user-message">
          <p>Explain neural networks</p>
        </div>
        <div data-role="assistant" class="font-claude-message">
          <p>Neural networks are computing systems...</p>
        </div>
        <div data-role="user" class="font-user-message">
          <p>What about CNN?</p>
        </div>
        <div data-role="assistant" class="font-claude-message" id="target-assistant">
          <p>CNN is Convolutional Neural Network...</p>
        </div>
      </div>
    `;

    const assistant = document.getElementById('target-assistant')!;
    const userMessage = claudeAdapter.findUserMessage(assistant);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.textContent).toContain('What about CNN?');
  });

  test('finds user message in virtual scroll environment', () => {
    document.body.innerHTML = `
      <div class="virtual-scroll-container" style="overflow-y: auto;">
        <div class="conversation-item">
          <div class="message-wrapper">
            <div class="message-bubble user" id="user1">
              <p>First question</p>
            </div>
          </div>
        </div>
        <div class="conversation-item">
          <div class="message-wrapper">
            <div class="message-bubble assistant" id="assistant1">
              <p>First answer</p>
            </div>
          </div>
        </div>
        <div class="conversation-item">
          <div class="message-wrapper">
            <div class="message-bubble user" id="user2">
              <p>Second question</p>
            </div>
          </div>
        </div>
        <div class="conversation-item">
          <div class="message-wrapper">
            <div class="message-bubble assistant" id="assistant2">
              <p>Second answer</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistant2 = document.getElementById('assistant2')!;
    const userMessage = claudeAdapter.findUserMessage(assistant2);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.id).toBe('user2');
  });

  test('extracts code attachments from Claude responses', () => {
    document.body.innerHTML = `
      <div data-role="assistant" id="assistant-message">
        <p>Here's a Python example:</p>
        <pre><code class="language-python">import numpy as np

def sigmoid(x):
    return 1 / (1 + np.exp(-x))</code></pre>
        <p>And here's JavaScript:</p>
        <div class="code-block">
          <div class="code-title">JavaScript Implementation</div>
          <code data-code="js">function multiply(a, b) {
  return a * b;
}</code>
        </div>
        <p>Finally, some JSON data:</p>
        <pre><code data-json>{ "name": "example", "value": 42 }</code></pre>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(3);
    
    // 检查代码附件
    const pythonAttachments = attachments.filter(a => a.name.includes('.py'));
    const jsAttachments = attachments.filter(a => a.name.includes('.js'));
    const jsonAttachments = attachments.filter(a => a.name.includes('.json'));
    
    expect(pythonAttachments.length).toBeGreaterThan(0);
    expect(jsAttachments.length).toBeGreaterThan(0);
    expect(jsonAttachments.length).toBeGreaterThan(0);
  });

  test('extracts file attachments from Claude uploads', () => {
    document.body.innerHTML = `
      <div data-role="assistant" id="assistant-message">
        <p>I can see your uploaded files:</p>
        <div class="attachment-area">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIwAAAABJRU5ErkJggg==" 
               alt="diagram.png"
               data-filename="architecture.png" />
        </div>
        <div class="file-preview" data-attachment="true">
          <a href="https://claude.ai/downloads/report.pdf" data-filename="analysis_report.pdf">
            <span class="filename">analysis_report.pdf</span>
          </a>
        </div>
        <div class="document-container" data-file="data.csv">
          <div class="document-name">data.csv</div>
        </div>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(2);
    
    // 检查文件附件
    const imageAttachments = attachments.filter(a => a.mimeType.includes('image'));
    const pdfAttachments = attachments.filter(a => a.mimeType.includes('pdf'));
    
    expect(imageAttachments.length).toBeGreaterThan(0);
    expect(pdfAttachments.length).toBeGreaterThan(0);
  });

  test('extracts rich content blocks from Claude responses', () => {
    document.body.innerHTML = `
      <div data-role="assistant" id="assistant-message">
        <p>Here's a detailed explanation:</p>
        <div class="content-block" data-title="Algorithm Comparison">
          <h4>Sorting Algorithms</h4>
          <table>
            <tr><th>Algorithm</th><th>Time Complexity</th></tr>
            <tr><td>Bubble Sort</td><td>O(n²)</td></tr>
            <tr><td>Quick Sort</td><td>O(n log n)</td></tr>
          </table>
          <ul>
            <li>Use Quick Sort for large datasets</li>
            <li>Use Bubble Sort for small datasets</li>
          </ul>
        </div>
        <div class="response-section" data-content-block="math">
          <div class="equation">E = mc²</div>
        </div>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThan(0);
    
    // 检查内容块附件
    const contentAttachments = attachments.filter(a => a.name.includes('Algorithm_Comparison') || a.name.includes('txt'));
    expect(contentAttachments.length).toBeGreaterThan(0);
  });

  test('sanitizes filenames correctly', () => {
    document.body.innerHTML = `
      <div id="test-message">
        <div class="code-block" data-title="Test: File/Name.txt">
          <code>test</code>
        </div>
      </div>
    `;

    const message = document.getElementById('test-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThan(0);
    const attachment = attachments[0];
    
    // 文件名应该被清理
    expect(attachment.name).not.toContain('/');
    expect(attachment.name).not.toContain(':');
    expect(attachment.name).toMatch(/^Test_File_Name.*\.txt$/);
  });

  test('finds copy buttons with various selectors', () => {
    document.body.innerHTML = `
      <div class="message-actions">
        <button aria-label="Copy" class="copy-button">Copy</button>
        <button aria-label="Copy message" class="action-icon">Copy</button>
        <button title="复制" class="icon-button">Copy</button>
        <button aria-label="Regenerate" class="regenerate-button">↻</button>
        <button aria-label="Thumbs up" class="feedback-button">👍</button>
        <button class="copy-action" aria-label="Copy code">Copy</button>
      </div>
      <div class="icon-menu" title="Copy">
        <button>Copy</button>
      </div>
      <div class="clipboard-container" aria-label="Copy to clipboard">
        <button>Copy</button>
      </div>
    `;

    const buttons = claudeAdapter.findCopyButtons();
    
    // 应该找到复制按钮，排除非复制按钮
    expect(buttons.length).toBeGreaterThan(3);
    
    // 检查按钮属性
    const copyButtons = Array.from(buttons).filter(button => {
      const label = (button.getAttribute('aria-label') || '').toLowerCase();
      const title = (button.getAttribute('title') || '').toLowerCase();
      const text = (button.textContent || '').toLowerCase();
      return label.includes('copy') || title.includes('copy') || text.includes('copy');
    });
    
    expect(copyButtons.length).toBeGreaterThan(0);
    
    // 确保没有包含再生或反馈按钮
    const regenerateButtons = Array.from(buttons).filter(button => {
      const label = (button.getAttribute('aria-label') || '').toLowerCase();
      return label.includes('regenerate');
    });
    expect(regenerateButtons.length).toBe(0);
  });

  test('extracts structured data attachments', () => {
    document.body.innerHTML = `
      <div id="assistant-message">
        <p>Here's some data:</p>
        <pre data-yaml data-title="Configuration File">
apiVersion: v1
kind: ConfigMap
metadata:
  name: example
data:
  key: value
        </pre>
        <div class="json-output" data-json="true">
{
  "user": {
    "name": "John",
    "age": 30
  }
}
        </div>
        <div data-xml class="xml-data">
          <root>
            <item>value</item>
          </root>
        </div>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(3);
    
    const yamlAttachments = attachments.filter(a => a.name.includes('.yml') || a.name.includes('.yaml'));
    const jsonAttachments = attachments.filter(a => a.name.includes('.json'));
    const xmlAttachments = attachments.filter(a => a.name.includes('.xml'));
    
    expect(yamlAttachments.length).toBeGreaterThan(0);
    expect(jsonAttachments.length).toBeGreaterThan(0);
    expect(xmlAttachments.length).toBeGreaterThan(0);
  });

  test('guesses code language correctly', () => {
    document.body.innerHTML = `
      <div id="test-message">
        <code class="language-python">print("Hello")</code>
        <code class="claude-js">console.log("test")</code>
        <code class="typescript-block">const x: number = 5;</code>
        <code>SELECT * FROM users;</code>
        <code>public class Test { }</code>
      </div>
    `;

    const message = document.getElementById('test-message')!;
    const codeElements = message.querySelectorAll('code');
    
    // 测试 guessCodeLanguage 方法
    const pythonCode = codeElements[0];
    const jsCode = codeElements[1];
    const tsCode = codeElements[2];
    const sqlCode = codeElements[3];
    const javaCode = codeElements[4];
    
    // 调用私有方法需要一些技巧，这里我们测试整体提取功能
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(5);
    
    // 检查文件扩展名
    const pyAttachments = attachments.filter(a => a.name.includes('.py'));
    const jsAttachments = attachments.filter(a => a.name.includes('.js'));
    const javaAttachments = attachments.filter(a => a.name.includes('.java'));
    const sqlAttachments = attachments.filter(a => a.name.includes('.sql'));
    
    expect(pyAttachments.length).toBeGreaterThan(0);
    expect(jsAttachments.length).toBeGreaterThan(0);
    expect(javaAttachments.length).toBeGreaterThan(0);
    expect(sqlAttachments.length).toBeGreaterThan(0);
  });

  test('handles empty message content gracefully', () => {
    document.body.innerHTML = `
      <div id="empty-message">
        <div class="loading-spinner"></div>
        <div class="virtual-placeholder"></div>
        <div class="anthropic-brand">Claude</div>
      </div>
    `;

    const message = document.getElementById('empty-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    // 应该没有附件，或者只有极少的附件
    expect(attachments.length).toBe(0);
  });

  test('extracts images from various containers', () => {
    document.body.innerHTML = `
      <div id="assistant-message">
        <p>Here are some diagrams:</p>
        <div class="media-container">
          <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PC9zdmc+" 
               alt="Diagram 1" 
               data-filename="diagram1.svg" />
        </div>
        <div class="document-preview">
          <img src="chart.png" alt="Sales Chart" />
          <div class="filename">sales_chart.png</div>
        </div>
        <div data-attachment="image">
          <img src="graph.jpg" />
        </div>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(3);
    
    const imageAttachments = attachments.filter(a => 
      a.mimeType.includes('image') || a.mimeType.includes('svg')
    );
    expect(imageAttachments.length).toBeGreaterThan(0);
  });

  test('guesses file MIME types correctly', () => {
    // 创建测试消息
    const message = document.createElement('div');
    
    // 提取不同类型的附件应该返回正确的 MIME 类型
    // 注意：我们无法直接测试私有方法，但可以通过 extractAttachments 间接测试
    
    document.body.innerHTML = `
      <div id="assistant-message">
        <div class="file-preview">
          <a href="document.pdf" data-filename="report.pdf">
            <span class="filename">report.pdf</span>
          </a>
        </div>
        <pre><code class="language-python">print("test")</code></pre>
        <div data-json>
          { "test": true }
        </div>
      </div>
    `;

    const assistantMessage = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(assistantMessage);
    
    expect(attachments.length).toBeGreaterThanOrEqual(3);
    
    const pdfAttachments = attachments.filter(a => a.mimeType.includes('pdf'));
    const textAttachments = attachments.filter(a => a.mimeType.includes('text/plain'));
    const jsonAttachments = attachments.filter(a => a.mimeType.includes('json'));
    
    expect(pdfAttachments.length).toBeGreaterThan(0);
    expect(textAttachments.length).toBeGreaterThan(0);
    expect(jsonAttachments.length).toBeGreaterThan(0);
  });

  test('finds assistant messages with complex virtual scrolling', () => {
    // 测试复杂的虚拟滚动场景
    document.body.innerHTML = `
      <div class="claude-chat" data-virtual-scroll="true" style="height: 500px; overflow-y: auto;">
        <!-- 虚拟滚动占位符 -->
        <div class="virtual-scroll-placeholder" style="height: 1000px;"></div>
        
        <!-- 实际可见的消息 -->
        <div class="visible-messages" style="position: relative; top: 300px;">
          <div data-role="user" class="message-item">
            <p>Question about AI safety</p>
          </div>
          <div data-role="assistant" class="message-item" id="target-assistant">
            <p>AI safety is a critical field...</p>
          </div>
          <div class="loading-indicator">
            <div class="spinner"></div>
          </div>
        </div>
        
        <!-- 更多虚拟滚动占位符 -->
        <div class="virtual-scroll-placeholder" style="height: 1000px;"></div>
      </div>
    `;

    const messages = claudeAdapter.findAssistantMessages();
    expect(messages.length).toBeGreaterThan(0);
    
    // 应该找到目标助手消息
    const targetMessages = messages.filter(msg => msg.id === 'target-assistant');
    expect(targetMessages.length).toBe(1);
  });

  test('handles edge cases in filename extraction', () => {
    document.body.innerHTML = `
      <div id="assistant-message">
        <div class="file-attachment" data-filename="../../etc/passwd">
          <img src="test.png" />
        </div>
        <div class="code-block" data-title="<script>alert('xss')</script>">
          <code>test</code>
        </div>
        <a href="file.txt" data-filename="file_with_very_long_name_that_exceeds_maximum_length_and_needs_to_be_truncated_properly_to_avoid_issues.txt">
          Long filename
        </a>
      </div>
    `;

    const message = document.getElementById('assistant-message')!;
    const attachments = claudeAdapter.extractAttachments(message);
    
    expect(attachments.length).toBeGreaterThanOrEqual(3);
    
    // 文件名应该被清理
    attachments.forEach(attachment => {
      expect(attachment.name).not.toContain('..');
      expect(attachment.name).not.toContain('<');
      expect(attachment.name).not.toContain('>');
      expect(attachment.name).not.toContain('script');
      expect(attachment.name.length).toBeLessThanOrEqual(150); // 合理的最大长度
    });
  });

  // 综合测试：完整的 Claude 对话场景
  test('comprehensive Claude conversation scenario', () => {
    document.body.innerHTML = `
      <div class="claude-app">
        <nav class="anthropic-navbar">
          <div class="claude-logo">Claude</div>
        </nav>
        
        <div class="chat-window">
          <div class="message-thread" role="log" data-virtual-scroll="true">
            <div class="message-group">
              <div data-testid="user-message" class="user-message">
                <p>Write a Python script to analyze CSV data</p>
              </div>
              <div data-testid="assistant-message" class="assistant-message" id="response1">
                <p>Here's a Python script using pandas:</p>
                <pre><code class="language-python">import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('data.csv')
print(df.describe())</code></pre>
                <div class="action-bar">
                  <button aria-label="Copy code" class="copy-btn">Copy</button>
                  <button aria-label="Regenerate" class="regenerate-btn">↻</button>
                </div>
              </div>
            </div>
            
            <div class="message-group">
              <div data-role="user" class="font-user-message">
                <p>Can you add visualization?</p>
              </div>
              <div data-role="assistant" class="font-claude-message" id="response2">
                <p>Sure, here's the updated script with visualization:</p>
                <div class="code-block" data-title="CSV Analysis Script">
                  <pre><code>import pandas as pd
import matplotlib.pyplot as plt

# Load data
df = pd.read_csv('data.csv')

# Basic statistics
print(df.describe())

# Create visualization
df.plot(kind='hist', alpha=0.5)
plt.title('Data Distribution')
plt.show()</code></pre>
                  <div class="code-actions">
                    <button title="Copy" class="icon-button">📋</button>
                  </div>
                </div>
                <p>I've also attached a sample data structure:</p>
                <pre data-json data-title="Data Schema">{
  "columns": ["date", "value", "category"],
  "types": ["datetime", "float", "string"]
}</pre>
              </div>
            </div>
          </div>
        </div>
        
        <footer class="chat-footer">
          <div class="input-area">
            <textarea placeholder="Message Claude..."></textarea>
          </div>
        </footer>
      </div>
    `;

    // 测试 findAssistantMessages
    const messages = claudeAdapter.findAssistantMessages();
    expect(messages.length).toBe(2);
    
    // 测试 findUserMessage
    const response2 = document.getElementById('response2')!;
    const userMessage = claudeAdapter.findUserMessage(response2);
    expect(userMessage).not.toBeNull();
    expect(userMessage!.textContent).toContain('Can you add visualization?');
    
    // 测试 extractAttachments
    const attachments = claudeAdapter.extractAttachments(response2);
    expect(attachments.length).toBeGreaterThanOrEqual(2);
    
    // 测试 findCopyButtons
    const copyButtons = claudeAdapter.findCopyButtons();
    expect(copyButtons.length).toBeGreaterThan(0);
    
    // 验证附件类型
    const pythonAttachments = attachments.filter(a => a.name.includes('.py'));
    const jsonAttachments = attachments.filter(a => a.name.includes('.json'));
    expect(pythonAttachments.length).toBeGreaterThan(0);
    expect(jsonAttachments.length).toBeGreaterThan(0);
  });
});