import { PlatformAdapter, AttachmentDraft } from '@shared/types';
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
}

// 导出单例实例
export const chatGPTAdapter = new ChatGPTAdapter();
