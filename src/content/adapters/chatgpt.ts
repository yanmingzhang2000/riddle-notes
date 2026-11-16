import { BaseAdapter } from './base-adapter';
import { AttachmentDraft } from '@shared/types';
import { CHATGPT_SELECTORS, CHATGPT_TURN_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

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
   * 优先按新版"轮"结构查找，找不到再回退到旧版 data 属性 / 类名
   */
  findAssistantMessages(): Element[] {
    const turns = this.findReplyTurns();
    if (turns.length > 0) return turns;

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
    // 新版：提问和回复在同一个 turn 容器内
    if (this.isReplyTurn(assistantMessage)) {
      const bubble = assistantMessage.querySelector(CHATGPT_TURN_SELECTORS.userBubble);
      if (bubble) return bubble;
    }

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
   * 查找复制按钮
   * 新版 turn 内只保留回复下方按钮排里的复制按钮（每个 turn 最后一个），
   * 避免星标被插到代码块的复制按钮旁边
   */
  findCopyButtons(): Element[] {
    const legacyButtons: Element[] = [];
    const replyButtonByTurn = new Map<Element, Element>();

    for (const button of super.findCopyButtons()) {
      const turn = button.closest(CHATGPT_TURN_SELECTORS.turn);
      if (!turn) {
        legacyButtons.push(button);
        continue;
      }
      if (!button.matches(CHATGPT_TURN_SELECTORS.replyCopyButton) || button.closest('pre')) {
        continue;
      }
      const current = replyButtonByTurn.get(turn);
      if (!current || current.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) {
        replyButtonByTurn.set(turn, button);
      }
    }

    return [...legacyButtons, ...replyButtonByTurn.values()];
  }

  /**
   * 提取消息文本
   * 新版 turn 容器同时包含提问，需要先去掉提问气泡和"你说："这类读屏标题
   */
  extractMessageText(message: Element): string {
    if (!this.isReplyTurn(message)) {
      return super.extractMessageText(message);
    }

    const clone = message.cloneNode(true) as Element;
    clone
      .querySelectorAll(`${CHATGPT_TURN_SELECTORS.userBubble}, ${CHATGPT_TURN_SELECTORS.roleHeading}`)
      .forEach(el => el.remove());
    return super.extractMessageText(clone);
  }

  /**
   * 提取附件
   * 新版 turn 容器同时包含提问，排除用户自己上传的图片
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);
    if (!this.isReplyTurn(message)) return attachments;

    const userImageUrls = new Set(
      Array.from(message.querySelectorAll<HTMLImageElement>(`${CHATGPT_TURN_SELECTORS.userBubble} img`))
        .map(img => img.src)
    );
    return attachments.filter(item => !item.sourceUrl || !userImageUrls.has(item.sourceUrl));
  }

  /**
   * 查找所有已生成完成的回复所在的 turn 容器
   * 回复生成中没有按钮排，所以只有完成后才会出现星标
   */
  private findReplyTurns(): Element[] {
    const turns = new Set<Element>();

    document.querySelectorAll(CHATGPT_TURN_SELECTORS.replyCopyButton).forEach(button => {
      if (button.closest('pre')) return;
      const turn = button.closest(CHATGPT_TURN_SELECTORS.turn);
      if (turn) turns.add(turn);
    });

    return Array.from(turns);
  }

  private isReplyTurn(element: Element): boolean {
    return element.matches(CHATGPT_TURN_SELECTORS.turn);
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