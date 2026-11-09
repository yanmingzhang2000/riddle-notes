import { BaseAdapter } from './base-adapter';
import { GEMINI_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * Gemini 平台适配器
 * 
 * 注意：Gemini 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 */
export class GeminiAdapter extends BaseAdapter {
  platformId = 'gemini';
  platformName = 'Gemini';
  selectors = GEMINI_SELECTORS;

  matches(url: string): boolean {
    const domains = PLATFORM_DOMAINS[this.platformId] || [];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * 查找对应的用户消息
   * Gemini 的消息结构特殊处理
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 向上查找消息容器
    let container = this.findMessageContainer(assistantMessage);
    if (!container) return null;

    // Gemini 的用户查询通常在 AI 回复之前
    // 尝试查找最近的用户-query 元素
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

    return null;
  }

  /**
   * 提取附件
   * Gemini 可能包含图片和其他附件
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);

    // Gemini 特定的附件处理
    // 查找上传的文件
    const uploadedFiles = message.querySelectorAll('[data-test-id*="file"], [data-test-id*="image"]');
    uploadedFiles.forEach(file => {
      const img = file.querySelector('img');
      if (img && img.src && !this.isExcludedImage(img)) {
        attachments.push({
          name: file.getAttribute('aria-label') || img.alt || 'uploaded-file',
          mimeType: this.guessImageMimeType(img.src),
          sourceUrl: img.src,
        });
      }
    });

    return attachments;
  }
}

// 导出单例实例
export const geminiAdapter = new GeminiAdapter();
