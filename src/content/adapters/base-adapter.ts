import { PlatformAdapter, AttachmentDraft } from '@shared/types';
import { PlatformSelectors, PLATFORM_NAMES } from '../selectors';

/**
 * 基础平台适配器
 * 
 * 提供通用的 DOM 查询和消息提取逻辑
 * 各平台适配器可以继承此类并覆盖特定方法
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract platformId: string;
  abstract platformName: string;
  abstract selectors: PlatformSelectors;
  
  /**
   * 检查 URL 是否匹配当前平台
   */
  abstract matches(url: string): boolean;

  /**
   * 查找所有 AI 回复消息
   */
  findAssistantMessages(): Element[] {
    for (const selector of this.selectors.assistantMessage) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          return Array.from(elements);
        }
      } catch (error) {
        console.warn(`[Sidecar] Invalid selector: ${selector}`, error);
      }
    }
    return [];
  }

  /**
   * 查找对应的用户消息
   * 默认实现：向上查找消息容器，然后找前一个兄弟元素
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 向上查找消息容器
    let container = this.findMessageContainer(assistantMessage);
    if (!container) return null;

    // 找到前一个兄弟元素
    let prev = container.previousElementSibling;
    
    // 跳过非消息元素
    while (prev) {
      if (this.isUserMessageElement(prev)) {
        return prev;
      }
      prev = prev.previousElementSibling;
    }

    return null;
  }

  /**
   * 查找所有复制按钮
   */
  findCopyButtons(): Element[] {
    const buttons: Element[] = [];
    
    for (const selector of this.selectors.copyButton) {
      try {
        const elements = document.querySelectorAll(selector);
        buttons.push(...Array.from(elements));
      } catch (error) {
        console.warn(`[Sidecar] Invalid selector: ${selector}`, error);
      }
    }

    return buttons;
  }

  /**
   * 提取消息文本内容
   */
  extractMessageText(message: Element): string {
    // 克隆节点避免修改原始 DOM
    const clone = message.cloneNode(true) as Element;
    
    // 移除排除的元素
    for (const excludeSelector of this.selectors.excludeSelectors) {
      try {
        const elements = clone.querySelectorAll(excludeSelector);
        elements.forEach(el => el.remove());
      } catch (error) {
        // 忽略无效的选择器
      }
    }

    // 移除按钮和图标
    const buttons = clone.querySelectorAll('button');
    buttons.forEach(btn => btn.remove());
    
    const svgs = clone.querySelectorAll('svg');
    svgs.forEach(svg => svg.remove());

    // 获取文本内容
    return clone.textContent?.trim() || '';
  }

  /**
   * 提取附件
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments: AttachmentDraft[] = [];

    // 查找图片
    const images = message.querySelectorAll('img');
    images.forEach(img => {
      if (img.src && !this.isExcludedImage(img)) {
        attachments.push({
          name: img.alt || 'image',
          mimeType: this.guessImageMimeType(img.src),
          sourceUrl: img.src,
        });
      }
    });

    // 查找文件链接
    const links = message.querySelectorAll('a[href^="blob:"]');
    links.forEach(link => {
      attachments.push({
        name: link.textContent || 'attachment',
        mimeType: 'application/octet-stream',
        sourceUrl: link.getAttribute('href') || undefined,
      });
    });

    return attachments;
  }

  /**
   * 获取当前对话 URL
   */
  getConversationUrl(): string {
    return window.location.href;
  }

  /**
   * 查找消息容器（向上查找）
   */
  protected findMessageContainer(element: Element): Element | null {
    let current = element.parentElement;
    
    while (current) {
      for (const selector of this.selectors.messageContainer) {
        try {
          if (current.matches(selector)) {
            return current;
          }
        } catch (error) {
          // 忽略无效的选择器
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * 判断元素是否是用户消息
   */
  protected isUserMessageElement(element: Element): boolean {
    for (const selector of this.selectors.userMessage) {
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch (error) {
        // 忽略无效的选择器
      }
    }
    return false;
  }

  /**
   * 判断图片是否应该被排除（如头像）
   */
  protected isExcludedImage(img: HTMLImageElement): boolean {
    const src = img.src.toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    
    // 排除头像
    if (src.includes('avatar') || alt.includes('avatar')) {
      return true;
    }
    
    // 排除过小的图片（通常是图标）
    if (img.width < 50 && img.height < 50) {
      return true;
    }

    return false;
  }

  /**
   * 推测图片 MIME 类型
   */
  protected guessImageMimeType(src: string): string {
    const lower = src.toLowerCase();
    
    if (lower.includes('.png')) return 'image/png';
    if (lower.includes('.gif')) return 'image/gif';
    if (lower.includes('.webp')) return 'image/webp';
    
    // 默认为 JPEG
    return 'image/jpeg';
  }
}
