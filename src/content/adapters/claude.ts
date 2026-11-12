import { BaseAdapter } from './base-adapter';
import { CLAUDE_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * Claude 平台适配器
 * 
 * 注意：Claude 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 * 
 * Claude Web 界面特点：
 * - Anthropic 风格，简洁现代界面
 * - 使用虚拟滚动技术处理长对话
 * - 可能使用特定的字体类名
 * - 支持文件上传和代码显示
 * - 基于 Claude Clone 项目和社区信息
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
   * 查找所有 AI 回复消息
   * Claude 特定的实现，优化虚拟滚动环境的查找
   */
  findAssistantMessages(): Element[] {
    const messages = super.findAssistantMessages();
    
    // 如果没有找到消息，尝试查找 Claude 特有的选择器
    if (messages.length === 0) {
      // 查找带有数据测试ID的消息
      const testIdMessages = document.querySelectorAll('[data-testid*="message"], [data-testid*="assistant"]');
      if (testIdMessages.length > 0) {
        const assistantMessages: Element[] = [];
        testIdMessages.forEach(message => {
          const testId = message.getAttribute('data-testid') || '';
          if (testId.includes('assistant') || !testId.includes('user')) {
            assistantMessages.push(message);
          }
        });
        if (assistantMessages.length > 0) {
          return assistantMessages;
        }
      }
      
      // 查找包含 Claude 风格类名的元素
      const claudeElements = document.querySelectorAll('[class*="claude"], [class*="assistant"], .prose');
      const claudeResponses: Element[] = [];
      
      claudeElements.forEach(element => {
        // 检查元素是否包含文本内容
        if (element.textContent && element.textContent.trim().length > 0) {
          // 检查是否不是用户消息
          const isUserMessage = this.selectors.userMessage.some(selector => {
            try {
              return element.matches(selector);
            } catch {
              return false;
            }
          });
          
          // 检查是否不是 Anthropic 品牌元素
          const isBrandElement = element.closest('[class*="anthropic"], [class*="brand"]');
          
          if (!isUserMessage && !isBrandElement) {
            claudeResponses.push(element);
          }
        }
      });
      
      return claudeResponses;
    }
    
    return messages;
  }

  /**
   * 查找对应的用户消息
   * Claude 特定的消息查找优化，处理虚拟滚动
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 方法1：使用基础适配器的实现
    const userMessage = super.findUserMessage(assistantMessage);
    if (userMessage) return userMessage;

    // 方法2：基于数据测试ID查找
    const assistantTestId = assistantMessage.getAttribute('data-testid');
    
    if (assistantTestId && assistantTestId.includes('assistant')) {
      // 查找前一个具有用户数据测试ID的元素
      const allMessages = document.querySelectorAll('[data-testid]');
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
          const elementTestId = element.getAttribute('data-testid') || '';
          
          if (elementTestId.includes('user')) {
            return element;
          }
        }
      }
    }

    // 方法3：基于虚拟滚动容器的查找
    const scrollContainer = this.findScrollContainer(assistantMessage);
    if (scrollContainer) {
      // 在滚动容器中查找所有用户消息
      const userMessages = scrollContainer.querySelectorAll(
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

    // 方法4：基于字体类名查找
    if (assistantMessage.classList.contains('font-claude-message')) {
      // 查找前一个具有用户字体类名的元素
      const allFontElements = document.querySelectorAll('.font-claude-message, .font-user-message');
      let assistantIndex = -1;
      
      for (let i = 0; i < allFontElements.length; i++) {
        if (allFontElements[i] === assistantMessage) {
          assistantIndex = i;
          break;
        }
      }
      
      if (assistantIndex > 0) {
        const prevElement = allFontElements[assistantIndex - 1];
        if (prevElement.classList.contains('font-user-message')) {
          return prevElement;
        }
      }
    }

    return null;
  }

  /**
   * 提取附件
   * Claude 支持文件上传和代码显示
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);

    // Claude 特定的附件处理
    // 1. 查找文件上传区域（Claude 版本）
    const uploadAreas = message.querySelectorAll(
      '[class*="upload"], [class*="file-"], [class*="attachment"], ' +
      '[data-attachment], [data-file], [class*="document"], [class*="media"]'
    );
    
    uploadAreas.forEach(area => {
      // 查找图片预览
      const img = area.querySelector('img');
      if (img && img.src && !this.isExcludedImage(img)) {
        // Claude 可能使用特定的文件名属性
        const filename = 
          area.getAttribute('data-filename') ||
          area.getAttribute('data-name') ||
          area.getAttribute('aria-label') ||
          img.getAttribute('data-filename') ||
          img.alt ||
          'claude-attachment';
        
        attachments.push({
          name: this.sanitizeFilename(filename),
          mimeType: this.guessImageMimeType(img.src),
          sourceUrl: img.src,
        });
      }
      
      // 查找文件链接和预览
      const link = area.querySelector('a[href]');
      if (link) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('javascript:')) {
          const linkText = link.textContent || link.getAttribute('aria-label') || 'file';
          const linkFilename = link.getAttribute('data-filename') || linkText;
          
          attachments.push({
            name: this.sanitizeFilename(linkFilename),
            mimeType: this.guessFileMimeType(href, linkFilename),
            sourceUrl: href,
          });
        }
      }
      
      // 查找文件信息容器（Claude 可能显示文件名和大小）
      const fileInfo = area.querySelector('[class*="filename"], [class*="name"], [data-filename]');
      if (fileInfo) {
        const fileSrc = area.querySelector('img')?.src || 
                       area.querySelector('a')?.getAttribute('href');
        const fileName = fileInfo.textContent || fileInfo.getAttribute('data-filename');
        
        if (fileSrc && fileName) {
          attachments.push({
            name: this.sanitizeFilename(fileName),
            mimeType: this.guessFileMimeType(fileSrc, fileName),
            sourceUrl: fileSrc,
          });
        }
      }
    });

    // 2. 查找代码块（Claude 可能有特定的代码显示样式）
    const codeBlocks = message.querySelectorAll(
      'pre code, [class*="code-"], [class*="snippet"], [class*="block"]:has(code), ' +
      '[class*="programming"], [class*="language-"], [data-code]'
    );
    
    codeBlocks.forEach((codeBlock, index) => {
      const codeText = codeBlock.textContent || '';
      const trimmedText = codeText.trim();
      
      if (trimmedText.length > 0) {
        // 推断代码语言
        const language = this.guessCodeLanguage(codeBlock);
        const extension = this.getFileExtensionForLanguage(language);
        
        // 提取代码块标题（如果有）
        const codeTitle = 
          codeBlock.closest('pre')?.getAttribute('data-title') ||
          codeBlock.closest('[class*="code"]')?.getAttribute('data-title') ||
          codeBlock.getAttribute('data-title') ||
          codeBlock.parentElement?.querySelector('[class*="title"], [class*="caption"]')?.textContent;
        
        const fileName = codeTitle 
          ? `${this.sanitizeFilename(codeTitle)}.${extension}`
          : `claude-code-${index + 1}.${extension}`;
        
        // 创建代码块的文本表示
        const codeBlob = new Blob([trimmedText], { type: 'text/plain' });
        const codeBlobUrl = URL.createObjectURL(codeBlob);
        
        attachments.push({
          name: fileName,
          mimeType: 'text/plain',
          sourceUrl: codeBlobUrl,
          localBlob: codeBlob,
        });
      }
    });

    // 3. 查找 Claude 特定的内容块
    const claudeBlocks = message.querySelectorAll(
      '[class*="claude-"], [class*="anthropic-"], [class*="content-block"], ' +
      '[data-content-block], [class*="response-"], [class*="answer-"]'
    );
    
    claudeBlocks.forEach((block, index) => {
      // 检查是否是数据或代码内容
      const textContent = block.textContent || '';
      const hasCode = block.querySelector('code, pre');
      const hasTable = block.querySelector('table');
      const hasList = block.querySelector('ul, ol');
      const hasMath = block.querySelector('[class*="math"], [class*="equation"]');
      
      // 如果内容足够丰富，保存为附件
      const hasRichContent = hasCode || hasTable || hasList || hasMath;
      
      if (textContent.trim().length > 100 && hasRichContent) {
        // 尝试提取块标题
        const blockTitle = 
          block.getAttribute('data-title') ||
          block.querySelector('[class*="title"], [class*="heading"]')?.textContent ||
          `claude-content-${index + 1}`;
        
        // 创建内容块的文本表示
        const blockBlob = new Blob([textContent], { type: 'text/plain' });
        const blockBlobUrl = URL.createObjectURL(blockBlob);
        
        attachments.push({
          name: `${this.sanitizeFilename(blockTitle)}.txt`,
          mimeType: 'text/plain',
          sourceUrl: blockBlobUrl,
          localBlob: blockBlob,
        });
      }
    });

    // 4. 查找 Claude 的结构化输出（如 JSON、YAML、XML 等）
    const structuredElements = message.querySelectorAll(
      '[data-json], [data-yaml], [data-xml], ' +
      '[class*="json"], [class*="yaml"], [class*="xml"], ' +
      '[data-structured]'
    );
    
    structuredElements.forEach((element, index) => {
      const content = element.textContent || '';
      if (content.trim().length > 10) {
        const type = element.getAttribute('data-json') ? 'json' :
                    element.getAttribute('data-yaml') ? 'yaml' :
                    element.getAttribute('data-xml') ? 'xml' :
                    element.className.match(/json/) ? 'json' :
                    element.className.match(/yaml/) ? 'yaml' :
                    element.className.match(/xml/) ? 'xml' : 'txt';
        
        const extension = type === 'yaml' ? 'yml' : type;
        const elementTitle = element.getAttribute('data-title') || `claude-${type}-${index + 1}`;
        
        const contentBlob = new Blob([content], { type: 'text/plain' });
        const contentBlobUrl = URL.createObjectURL(contentBlob);
        
        attachments.push({
          name: `${this.sanitizeFilename(elementTitle)}.${extension}`,
          mimeType: 'text/plain',
          sourceUrl: contentBlobUrl,
          localBlob: contentBlob,
        });
      }
    });

    return attachments;
  }

  /**
   * 查找复制按钮
   * Claude 可能使用特定的按钮样式
   */
  findCopyButtons(): Element[] {
    const buttons = super.findCopyButtons();
    
    // 如果没有找到按钮，尝试查找 Claude 特定的按钮
    if (buttons.length === 0) {
      // 查找所有按钮并检查文本/标签
      const allButtons = document.querySelectorAll('button, [role="button"], [class*="icon"]');
      
      allButtons.forEach(button => {
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        const title = (button.getAttribute('title') || '').toLowerCase();
        const classList = (button.className || '').toLowerCase();
        const textContent = (button.textContent || '').toLowerCase();
        
        // 检查是否是复制按钮
        const isCopyButton = 
          ariaLabel.includes('copy') || ariaLabel.includes('复制') ||
          title.includes('copy') || title.includes('复制') ||
          classList.includes('copy') || classList.includes('拷贝') ||
          textContent.includes('copy') || textContent.includes('复制') ||
          ariaLabel.includes('copy message') || ariaLabel.includes('copy code') ||
          // Claude 特定的类名
          classList.includes('copy-action') || classList.includes('copy-button') ||
          // 按钮图标（通常用于复制）
          classList.includes('clipboard') || classList.includes('copy-icon');
        
        // 排除一些常见非复制按钮
        const isNonCopyButton = 
          ariaLabel.includes('regenerate') || ariaLabel.includes('重新生成') ||
          ariaLabel.includes('thumbs') || ariaLabel.includes('thumb') ||
          ariaLabel.includes('rate') || ariaLabel.includes('评分') ||
          textContent.includes('regenerate') || textContent.includes('重新生成') ||
          textContent.includes('like') || textContent.includes('喜欢') ||
          textContent.includes('rate') || textContent.includes('评分') ||
          // 排除刷新和新对话按钮
          ariaLabel.includes('new chat') || ariaLabel.includes('new conversation') ||
          ariaLabel.includes('refresh') || ariaLabel.includes('刷新') ||
          // 排除 Anthropic 特定非复制操作
          ariaLabel.includes('anthropic') || ariaLabel.includes('claude support');
        
        if (isCopyButton && !isNonCopyButton) {
          buttons.push(button);
        }
      });
    }
    
    // Claude 可能将复制按钮隐藏在工具提示或悬停菜单中
    if (buttons.length === 0) {
      // 查找可能包含复制操作的图标容器
      const iconContainers = document.querySelectorAll(
        '[class*="icon-"], [class*="action-"], [class*="menu-"], [class*="tooltip"]'
      );
      
      iconContainers.forEach(container => {
        const containerClass = container.className.toLowerCase();
        const containerAriaLabel = (container.getAttribute('aria-label') || '').toLowerCase();
        const containerTitle = (container.getAttribute('title') || '').toLowerCase();
        
        // 检查容器是否是复制相关操作
        const isCopyContainer = 
          containerClass.includes('copy') || containerClass.includes('clipboard') ||
          containerClass.includes('duplicate') || containerAriaLabel.includes('copy') ||
          containerTitle.includes('copy');
        
        if (isCopyContainer) {
          // 在容器内查找按钮
          const containerButtons = container.querySelectorAll('button, [role="button"]');
          containerButtons.forEach(btn => buttons.push(btn));
        }
      });
    }
    
    return buttons;
  }

  /**
   * 查找滚动容器
   * Claude 使用虚拟滚动技术
   */
  private findScrollContainer(element: Element): Element | null {
    let current = element.parentElement;
    const maxAttempts = 10;
    let attempts = 0;

    while (current && attempts < maxAttempts) {
      // 检查是否是滚动容器
      const classList = current.className || '';
      const style = window.getComputedStyle(current);
      const isScrollContainer = 
        classList.includes('scroll') ||
        classList.includes('virtual') ||
        style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        current.getAttribute('role') === 'log' ||
        current.hasAttribute('data-virtual-scroll');
      
      if (isScrollContainer) {
        return current;
      }
      
      current = current.parentElement;
      attempts++;
    }

    return null;
  }

  /**
   * 推测代码语言
   */
  private guessCodeLanguage(codeElement: Element): string {
    const classList = codeElement.className || '';
    
    // 检查语言类名
    if (classList.includes('language-')) {
      const match = classList.match(/language-(\w+)/);
      if (match) return match[1];
    }
    
    // Claude 可能使用特定的类名
    const claudeLanguages = [
      { pattern: /claude-python|py-claude/, language: 'python' },
      { pattern: /claude-js|js-claude/, language: 'javascript' },
      { pattern: /claude-ts|ts-claude/, language: 'typescript' },
      { pattern: /claude-java/, language: 'java' },
      { pattern: /claude-sql/, language: 'sql' },
    ];
    
    for (const lang of claudeLanguages) {
      if (lang.pattern.test(classList.toLowerCase())) {
        return lang.language;
      }
    }
    
    // 通过内容推断
    const content = codeElement.textContent || '';
    if (content.includes('def ') && content.includes('import ')) return 'python';
    if (content.includes('function(') || content.includes('const ') || content.includes('let ')) return 'javascript';
    if (content.includes('public class')) return 'java';
    if (content.includes('SELECT ') && content.includes('FROM ')) return 'sql';
    
    return 'txt';
  }

  /**
   * 获取语言对应的文件扩展名
   */
  private getFileExtensionForLanguage(language: string): string {
    const extensions: Record<string, string> = {
      'python': 'py',
      'javascript': 'js',
      'typescript': 'ts',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'csharp': 'cs',
      'go': 'go',
      'rust': 'rs',
      'ruby': 'rb',
      'php': 'php',
      'sql': 'sql',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yml',
      'markdown': 'md',
      'txt': 'txt',
    };
    
    return extensions[language] || 'txt';
  }

  /**
   * 清理文件名，移除非法字符
   */
  private sanitizeFilename(filename: string): string {
    // 移除非法文件名字符
    const sanitized = filename
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/__+/g, '_')
      .trim();
    
    // 确保文件名有合理的长度
    const maxLength = 100;
    if (sanitized.length > maxLength) {
      const extensionMatch = sanitized.match(/\.([a-zA-Z0-9]+)$/);
      if (extensionMatch) {
        const extension = extensionMatch[0];
        const nameWithoutExt = sanitized.slice(0, -extension.length);
        const truncatedName = nameWithoutExt.slice(0, maxLength - extension.length);
        return truncatedName + extension;
      }
      return sanitized.slice(0, maxLength);
    }
    
    return sanitized || 'unnamed_file';
  }

  /**
   * 推测文件 MIME 类型
   */
  protected guessFileMimeType(url: string, filename: string): string {
    const lowerUrl = url.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    
    // Claude 可能支持的文件类型
    if (lowerUrl.includes('.claude') || lowerFilename.includes('.claude')) {
      return 'application/x-claude-document';
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
    
    // Claude 常见的代码文件类型
    if (lowerUrl.includes('.py') || lowerFilename.includes('.py')) {
      return 'text/x-python';
    }
    if (lowerUrl.includes('.js') || lowerFilename.includes('.js')) {
      return 'text/javascript';
    }
    if (lowerUrl.includes('.ts') || lowerFilename.includes('.ts')) {
      return 'text/typescript';
    }
    if (lowerUrl.includes('.html') || lowerFilename.includes('.html')) {
      return 'text/html';
    }
    if (lowerUrl.includes('.css') || lowerFilename.includes('.css')) {
      return 'text/css';
    }
    if (lowerUrl.includes('.md') || lowerFilename.includes('.md')) {
      return 'text/markdown';
    }
    
    // 默认
    return 'application/octet-stream';
  }

  /**
   * 获取对话 URL
   */
  getConversationUrl(): string {
    // Claude 的 URL 结构通常是 claude.ai/chat/{conversation-id}
    const currentUrl = window.location.href;
    
    // 如果已经是具体对话页面，直接返回
    if (currentUrl.includes('/chat/')) {
      // 提取对话 ID
      const match = currentUrl.match(/claude\.ai\/chat\/([^/?]+)/);
      if (match) {
        return `https://claude.ai/chat/${match[1]}`;
      }
    }
    
    // 对于新对话，返回当前 URL
    return currentUrl;
  }
}

// 导出单例实例
export const claudeAdapter = new ClaudeAdapter();
