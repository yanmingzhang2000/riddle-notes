import { BaseAdapter } from './base-adapter';
import { WORKBUDDY_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * WorkBuddy 平台适配器
 * 
 * 注意：WorkBuddy 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 * 
 * WorkBuddy Web 界面特点：
 * - 腾讯生态风格，可能有中英文混合
 * - 支持文件上传和代码编辑
 * - 可能是基于 Electron 的桌面应用
 * - 可能有特殊的消息布局和容器结构
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
   * 查找所有 AI 回复消息
   * WorkBuddy 特定的实现，优化腾讯生态的查找
   */
  findAssistantMessages(): Element[] {
    const messages = super.findAssistantMessages();
    
    // 如果没有找到消息，尝试查找腾讯生态特有的选择器
    if (messages.length === 0) {
      // 查找带有腾讯生态数据属性的消息
      const tencentMessages = document.querySelectorAll('[data-role="assistant"], [data-type="ai"]');
      if (tencentMessages.length > 0) {
        return Array.from(tencentMessages);
      }
      
      // 查找包含 AI 响应文本的容器
      const textContainers = document.querySelectorAll('[class*="ai"], [class*="assistant"], [class*="response"]');
      const aiResponses: Element[] = [];
      
      textContainers.forEach(container => {
        // 检查容器是否包含文本内容
        if (container.textContent && container.textContent.trim().length > 0) {
          // 检查是否不是用户消息
          const isUserMessage = this.selectors.userMessage.some(selector => {
            try {
              return container.matches(selector);
            } catch {
              return false;
            }
          });
          
          if (!isUserMessage) {
            aiResponses.push(container);
          }
        }
      });
      
      return aiResponses;
    }
    
    return messages;
  }

  /**
   * 查找对应的用户消息
   * WorkBuddy 特定的消息查找优化
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 方法1：使用基础适配器的实现
    const userMessage = super.findUserMessage(assistantMessage);
    if (userMessage) return userMessage;

    // 方法2：基于腾讯生态的数据属性查找
    const assistantRole = assistantMessage.getAttribute('data-role');
    const assistantType = assistantMessage.getAttribute('data-type');
    
    if (assistantRole === 'assistant' || assistantType === 'ai') {
      // 查找前一个具有用户数据属性的元素
      const allMessages = document.querySelectorAll('[data-role], [data-type]');
      let assistantIndex = -1;
      
      for (let i = 0; i < allMessages.length; i++) {
        if (allMessages[i] === assistantMessage) {
          assistantIndex = i;
          break;
        }
      }
      
      if (assistantIndex > 0) {
        // 向前查找用户消息
        for (let i = assistantIndex - 1; i >= 0; i--) {
          const element = allMessages[i];
          const elementRole = element.getAttribute('data-role');
          const elementType = element.getAttribute('data-type');
          
          if (elementRole === 'user' || elementType === 'user') {
            return element;
          }
        }
      }
    }

    // 方法3：基于会话容器的查找
    const sessionContainer = this.findSessionContainer(assistantMessage);
    if (sessionContainer) {
      // 在会话容器中查找所有用户消息
      const userMessages = sessionContainer.querySelectorAll(
        this.selectors.userMessage.join(', ')
      );
      
      if (userMessages.length > 0) {
        // 找到最近的用户消息（按 DOM 位置）
        const assistantRect = assistantMessage.getBoundingClientRect();
        let nearestUserMessage: Element | null = null;
        let minDistance = Infinity;

        for (const userMsg of userMessages) {
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
    }

    return null;
  }

  /**
   * 提取附件
   * WorkBuddy 可能支持腾讯生态的附件类型
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);

    // WorkBuddy 特定的附件处理
    // 1. 查找腾讯生态的文件上传组件
    const tencentUploads = message.querySelectorAll(
      '[class*="upload"], [class*="file-"], [class*="附件"], [class*="文件"]'
    );
    
    tencentUploads.forEach(upload => {
      // 查找图片预览
      const img = upload.querySelector('img');
      if (img && img.src && !this.isExcludedImage(img)) {
        attachments.push({
          name: upload.getAttribute('data-filename') || 
                upload.getAttribute('aria-label') || 
                img.alt || 
                'uploaded-file',
          mimeType: this.guessImageMimeType(img.src),
          sourceUrl: img.src,
        });
      }
      
      // 查找文件链接
      const link = upload.querySelector('a[href]');
      if (link) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('javascript:')) {
          attachments.push({
            name: link.textContent || link.getAttribute('aria-label') || 'file',
            mimeType: this.guessFileMimeType(href, link.textContent || ''),
            sourceUrl: href,
          });
        }
      }
      
      // 查找腾讯生态的文件预览
      const preview = upload.querySelector('[class*="preview"], [class*="预览"]');
      if (preview) {
        const previewImg = preview.querySelector('img');
        if (previewImg && previewImg.src && !this.isExcludedImage(previewImg)) {
          attachments.push({
            name: upload.getAttribute('data-filename') || previewImg.alt || 'preview',
            mimeType: this.guessImageMimeType(previewImg.src),
            sourceUrl: previewImg.src,
          });
        }
      }
    });

    // 2. 查找代码块和代码编辑器内容
    const codeElements = message.querySelectorAll(
      'pre code, [class*="code-"], [class*="editor-"], [class*="代码"]'
    );
    codeElements.forEach((codeElement, index) => {
      const codeText = codeElement.textContent || '';
      if (codeText.trim().length > 0) {
        // 创建代码块的文本表示
        const codeBlob = new Blob([codeText], { type: 'text/plain' });
        const codeBlobUrl = URL.createObjectURL(codeBlob);
        
        attachments.push({
          name: `code-${index + 1}.txt`,
          mimeType: 'text/plain',
          sourceUrl: codeBlobUrl,
          localBlob: codeBlob,
        });
      }
    });

    // 3. 查找腾讯文档或表格
    const tencentDocs = message.querySelectorAll(
      '[class*="doc-"], [class*="sheet-"], [class*="表格"], [class*="文档"]'
    );
    tencentDocs.forEach(doc => {
      const title = doc.getAttribute('data-title') || 
                    doc.getAttribute('aria-label') || 
                    'document';
      const thumbnail = doc.querySelector('img');
      
      if (thumbnail && thumbnail.src && !this.isExcludedImage(thumbnail)) {
        attachments.push({
          name: title,
          mimeType: this.guessImageMimeType(thumbnail.src),
          sourceUrl: thumbnail.src,
        });
      }
    });

    return attachments;
  }

  /**
   * 查找复制按钮
   * WorkBuddy 可能使用腾讯生态的按钮样式
   */
  findCopyButtons(): Element[] {
    const buttons = super.findCopyButtons();
    
    // 如果没有找到按钮，尝试查找腾讯生态的按钮
    if (buttons.length === 0) {
      // 查找带有中英文复制标签的按钮
      const tencentButtons = document.querySelectorAll(
        'button, [role="button"], [class*="btn"], [class*="button"]'
      );
      
      tencentButtons.forEach(button => {
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        const title = (button.getAttribute('title') || '').toLowerCase();
        const classList = (button.className || '').toLowerCase();
        const textContent = (button.textContent || '').toLowerCase();
        
        // 检查是否是复制按钮（中英文支持）
        const isCopyButton = 
          ariaLabel.includes('copy') || ariaLabel.includes('复制') || ariaLabel.includes('拷贝') ||
          title.includes('copy') || title.includes('复制') || title.includes('拷贝') ||
          classList.includes('copy') || classList.includes('复制') || classList.includes('拷贝') ||
          textContent.includes('copy') || textContent.includes('复制') || textContent.includes('拷贝');
        
        if (isCopyButton) {
          buttons.push(button);
        }
      });
    }
    
    return buttons;
  }

  /**
   * 查找会话容器
   * 优化腾讯生态的容器查找
   */
  private findSessionContainer(element: Element): Element | null {
    let current = element.parentElement;
    const maxAttempts = 10;
    let attempts = 0;

    while (current && attempts < maxAttempts) {
      // 检查是否是腾讯生态的会话容器
      const classList = current.className || '';
      const isTencentContainer = 
        classList.includes('conversation') ||
        classList.includes('chat') ||
        classList.includes('会话') ||
        classList.includes('对话') ||
        classList.includes('消息列表') ||
        current.getAttribute('role') === 'log' ||
        current.getAttribute('data-type') === 'chat';
      
      if (isTencentContainer) {
        return current;
      }
      
      // 检查是否是腾讯生态的特定容器
      const isWorkBuddyContainer = 
        classList.includes('workbuddy') ||
        classList.includes('tencent') ||
        classList.includes('qq') ||
        classList.includes('wecom');
      
      if (isWorkBuddyContainer) {
        // 在腾讯容器中查找会话区域
        const conversationArea = current.querySelector(
          '[class*="conversation"], [class*="chat"], [class*="message-list"]'
        );
        if (conversationArea) {
          return conversationArea;
        }
        return current;
      }
      
      current = current.parentElement;
      attempts++;
    }

    return null;
  }

  /**
   * 推测文件 MIME 类型
   * 支持腾讯生态的文件类型
   */
  protected guessFileMimeType(url: string, filename: string): string {
    const lowerUrl = url.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    
    // 腾讯生态常见的文件类型
    if (lowerUrl.includes('.txd') || lowerFilename.includes('.txd')) {
      return 'application/x-tencent-document';
    }
    if (lowerUrl.includes('.tcd') || lowerFilename.includes('.tcd')) {
      return 'application/x-tencent-cloud-doc';
    }
    if (lowerUrl.includes('.qdoc') || lowerFilename.includes('.qdoc')) {
      return 'application/x-qq-document';
    }
    
    // 标准文件类型
    if (lowerUrl.includes('.pdf') || lowerFilename.includes('.pdf')) {
      return 'application/pdf';
    }
    if (lowerUrl.includes('.doc') || lowerFilename.includes('.doc')) {
      return 'application/msword';
    }
    if (lowerUrl.includes('.xls') || lowerFilename.includes('.xls')) {
      return 'application/vnd.ms-excel';
    }
    if (lowerUrl.includes('.ppt') || lowerFilename.includes('.ppt')) {
      return 'application/vnd.ms-powerpoint';
    }
    if (lowerUrl.includes('.txt') || lowerFilename.includes('.txt')) {
      return 'text/plain';
    }
    if (lowerUrl.includes('.json') || lowerFilename.includes('.json')) {
      return 'application/json';
    }
    if (lowerUrl.includes('.csv') || lowerFilename.includes('.csv')) {
      return 'text/csv';
    }
    
    // 默认
    return 'application/octet-stream';
  }
}

// 导出单例实例
export const workBuddyAdapter = new WorkBuddyAdapter();
