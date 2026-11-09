import { BaseAdapter } from './base-adapter';
import { WORKBUDDY_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * WorkBuddy 平台适配器
 * 
 * 注意：WorkBuddy 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 */
export class WorkBuddyAdapter extends BaseAdapter {
  platformId = 'workbuddy';
  platformName = 'WorkBuddy';
  selectors = WORKBUDDY_SELECTORS;

  matches(url: string): boolean {
    const domains = PLATFORM_DOMAINS[this.platformId] || [];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * 查找对应的用户消息
   * WorkBuddy 的消息结构特殊处理
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 向上查找消息容器
    let container = this.findMessageContainer(assistantMessage);
    if (!container) return null;

    // WorkBuddy 可能使用不同的消息布局
    // 尝试查找最近的用户输入
    let current = container.previousElementSibling;
    
    while (current) {
      // 检查是否是用户消息
      for (const selector of this.selectors.userMessage) {
        try {
          if (current.matches(selector)) {
            return current;
          }
          // 也检查子元素
          const userMessage = current.querySelector(selector);
          if (userMessage) {
            return userMessage;
          }
        } catch (error) {
          // 忽略无效的选择器
        }
      }
      current = current.previousElementSibling;
    }

    // 如果在前一个兄弟元素中找不到，尝试在整个会话中查找
    // 这适用于某些特殊布局
    const sessionContainer = this.findSessionContainer(container);
    if (sessionContainer) {
      const userMessages = sessionContainer.querySelectorAll(
        this.selectors.userMessage.join(', ')
      );
      if (userMessages.length > 0) {
        return userMessages[userMessages.length - 1];
      }
    }

    return null;
  }

  /**
   * 查找会话容器
   */
  private findSessionContainer(element: Element): Element | null {
    let current = element.parentElement;
    const maxAttempts = 10;
    let attempts = 0;

    while (current && attempts < maxAttempts) {
      // 检查是否是会话容器
      if (
        current.classList.contains('conversation') ||
        current.classList.contains('chat') ||
        current.getAttribute('role') === 'log'
      ) {
        return current;
      }
      current = current.parentElement;
      attempts++;
    }

    return null;
  }
}

// 导出单例实例
export const workBuddyAdapter = new WorkBuddyAdapter();
