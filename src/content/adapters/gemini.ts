import { BaseAdapter } from './base-adapter';
import { AttachmentDraft } from '@shared/types';
import { GEMINI_SELECTORS, GEMINI_TURN_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * Gemini 平台适配器
 * 
 * 注意：Gemini 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 * 
 * Gemini Web 界面特点：
 * - 使用 Material Design (mat-*) 组件
 * - 新版页面用 <user-query> / <model-response> 自定义元素按"轮"组织
 * - 回复下方的按钮排（.buttons-container-v2）只在回复生成完成后出现
 * - 支持文件上传和图片预览
 * - 可能使用虚拟列表技术
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
   * 查找所有 AI 回复消息
   * 新版页面按"回复下方的按钮排"定位回复容器，回复生成中没有按钮排，所以只有完成后才会出现星标；
   * 旧版页面（没有 <user-query> / <model-response>）回退到 role / 类名查找
   */
  findAssistantMessages(): Element[] {
    const replies = this.findReplyContainers();
    if (replies.length > 0) return replies;

    // 新版页面但还没有任何回复生成完成：不要走下面的类名猜测，否则星标会被插到页面其他位置
    if (document.querySelector(`${GEMINI_TURN_SELECTORS.userQuery}, ${GEMINI_TURN_SELECTORS.replyContainers[0]}`)) {
      return [];
    }

    const messages = super.findAssistantMessages();
    
    // 如果没有找到消息，尝试查找 Material Design 风格的消息
    if (messages.length === 0) {
      // 查找带有特定数据属性的消息
      const roleMessages = document.querySelectorAll('[role="assistant"], [data-message-type="model"]');
      if (roleMessages.length > 0) {
        return Array.from(roleMessages);
      }
      
      // 查找包含文本的模型响应容器
      const textContainers = document.querySelectorAll('[class*="model"], [class*="response"]');
      const modelResponses: Element[] = [];
      
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
            modelResponses.push(container);
          }
        }
      });
      
      return modelResponses;
    }
    
    return messages;
  }

  /**
   * 查找对应的用户消息
   * Gemini 特定的消息查找优化
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 新版：同一轮里 <user-query> 就在 <model-response> 前面
    if (this.isReplyContainer(assistantMessage)) {
      const query = this.findPrecedingUserQuery(assistantMessage);
      if (query) return query;
    }

    // 方法1：使用基础适配器的实现
    const userMessage = super.findUserMessage(assistantMessage);
    if (userMessage) return userMessage;

    // 方法2：基于 role 属性查找
    const assistantRole = assistantMessage.getAttribute('role');
    const assistantType = assistantMessage.getAttribute('data-message-type');
    
    if (assistantRole === 'assistant' || assistantType === 'model') {
      // 查找前一个具有用户角色的元素
      const allMessages = document.querySelectorAll('[role], [data-message-type]');
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
          const elementRole = element.getAttribute('role');
          const elementType = element.getAttribute('data-message-type');
          
          if (elementRole === 'user' || elementType === 'user') {
            return element;
          }
        }
      }
    }

    // 方法3：基于位置查找（相对布局）
    const assistantRect = assistantMessage.getBoundingClientRect();
    const allUserCandidates = document.querySelectorAll(this.selectors.userMessage.join(', '));
    
    let nearestUserMessage: Element | null = null;
    let minDistance = Infinity;

    for (const userCandidate of allUserCandidates) {
      const userRect = userCandidate.getBoundingClientRect();
      
      // 用户消息应该在助手消息上方
      if (userRect.bottom > assistantRect.top) continue;
      
      const distance = Math.abs(userRect.bottom - assistantRect.top);
      if (distance < minDistance) {
        minDistance = distance;
        nearestUserMessage = userCandidate;
      }
    }

    return nearestUserMessage;
  }

  /**
   * 星标按钮的放置位置：回复下方的按钮排（点赞 / 点踩 / 复制 / 更多 所在的那一行）
   * 非新版回复容器返回 null，由 content script 按通用规则推断
   */
  findButtonContainer(message: Element): Element | null {
    if (!this.isReplyContainer(message)) return null;
    return (
      message.querySelector(GEMINI_TURN_SELECTORS.actionRow) ||
      message.querySelector(GEMINI_TURN_SELECTORS.actionRowHost)
    );
  }

  /**
   * 提取消息文本
   * - 提问：只取 p.query-text-line，避免带上读屏用的"你说"标题
   * - 回复：只取正文容器，去掉按钮排、思路摘要等
   */
  extractMessageText(message: Element): string {
    if (message.matches(GEMINI_TURN_SELECTORS.userQuery)) {
      const lines = Array.from(message.querySelectorAll(GEMINI_TURN_SELECTORS.userQueryLine))
        .map(line => line.textContent?.trim() || '')
        .filter(Boolean);
      if (lines.length > 0) return lines.join('\n');
      return this.extractTextWithout(message, GEMINI_TURN_SELECTORS.visuallyHidden);
    }

    if (this.isReplyContainer(message)) {
      const content = message.querySelector(GEMINI_TURN_SELECTORS.replyContent);
      if (content) {
        return this.extractTextWithout(content, GEMINI_TURN_SELECTORS.visuallyHidden);
      }
      return this.extractTextWithout(
        message,
        [
          GEMINI_TURN_SELECTORS.actionRow,
          GEMINI_TURN_SELECTORS.actionRowHost,
          GEMINI_TURN_SELECTORS.visuallyHidden,
        ].join(', ')
      );
    }

    return super.extractMessageText(message);
  }

  /**
   * 通过回复下方的按钮排反查所有已生成完成的回复容器
   */
  private findReplyContainers(): Element[] {
    const replies = new Set<Element>();
    const rows = document.querySelectorAll(
      `${GEMINI_TURN_SELECTORS.actionRow}, ${GEMINI_TURN_SELECTORS.actionRowHost}`
    );

    rows.forEach(row => {
      for (const selector of GEMINI_TURN_SELECTORS.replyContainers) {
        const reply = row.closest(selector);
        if (reply) {
          replies.add(reply);
          break;
        }
      }
    });

    return Array.from(replies);
  }

  private isReplyContainer(element: Element): boolean {
    return GEMINI_TURN_SELECTORS.replyContainers.some(selector => element.matches(selector));
  }

  /**
   * 从回复容器往前找同一轮的 <user-query>
   * 逐层检查前面的兄弟元素（由近到远），到达一轮对话的容器就停止，避免取到上一轮的提问
   */
  private findPrecedingUserQuery(reply: Element): Element | null {
    let current: Element | null = reply;

    while (current && current !== document.body && !current.matches(GEMINI_TURN_SELECTORS.turn)) {
      let prev: Element | null = current.previousElementSibling;
      while (prev) {
        if (prev.matches(GEMINI_TURN_SELECTORS.userQuery)) return prev;
        const nested = prev.querySelectorAll(GEMINI_TURN_SELECTORS.userQuery);
        if (nested.length > 0) return nested[nested.length - 1];
        prev = prev.previousElementSibling;
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * 克隆元素并移除指定节点后再提取文本，避免修改页面 DOM
   */
  private extractTextWithout(element: Element, removeSelector: string): string {
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll(removeSelector).forEach(el => el.remove());
    return super.extractMessageText(clone);
  }

  /**
   * 提取附件
   * Gemini 支持多种附件类型
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);

    // Gemini 特定的附件处理
    // 1. 查找上传的文件（Material Design 风格）
    const uploadedFiles = message.querySelectorAll(
      '[data-test-id*="file"], [data-test-id*="image"], [class*="attachment"], [class*="uploaded"]'
    );
    
    uploadedFiles.forEach(file => {
      // 查找图片
      const img = file.querySelector('img');
      if (img && img.src && !this.isExcludedImage(img)) {
        attachments.push({
          name: file.getAttribute('aria-label') || 
                file.getAttribute('data-filename') || 
                img.alt || 
                'attachment',
          mimeType: this.guessImageMimeType(img.src),
          sourceUrl: img.src,
        });
      }
      
      // 查找文件链接
      const link = file.querySelector('a[href]');
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
      
      // 查找预览容器
      const previewContainer = file.querySelector('[class*="preview"], [class*="thumbnail"]');
      if (previewContainer) {
        const previewImg = previewContainer.querySelector('img');
        if (previewImg && previewImg.src && !this.isExcludedImage(previewImg)) {
          attachments.push({
            name: file.getAttribute('aria-label') || previewImg.alt || 'preview',
            mimeType: this.guessImageMimeType(previewImg.src),
            sourceUrl: previewImg.src,
          });
        }
      }
    });

    // 2. 查找代码块附件
    const codeBlocks = message.querySelectorAll('pre code, [class*="code-block"], [class*="syntax-highlight"]');
    codeBlocks.forEach((codeBlock, index) => {
      const codeText = codeBlock.textContent || '';
      if (codeText.trim().length > 0) {
        // 创建代码块的文本表示
        const codeBlob = new Blob([codeText], { type: 'text/plain' });
        const codeBlobUrl = URL.createObjectURL(codeBlob);
        
        attachments.push({
          name: `code-snippet-${index + 1}.txt`,
          mimeType: 'text/plain',
          sourceUrl: codeBlobUrl,
          localBlob: codeBlob,
        });
      }
    });

    return attachments;
  }

  /**
   * 查找复制按钮
   * Gemini 可能使用 Material Design 按钮
   */
  findCopyButtons(): Element[] {
    const buttons = super.findCopyButtons();
    
    // 如果没有找到按钮，尝试查找 Material Design 图标按钮
    if (buttons.length === 0) {
      const matButtons = document.querySelectorAll('mat-icon-button, mat-button, button[mat-icon-button]');
      matButtons.forEach(button => {
        const ariaLabel = button.getAttribute('aria-label') || '';
        const title = button.getAttribute('title') || '';
        const classList = button.className || '';
        
        if (ariaLabel.toLowerCase().includes('copy') || 
            title.toLowerCase().includes('copy') || 
            title.toLowerCase().includes('复制') ||
            classList.toLowerCase().includes('copy')) {
          buttons.push(button);
        }
      });
    }
    
    return buttons;
  }

  /**
   * 推测文件 MIME 类型
   */
  protected guessFileMimeType(url: string, filename: string): string {
    const lowerUrl = url.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    
    // 基于文件扩展名猜测
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
export const geminiAdapter = new GeminiAdapter();