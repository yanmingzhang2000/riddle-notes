import { chatGPTAdapter } from './adapters/chatgpt';
import { claudeAdapter } from './adapters/claude';
import { geminiAdapter } from './adapters/gemini';
import { workBuddyAdapter } from './adapters/workbuddy';
import { deepseekAdapter } from './adapters/deepseek';
import { PlatformAdapter } from '@shared/types';
import { STAR_BUTTON_STYLE, TOAST_STYLE } from '@shared/constants';
import { PLATFORM_NAMES } from './selectors';

// 平台适配器注册表
const adapters: PlatformAdapter[] = [
  chatGPTAdapter,
  claudeAdapter,
  geminiAdapter,
  workBuddyAdapter,
  deepseekAdapter,
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
    
    // 方法1：从按钮元素向上查找包含的助手消息
    let current = button.parentElement;
    const assistantMessages = currentAdapter.findAssistantMessages();
    
    while (current && !assistantMessage) {
      // 检查当前元素是否是助手消息之一
      for (const msg of assistantMessages) {
        if (msg.contains(current)) {
          assistantMessage = msg;
          break;
        }
      }
      if (assistantMessage) break;
      current = current.parentElement;
    }

    // 方法2：如果向上查找失败，尝试找到最近的助手消息
    if (!assistantMessage && assistantMessages.length > 0) {
      assistantMessage = findNearestAssistantMessage(button, assistantMessages);
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
 * 查找最近的助手消息
 */
function findNearestAssistantMessage(button: Element, assistantMessages: Element[]): Element | null {
  if (assistantMessages.length === 0) return null;
  
  const buttonRect = button.getBoundingClientRect();
  let nearestMessage = assistantMessages[0];
  let minDistance = Infinity;
  
  for (const message of assistantMessages) {
    const messageRect = message.getBoundingClientRect();
    
    // 计算垂直距离（只关心垂直方向）
    const distance = Math.abs(messageRect.top - buttonRect.top);
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestMessage = message;
    }
  }
  
  return nearestMessage;
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

    // 策略1：查找现有的按钮区域（如复制按钮附近）
    let buttonContainer = findExistingButtonContainer(message);
    
    if (!buttonContainer) {
      // 策略2：查找合适的父容器来添加按钮
      buttonContainer = findOrCreateButtonContainer(message);
    }

    if (buttonContainer) {
      // 创建并插入星标按钮
      const starButton = createStarButton();
      buttonContainer.appendChild(starButton);
    }
  });
}

/**
 * 查找现有的按钮容器
 */
function findExistingButtonContainer(message: Element): Element | null {
  // 首先查找复制按钮所在的容器
  const copyButtons = currentAdapter!.findCopyButtons();
  
  for (const copyButton of copyButtons) {
    if (message.contains(copyButton)) {
      // 找到复制按钮的父容器
      const container = copyButton.parentElement;
      if (container && container.tagName !== 'BODY') {
        return container;
      }
    }
  }

  // 查找常见的按钮容器类名
  const commonContainers = [
    '[class*="action"]',
    '[class*="button"]', 
    '[class*="toolbar"]',
    '[class*="menu"]',
    '[class*="control"]',
  ];

  for (const selector of commonContainers) {
    try {
      const containers = message.querySelectorAll(selector);
      for (const container of containers) {
        if (container.childElementCount > 0 && 
            !container.querySelector('.sidecar-star-btn')) {
          return container;
        }
      }
    } catch (error) {
      // 忽略无效的选择器
    }
  }

  return null;
}

/**
 * 查找或创建按钮容器
 */
function findOrCreateButtonContainer(message: Element): Element | null {
  // 策略1：查找消息的最后子元素
  let lastChild = message.lastElementChild;
  if (lastChild && lastChild.tagName !== 'svg' && lastChild.tagName !== 'style') {
    // 检查最后一个子元素是否适合添加按钮
    if (lastChild.tagName === 'DIV' || lastChild.tagName === 'SPAN') {
      return lastChild;
    }
  }

  // 策略2：创建新的按钮容器
  const container = document.createElement('div');
  container.className = 'sidecar-button-container';
  container.style.cssText = `
    display: flex;
    gap: 4px;
    margin-top: 8px;
    align-items: center;
    justify-content: flex-start;
  `;
  
  // 将容器添加到消息末尾
  message.appendChild(container);
  return container;
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
