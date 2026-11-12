import { describe, test, expect, beforeEach } from 'vitest';
import { workBuddyAdapter } from '../src/content/adapters/workbuddy';

// WorkBuddy 平台适配器集成测试
describe('WorkBuddyAdapter Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches URL correctly', () => {
    expect(workBuddyAdapter.matches('https://workbuddy.ai')).toBe(true);
    expect(workBuddyAdapter.matches('https://workbuddy.ai/chat')).toBe(true);
    expect(workBuddyAdapter.matches('https://chat.openai.com')).toBe(false);
    expect(workBuddyAdapter.matches('https://gemini.google.com')).toBe(false);
  });

  test('platform metadata', () => {
    expect(workBuddyAdapter.platformId).toBe('workbuddy');
    expect(workBuddyAdapter.platformName).toBe('WorkBuddy');
  });

  test('finds assistant messages with data attributes', () => {
    // 模拟 WorkBuddy 的 DOM 结构（腾讯生态风格）
    document.body.innerHTML = `
      <div class="chat-container">
        <div data-role="user" class="user-message">
          <div class="message-content">
            <p>如何进行数据分析？</p>
          </div>
        </div>
        <div data-role="assistant" class="ai-response">
          <div class="response-content">
            <p>数据分析通常包括数据清洗、探索、建模等步骤。</p>
          </div>
        </div>
        <div data-type="user" class="user-input">
          <div class="input-text">
            <p>推荐一些工具</p>
          </div>
        </div>
        <div data-type="ai" class="assistant-response">
          <div class="ai-response-text">
            <p>常用的数据分析工具有Python的pandas、R语言、Excel等。</p>
          </div>
        </div>
      </div>
    `;

    const messages = workBuddyAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    expect(messages[0].getAttribute('data-role')).toBe('assistant');
    expect(messages[0].querySelector('.response-content')?.textContent).toContain('数据分析');
    
    expect(messages[1].getAttribute('data-type')).toBe('ai');
    expect(messages[1].querySelector('.ai-response-text')?.textContent).toContain('Python');
  });

  test('extracts message text with Chinese class names', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-回复内容">
        <h3>详细解答</h3>
        <p>这里是一个<strong>详细</strong>的解释。</p>
        <div class="代码块">
          <pre><code class="language-python">import pandas as pd</code></pre>
        </div>
        <div class="qq-头像">
          <img src="avatar.jpg" alt="用户头像">
        </div>
        <div class="工具栏">
          <button class="复制按钮">复制</button>
          <button class="分享按钮">分享</button>
        </div>
      </div>
    `;

    const extractedText = workBuddyAdapter.extractMessageText(message);
    expect(extractedText).toContain('详细解答');
    expect(extractedText).toContain('详细');
    expect(extractedText).toContain('import pandas as pd');
    expect(extractedText).not.toContain('复制'); // 按钮文本应该被排除
    expect(extractedText).not.toContain('qq'); // 腾讯组件应该被排除
  });

  test('finds user message using data attributes', () => {
    document.body.innerHTML = `
      <div class="会话区域">
        <div data-role="user" data-message-id="1">
          <div class="内容">解释机器学习</div>
        </div>
        <div data-role="assistant" data-message-id="2">
          <div class="内容">机器学习让计算机从数据中学习。</div>
        </div>
        <div data-type="user" data-message-id="3">
          <div class="内容">举例说明</div>
        </div>
        <div data-type="ai" data-message-id="4">
          <div class="内容">分类算法是机器学习的例子。</div>
        </div>
      </div>
    `;

    const assistantMessages = workBuddyAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = workBuddyAdapter.findUserMessage(firstAssistant);
    
    expect(firstUser).not.toBeNull();
    expect(firstUser!.getAttribute('data-role')).toBe('user');
    expect(firstUser!.querySelector('.内容')?.textContent).toBe('解释机器学习');
    
    const secondAssistant = assistantMessages[1];
    const secondUser = workBuddyAdapter.findUserMessage(secondAssistant);
    
    expect(secondUser).not.toBeNull();
    expect(secondUser!.getAttribute('data-type')).toBe('user');
    expect(secondUser!.querySelector('.内容')?.textContent).toBe('举例说明');
  });

  test('extracts Tencent-style attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="附件区域">
          <div class="上传文件" data-filename="数据图表.png">
            <img src="https://example.com/chart.png" alt="数据分析图表" width="400">
          </div>
          <div class="文件附件">
            <a href="https://example.com/报告.pdf" aria-label="分析报告PDF">
              报告.pdf
            </a>
          </div>
          <div class="代码编辑器">
            <pre><code>function process(data) { return data.filter(x => x > 0); }</code></pre>
          </div>
          <div class="腾讯文档预览">
            <img src="preview.jpg" alt="文档预览" data-title="项目计划表">
          </div>
        </div>
      </div>
    `;

    const attachments = workBuddyAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(4);
    
    const imageAttachment = attachments.find(a => a.mimeType.startsWith('image/') && a.name.includes('图表'));
    expect(imageAttachment).toBeDefined();
    expect(imageAttachment!.name).toBe('数据图表.png');
    
    const pdfAttachment = attachments.find(a => a.mimeType === 'application/pdf');
    expect(pdfAttachment).toBeDefined();
    expect(pdfAttachment!.name).toBe('分析报告PDF');
    
    const codeAttachment = attachments.find(a => a.mimeType === 'text/plain');
    expect(codeAttachment).toBeDefined();
    expect(codeAttachment!.name).toBe('code-1.txt');
    
    const docAttachment = attachments.find(a => a.name === '项目计划表');
    expect(docAttachment).toBeDefined();
  });

  test('finds Chinese copy buttons', () => {
    document.body.innerHTML = `
      <div data-role="assistant">
        <div class="response-text">响应内容</div>
        <div class="操作按钮">
          <button aria-label="复制">
            <span>复制</span>
          </button>
          <button title="拷贝">
            <span>拷贝</span>
          </button>
          <button class="复制按钮" aria-label="Copy">
            <svg>Copy</svg>
          </button>
          <button class="分享按钮">分享</button>
          <div role="button" class="btn" aria-label="复制内容">复制</div>
        </div>
      </div>
    `;

    const copyButtons = workBuddyAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(4); // 四个复制/拷贝按钮
    
    const chineseButton = copyButtons.find(b => b.getAttribute('aria-label') === '复制');
    expect(chineseButton).toBeDefined();
    
    const titleButton = copyButtons.find(b => b.getAttribute('title') === '拷贝');
    expect(titleButton).toBeDefined();
    
    const englishButton = copyButtons.find(b => b.getAttribute('aria-label') === 'Copy');
    expect(englishButton).toBeDefined();
    
    const roleButton = copyButtons.find(b => b.getAttribute('role') === 'button');
    expect(roleButton).toBeDefined();
  });

  test('handles Tencent document attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="assistant-message">
        <p>这是您的文档分析结果：</p>
        <div class="tencent-documents">
          <div class="腾讯文档" data-title="项目计划.txd">
            <img src="preview1.jpg" alt="项目计划预览">
          </div>
          <div class="腾讯云文档" data-title="数据分析报告.tcd">
            <img src="preview2.jpg" alt="报告预览">
          </div>
          <div class="QQ文档" data-title="会议记录.qdoc">
            <img src="preview3.jpg" alt="会议记录预览">
          </div>
        </div>
      </div>
    `;

    const attachments = workBuddyAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(3);
    
    const txdAttachment = attachments.find(a => a.name === '项目计划.txd');
    expect(txdAttachment).toBeDefined();
    expect(txdAttachment!.mimeType).toBe('application/x-tencent-document');
    
    const tcdAttachment = attachments.find(a => a.name === '数据分析报告.tcd');
    expect(tcdAttachment).toBeDefined();
    expect(tcdAttachment!.mimeType).toBe('application/x-tencent-cloud-doc');
    
    const qdocAttachment = attachments.find(a => a.name === '会议记录.qdoc');
    expect(qdocAttachment).toBeDefined();
    expect(qdocAttachment!.mimeType).toBe('application/x-qq-document');
  });

  test('excludes Tencent ecosystem components from text extraction', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="header">
          <div class="qq-头像">
            <img src="qq-avatar.jpg" alt="QQ头像">
          </div>
          <span class="ai-name">WorkBuddy AI</span>
        </div>
        <div class="content">
          <p>这是实际的响应内容。</p>
          <div class="wecom-工具栏">
            <button>转发到企业微信</button>
            <button>保存到腾讯文档</button>
          </div>
        </div>
        <div class="footer">
          <div class="tencent-侧边栏">
            <button>相关工具</button>
            <button>历史记录</button>
          </div>
        </div>
      </div>
    `;

    const text = workBuddyAdapter.extractMessageText(message);
    expect(text).toContain('这是实际的响应内容。');
    expect(text).not.toContain('QQ头像'); // QQ 头像应该被排除
    expect(text).not.toContain('WorkBuddy AI'); // AI 名称可能被排除
    expect(text).not.toContain('企业微信'); // 腾讯组件应该被排除
    expect(text).not.toContain('腾讯文档'); // 腾讯组件应该被排除
  });

  test('handles complex conversation structure with session containers', () => {
    document.body.innerHTML = `
      <div class="workbuddy-app">
        <div class="tencent-sidebar">
          <nav>导航菜单</nav>
        </div>
        <div class="chat-interface">
          <div class="消息列表" role="log">
            <div class="消息项">
              <div class="用户消息" data-role="user">
                <div class="消息气泡">
                  <p>第一个问题</p>
                  <div class="头像">
                    <img src="avatar1.jpg" alt="头像">
                  </div>
                </div>
              </div>
            </div>
            <div class="消息项">
              <div class="AI消息" data-role="assistant">
                <div class="消息气泡">
                  <p>第一个回答</p>
                  <a href="https://example.com">链接</a>
                  <div class="操作">
                    <button class="复制按钮" aria-label="复制消息">
                      复制
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="消息项">
              <div class="用户输入" data-type="user">
                <div class="消息气泡">
                  <p>跟进问题</p>
                  <div class="时间戳">2分钟前</div>
                </div>
              </div>
            </div>
            <div class="消息项">
              <div class="AI回复" data-type="ai">
                <div class="消息气泡">
                  <p>跟进回答</p>
                  <div class="代码">
                    <pre><code>console.log("示例");</code></pre>
                  </div>
                  <div class="文件附件">
                    <div class="附件">
                      <img src="diagram.png" alt="图表" width="300">
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = workBuddyAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(2);
    
    const firstAssistant = assistantMessages[0];
    const firstUser = workBuddyAdapter.findUserMessage(firstAssistant);
    expect(firstUser).not.toBeNull();
    expect(firstUser!.querySelector('p')?.textContent).toBe('第一个问题');
    
    const attachments = workBuddyAdapter.extractAttachments(assistantMessages[1]);
    expect(attachments).toHaveLength(2); // 链接 + 图表图片
    
    const copyButtons = workBuddyAdapter.findCopyButtons();
    expect(copyButtons).toHaveLength(1);
    expect(copyButtons[0].textContent).toContain('复制');
  });

  test('guesses Tencent file MIME types correctly', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="response">
        <div class="attachments">
          <a href="/files/report.txd">report.txd</a>
          <a href="/files/data.tcd">data.tcd</a>
          <a href="/files/notes.qdoc">notes.qdoc</a>
          <a href="/files/analysis.pdf">analysis.pdf</a>
          <a href="/files/data.xlsx">data.xlsx</a>
          <a href="/files/unknown.custom">unknown.custom</a>
        </div>
      </div>
    `;

    const attachments = workBuddyAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(6);
    
    const txdAttachment = attachments.find(a => a.name === 'report.txd');
    expect(txdAttachment!.mimeType).toBe('application/x-tencent-document');
    
    const tcdAttachment = attachments.find(a => a.name === 'data.tcd');
    expect(tcdAttachment!.mimeType).toBe('application/x-tencent-cloud-doc');
    
    const qdocAttachment = attachments.find(a => a.name === 'notes.qdoc');
    expect(qdocAttachment!.mimeType).toBe('application/x-qq-document');
    
    const pdfAttachment = attachments.find(a => a.name === 'analysis.pdf');
    expect(pdfAttachment!.mimeType).toBe('application/pdf');
    
    const excelAttachment = attachments.find(a => a.name === 'data.xlsx');
    expect(excelAttachment!.mimeType).toBe('application/vnd.ms-excel');
    
    const unknownAttachment = attachments.find(a => a.name === 'unknown.custom');
    expect(unknownAttachment!.mimeType).toBe('application/octet-stream');
  });

  test('finds session container in Tencent ecosystem', () => {
    document.body.innerHTML = `
      <div class="tencent-workbuddy">
        <div class="qq-sidebar">
          <div>侧边栏内容</div>
        </div>
        <div class="main-content">
          <div class="聊天会话" data-type="chat">
            <div class="用户消息">消息1</div>
            <div class="AI消息" data-role="assistant">
              <div class="内容">助手回复</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = workBuddyAdapter.findAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    
    const assistantMessage = assistantMessages[0];
    const userMessage = workBuddyAdapter.findUserMessage(assistantMessage);
    
    expect(userMessage).not.toBeNull();
    expect(userMessage!.textContent).toBe('消息1');
  });
});

describe('WorkBuddyAdapter - Edge Cases', () => {
  test('handles messages with mixed Chinese and English', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="内容">
          <p>This is an <strong>English</strong> response with <em>Chinese</em> 中文内容。</p>
          <div class="代码块 code-block">
            <pre><code>// 混合注释 mixed comment</code></pre>
          </div>
          <div class="工具栏 toolbar">
            <button class="复制 copy">Copy</button>
            <button class="分享 share">Share</button>
          </div>
        </div>
      </div>
    `;

    const text = workBuddyAdapter.extractMessageText(message);
    expect(text).toContain('This is an English response with Chinese 中文内容。');
    expect(text).toContain('混合注释 mixed comment');
    expect(text).not.toContain('Copy'); // 按钮文本应该被排除
    expect(text).not.toContain('Share'); // 按钮文本应该被排除
  });

  test('handles empty or minimal messages', () => {
    document.body.innerHTML = `
      <div data-role="assistant">
        <div class="content"></div>
      </div>
      <div data-type="ai">
        <div class="response">
          <p>   </p>
        </div>
      </div>
    `;

    const messages = workBuddyAdapter.findAssistantMessages();
    expect(messages).toHaveLength(2);
    
    const text1 = workBuddyAdapter.extractMessageText(messages[0]);
    expect(text1).toBe('');
    
    const text2 = workBuddyAdapter.extractMessageText(messages[1]);
    expect(text2).toBe('');
    
    const attachments1 = workBuddyAdapter.extractAttachments(messages[0]);
    expect(attachments1).toHaveLength(0);
  });

  test('excludes small avatar images from attachments', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="头像区域">
          <img src="avatar.jpg" alt="用户头像" width="40" height="40">
        </div>
        <div class="内容">
          <p>响应内容</p>
          <div class="图表">
            <img src="chart.png" alt="数据图表" width="400" height="300">
          </div>
        </div>
      </div>
    `;

    const attachments = workBuddyAdapter.extractAttachments(message);
    expect(attachments).toHaveLength(1); // 只有图表图片，不包括头像
    
    const chartAttachment = attachments[0];
    expect(chartAttachment.name).toBe('数据图表');
    expect(chartAttachment.sourceUrl).toBe('https://example.com/chart.png');
  });

  test('handles nested conversation structures', () => {
    document.body.innerHTML = `
      <div class="workbuddy-container">
        <div class="conversation-history">
          <div class="conversation-item">
            <div class="user-query">Question 1</div>
            <div class="ai-response">Answer 1</div>
          </div>
          <div class="conversation-item">
            <div class="user-query">Question 2</div>
            <div class="ai-response">Answer 2</div>
            <div class="follow-up">
              <div class="user-query">Follow-up</div>
              <div class="ai-response">Follow-up answer</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const assistantMessages = workBuddyAdapter.findAssistantMessages();
    expect(assistantMessages.length).toBeGreaterThan(0);
    
    // 至少应该找到一些助手消息
    assistantMessages.forEach(message => {
      const userMessage = workBuddyAdapter.findUserMessage(message);
      // 用户消息可能找到也可能找不到，取决于 DOM 结构
      // 但不应该崩溃
      expect(() => workBuddyAdapter.findUserMessage(message)).not.toThrow();
    });
  });

  test('extracts text from deeply nested structures', () => {
    const message = document.createElement('div');
    message.innerHTML = `
      <div class="ai-response">
        <div class="section">
          <div class="subsection">
            <div class="content">
              <div class="text">
                <p>Deeply <span>nested</span> content</p>
              </div>
            </div>
          </div>
        </div>
        <div class="hidden" style="display: none;">
          <p>Hidden content</p>
        </div>
        <div class="toolbar" aria-hidden="true">
          <button>Hidden button</button>
        </div>
      </div>
    `;

    const text = workBuddyAdapter.extractMessageText(message);
    expect(text).toContain('Deeply nested content');
    expect(text).not.toContain('Hidden content'); // 隐藏内容应该被排除
    expect(text).not.toContain('Hidden button'); // 隐藏按钮应该被排除
  });
});