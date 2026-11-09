import { BaseAdapter } from './base-adapter';
import { CLAUDE_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * Claude 平台适配器
 * 
 * 注意：Claude 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 */
export class ClaudeAdapter extends BaseAdapter {
  platformId = 'claude';
  platformName = 'Claude';
  selectors = CLAUDE_SELECTORS;

  matches(url: string): boolean {
    const domains = PLATFORM_DOMAINS[this.platformId] || [];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * 查找对应的用户消息
   * Claude 的 DOM 结构特殊处理
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 向上查找消息容器
    let container = this.findMessageContainer(assistantMessage);
    if (!container) return null;

    // Claude 的消息可能在不同的容器中
    // 尝试向上查找更大的容器
    let parent = container.parentElement;
    let attempts = 0;
    const maxAttempts = 5;

    while (parent && attempts < maxAttempts) {
      // 在父容器中查找用户消息
      const userMessages = parent.querySelectorAll(
        this.selectors.userMessage.join(', ')
      );
      
      // 找到最后一个用户消息（最近的）
      if (userMessages.length > 0) {
        return userMessages[userMessages.length - 1];
      }

      parent = parent.parentElement;
      attempts++;
    }

    return null;
  }
}

// 导出单例实例
export const claudeAdapter = new ClaudeAdapter();
