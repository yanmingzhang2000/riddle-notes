import { BaseAdapter } from './base-adapter';
import { CHATGPT_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * ChatGPT 平台适配器
 * 
 * 注意：ChatGPT 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 */
export class ChatGPTAdapter extends BaseAdapter {
  platformId = 'chatgpt';
  platformName = 'ChatGPT';
  selectors = CHATGPT_SELECTORS;

  matches(url: string): boolean {
    const domains = PLATFORM_DOMAINS[this.platformId] || [];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * 查找所有 AI 回复消息
   * ChatGPT 使用特定的 data 属性标记消息
   * 更新：2024年后的新版本 DOM 结构
   */
  findAssistantMessages(): Element[] {
    // 尝试多种选择器以适应不同版本
    let messages = document.querySelectorAll('[data-testid="assistant-message"]');
    
    // 如果找不到，尝试新的选择器
    if (messages.length === 0) {
      // 新版 ChatGPT 可能使用的类名
      messages = document.querySelectorAll('[class*="markdown"], [data-message-author-role="assistant"]');
    }
    
    return Array.from(messages);
  }

  /**
   * 查找对应的用户消息
   * ChatGPT 特定的实现，优化查找效率
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 对于 ChatGPT，先尝试基础实现
    const userMessage = super.findUserMessage(assistantMessage);
    if (userMessage) return userMessage;

    // ChatGPT 的新版 UI 可能使用不同的结构
    // 尝试查找最近的用户消息（基于DOM位置）
    const allUserMessages = document.querySelectorAll('[data-testid="user-message"], [data-message-author-role="user"]');
    
    if (allUserMessages.length === 0) return null;

    // 找到最近的用户消息（在助手消息之前的）
    const assistantRect = assistantMessage.getBoundingClientRect();
    let nearestUserMessage: Element | null = null;
    let minDistance = Infinity;

    for (const userMsg of allUserMessages) {
      const userRect = userMsg.getBoundingClientRect();
      
      // 用户消息应该在助手消息上方
      if (userRect.bottom > assistantRect.top) continue;
      
      const distance = Math.abs(userRect.bottom - assistantRect.top);
      if (distance < minDistance) {
        minDistance = distance;
        nearestUserMessage = userMsg;
      }
    }

    return nearestUserMessage;
  }

  /**
   * 获取对话 URL
   * ChatGPT 特定的对话 URL 提取逻辑
   */
  getConversationUrl(): string {
    const currentUrl = window.location.href;
    
    // ChatGPT 的 URL 结构通常是 chat.openai.com/c/{conversation-id}
    if (currentUrl.includes('/c/')) {
      // 提取对话 ID
      const match = currentUrl.match(/chat\.(openai\.com|chatgpt\.com)\/c\/([^/?]+)/);
      if (match) {
        return `https://chat.${match[1]}/c/${match[2]}`;
      }
    }
    
    // 对于新对话，返回当前 URL
    return currentUrl;
  }
}

// 导出单例实例
export const chatGPTAdapter = new ChatGPTAdapter();