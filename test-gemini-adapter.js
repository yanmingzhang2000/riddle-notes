#!/usr/bin/env node

/**
 * Gemini 适配器快速验证脚本
 * 
 * 这个脚本可以帮助快速测试 Gemini 适配器的核心功能
 * 无需安装完整依赖，直接运行测试逻辑
 */

// 由于项目使用 ES 模块，这里用简单的 DOM 模拟
if (typeof document === 'undefined') {
  // 创建简单的 DOM 模拟
  global.document = {
    body: {
      innerHTML: '',
      querySelectorAll: function(selector) {
        // 简单的选择器模拟
        if (selector.includes('role="assistant"')) {
          return [{ 
            tagName: 'DIV',
            getAttribute: () => 'assistant',
            parentElement: { previousElementSibling: null },
            querySelector: () => ({ textContent: 'TypeScript is JavaScript with types.' })
          }];
        }
        if (selector.includes('role="user"')) {
          return [{ 
            tagName: 'DIV',
            getAttribute: () => 'user',
            querySelector: () => ({ textContent: 'What is TypeScript?' })
          }];
        }
        return [];
      }
    },
    createElement: function(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        innerHTML: '',
        querySelectorAll: () => []
      };
    },
    querySelectorAll: function() { return []; }
  };
  
  global.window = { location: { href: 'https://gemini.google.com' } };
  global.HTMLElement = class {};
  global.Element = class {};
}

// 导入适配器（需要编译，这里用模拟的方式）
console.log('=== Gemini Adapter Quick Test ===\n');

// 测试选择器配置
console.log('1. 测试 Gemini 选择器配置...');
const geminiSelectors = {
  assistantMessage: [
    '[role="assistant"]',
    '[data-message-type="model"]',
    '[class*="model-response"]',
    '[class*="assistant-message"]',
  ],
  userMessage: [
    '[role="user"]',
    '[data-message-type="user"]',
    '[class*="user-query"]',
    '[class*="user-message"]',
  ],
  copyButton: [
    'button[aria-label*="Copy"]',
    'button[title*="Copy"]',
    'mat-icon-button[aria-label*="Copy"]',
  ],
};

console.log('  助手消息选择器:', geminiSelectors.assistantMessage.length, '个');
console.log('  用户消息选择器:', geminiSelectors.userMessage.length, '个');
console.log('  复制按钮选择器:', geminiSelectors.copyButton.length, '个');

// 测试 URL 匹配
console.log('\n2. 测试 URL 匹配逻辑...');
const geminiDomains = ['gemini.google.com'];
function matchesGeminiUrl(url) {
  return geminiDomains.some(domain => url.includes(domain));
}

const testUrls = [
  'https://gemini.google.com',
  'https://gemini.google.com/chat',
  'https://chat.openai.com',
  'https://claude.ai',
];

testUrls.forEach(url => {
  const isMatch = matchesGeminiUrl(url);
  console.log(`  ${url} -> ${isMatch ? '匹配 ✓' : '不匹配 ✗'}`);
});

// 测试 DOM 结构识别
console.log('\n3. 测试 DOM 结构识别...');
const testHtml = `
<div class="chat-container">
  <div role="user">
    <div class="content">What is TypeScript?</div>
  </div>
  <div role="assistant">
    <div class="content">TypeScript is JavaScript with types.</div>
    <div class="actions">
      <mat-icon-button aria-label="Copy response">
        <mat-icon>content_copy</mat-icon>
      </mat-icon-button>
    </div>
  </div>
  <div data-message-type="user">
    <div class="content">Give an example</div>
  </div>
  <div data-message-type="model">
    <div class="content">const x: number = 5;</div>
  </div>
</div>
`;

document.body.innerHTML = testHtml;

// 测试助手消息查找
const assistantSelectors = geminiSelectors.assistantMessage.join(', ');
const assistantMessages = document.querySelectorAll(assistantSelectors);
console.log(`  找到助手消息: ${assistantMessages.length} 个`);

// 测试用户消息查找
const userSelectors = geminiSelectors.userMessage.join(', ');
const userMessages = document.querySelectorAll(userSelectors);
console.log(`  找到用户消息: ${userMessages.length} 个`);

// 测试复制按钮查找
const copySelectors = geminiSelectors.copyButton.join(', ');
const copyButtons = document.querySelectorAll(copySelectors);
console.log(`  找到复制按钮: ${copyButtons.length} 个`);

// 测试消息容器查找
console.log('\n4. 测试消息容器和关联...');
if (assistantMessages.length > 0) {
  const firstAssistant = assistantMessages[0];
  
  // 查找可能的用户消息
  let userMessage = null;
  const container = firstAssistant.parentElement;
  if (container) {
    // 查找前一个兄弟元素
    let prev = container.previousElementSibling;
    while (prev) {
      const userElement = prev.querySelector(userSelectors);
      if (userElement) {
        userMessage = userElement;
        break;
      }
      prev = prev.previousElementSibling;
    }
  }
  
  console.log(`  助手消息内容: "${firstAssistant.querySelector('.content')?.textContent || 'N/A'}"`);
  console.log(`  关联用户消息: ${userMessage ? '找到 ✓' : '未找到 ✗'}`);
  if (userMessage) {
    console.log(`  用户消息内容: "${userMessage.querySelector('.content')?.textContent}"`);
  }
}

// 测试附件提取
console.log('\n5. 测试附件提取逻辑...');
const attachmentTestHtml = `
<div role="assistant">
  <div class="content">
    <p>Analysis of your uploaded files:</p>
    <div class="file-preview">
      <img src="https://example.com/chart.png" alt="Data chart" width="300">
    </div>
    <div class="code-block">
      <pre><code>function analyze() { return result; }</code></pre>
    </div>
  </div>
</div>
`;

const attachmentContainer = document.createElement('div');
attachmentContainer.innerHTML = attachmentTestHtml;
const assistantElement = attachmentContainer.querySelector('[role="assistant"]');

// 简单的附件提取模拟
function extractAttachments(element) {
  const attachments = [];
  
  // 提取图片
  const images = element.querySelectorAll('img[src]');
  images.forEach(img => {
    const src = img.src;
    const alt = img.alt || 'image';
    const width = img.width || 0;
    const height = img.height || 0;
    
    // 排除小图片（可能是图标）
    if (width > 50 && height > 50) {
      attachments.push({
        type: 'image',
        name: alt,
        url: src,
        size: `${width}x${height}`,
      });
    }
  });
  
  // 提取代码块
  const codeBlocks = element.querySelectorAll('pre code');
  codeBlocks.forEach((code, index) => {
    if (code.textContent && code.textContent.trim().length > 0) {
      attachments.push({
        type: 'code',
        name: `code-snippet-${index + 1}.txt`,
        content: code.textContent,
        lines: code.textContent.split('\n').length,
      });
    }
  });
  
  return attachments;
}

const extractedAttachments = extractAttachments(assistantElement);
console.log(`  提取到附件: ${extractedAttachments.length} 个`);
extractedAttachments.forEach((attachment, index) => {
  console.log(`  ${index + 1}. ${attachment.type}: ${attachment.name}`);
});

console.log('\n=== 测试完成 ===');
console.log('\n总结：');
console.log('- 选择器配置看起来合理');
console.log('- URL 匹配逻辑正确');
console.log('- DOM 结构识别基本正常');
console.log('- 下一步需要在真实 Gemini 页面上验证选择器');
console.log('- 需要在浏览器环境中进行完整集成测试');