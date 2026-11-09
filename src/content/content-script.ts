import { chatGPTAdapter } from './adapters/chatgpt';
import { claudeAdapter } from './adapters/claude';
import { geminiAdapter } from './adapters/gemini';
import { workBuddyAdapter } from './adapters/workbuddy';
import { PlatformAdapter } from '@shared/types';
import { STAR_BUTTON_STYLE, TOAST_STYLE } from '@shared/constants';
import { PLATFORM_NAMES } from './selectors';

// 平台适配器注册表
const adapters: PlatformAdapter[] = [
  chatGPTAdapter,
  claudeAdapter,
  geminiAdapter,
  workBuddyAdapter,
];

// 当前激活的适配器
let currentAdapter: PlatformAdapter | null = null;

/**
 * 初始化平台适配器
 */
function initializeAdapter(): PlatformAdapter | null {
  const url = window.location.href;
  
  for (const adapter of adapters) {
    if (adapter.matches(url)) {
      console.log(`[Sidecar] Detected platform: ${adapter.platformName}`);
      return adapter;
    }
  }
  
  return null;
}

/**
 * 创建星标按钮 SVG 图标
 */
function createStarIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z');
  
  svg.appendChild(path);
  return svg;
}

/**
 * 创建星标按钮
 */
function createStarButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'sidecar-star-btn';
  button.title = '收藏此 Prompt';
  button.appendChild(createStarIcon());
  
  button.addEventListener('click', handleStarClick);
  
  return button;
}

/**
 * 处理星标按钮点击
 */
async function handleStarClick(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  
  if (!currentAdapter) {
    showToast('平台未适配', 'error');
    return;
  }

  const button = event.currentTarget as HTMLButtonElement;
  
  try {
    // 查找对应的 AI 回复
    let assistantMessage: Element | null = null;
    let current = button.parentElement;
    
    // 向上查找 AI 回复消息
    while (current && !assistantMessage) {
      if (current.hasAttribute('data-testid') && 
          current.getAttribute('data-testid') === 'assistant-message') {
        assistantMessage = current;
        break;
      }
      current = current.parentElement;
    }

    if (!assistantMessage) {
      showToast('未找到对应的 AI 回复', 'error');
      return;
    }

    // 提取 AI 回复文本
    const outputText = currentAdapter.extractMessageText(assistantMessage);
    
    // 查找对应的用户消息
    const userMessage = currentAdapter.findUserMessage(assistantMessage);
    
    let promptText = '';
    if (userMessage) {
      promptText = currentAdapter.extractMessageText(userMessage);
    } else {
      // 如果找不到用户消息，提示用户手动输入
      promptText = await promptForUserInput();
      if (!promptText) {
        return; // 用户取消
      }
    }

    // 提取附件
    const attachments = currentAdapter.extractAttachments(assistantMessage);
    
    // 获取对话 URL
    const conversationUrl = currentAdapter.getConversationUrl();

    // 保存到后台
    await savePrompt({
      promptText,
      outputText,
      sourcePlatform: currentAdapter.platformId,
      conversationUrl,
      attachments,
    });

    // 标记为已保存
    button.classList.add('saved');
    showToast('已收藏到：未分类', 'success');
    
  } catch (error) {
    console.error('[Sidecar] Save failed:', error);
    showToast('保存失败，请重试', 'error');
  }
}

/**
 * 提示用户手动输入 Prompt
 */
function promptForUserInput(): Promise<string> {
  return new Promise((resolve) => {
    const input = window.prompt('未找到对应的 Prompt，请手动输入：');
    resolve(input || '');
  });
}

/**
 * 保存 Prompt 到后台
 */
async function savePrompt(data: {
  promptText: string;
  outputText: string;
  sourcePlatform: string;
  conversationUrl: string;
  attachments: any[];
}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'SAVE_PROMPT',
        payload: data,
      },
      (response) => {
        if (response?.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || 'Save failed'));
        }
      }
    );
  });
}

/**
 * 显示 Toast 通知
 */
function showToast(message: string, type: 'success' | 'error' | 'info') {
  // 移除已有的 toast
  const existingToast = document.querySelector('.sidecar-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'sidecar-toast';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // 3秒后自动移除
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/**
 * 注入星标按钮到页面
 */
function injectStarButtons() {
  if (!currentAdapter) return;

  // 查找所有 AI 回复
  const assistantMessages = currentAdapter.findAssistantMessages();
  
  assistantMessages.forEach(message => {
    // 检查是否已经注入过
    if (message.querySelector('.sidecar-star-btn')) {
      return;
    }

    // 查找复制按钮容器
    // ChatGPT 通常在消息底部有操作按钮区域
    let buttonContainer = message.querySelector('[class*="actions"]');
    
    if (!buttonContainer) {
      // 如果找不到，创建一个容器
      buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'display: flex; gap: 4px; margin-top: 8px;';
      message.appendChild(buttonContainer);
    }

    // 创建并插入星标按钮
    const starButton = createStarButton();
    buttonContainer.appendChild(starButton);
  });
}

/**
 * 注入样式
 */
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = STAR_BUTTON_STYLE + TOAST_STYLE;
  document.head.appendChild(style);
}

/**
 * 主入口
 */
function main() {
  console.log('[Sidecar] Content script loaded');
  
  // 初始化适配器
  currentAdapter = initializeAdapter();
  
  if (!currentAdapter) {
    console.log('[Sidecar] Platform not supported');
    return;
  }

  // 注入样式
  injectStyles();

  // 初始注入星标按钮
  injectStarButtons();

  // 监听 DOM 变化，处理动态加载的内容
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // 延迟注入，避免重复
        setTimeout(injectStarButtons, 500);
        break;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[Sidecar] Initialized successfully');
}

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
