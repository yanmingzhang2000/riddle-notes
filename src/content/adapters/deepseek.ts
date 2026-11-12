import { BaseAdapter } from './base-adapter';
import { DEEPSEEK_SELECTORS, PLATFORM_DOMAINS } from '../selectors';

/**
 * DeepSeek 平台适配器
 * 
 * 注意：DeepSeek 的 DOM 结构可能随时变化
 * 选择器需要定期维护和更新
 * 
 * DeepSeek Web 界面特点：
 * - 现代化聊天界面，类似 OpenAI 风格
 * - 支持 RTL/LTR 文本方向
 * - 有思考推理部分（thinking sections）
 * - 可能使用现代化的 CSS 框架
 * - 基于 DeepSeekPlus 扩展的信息推测
 */
export class DeepSeekAdapter extends BaseAdapter {
  platformId = 'deepseek';
  platformName = 'DeepSeek';
  selectors = DEEPSEEK_SELECTORS;

  matches(url: string): boolean {
    const domains = PLATFORM_DOMAINS[this.platformId] || [];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * 查找所有 AI 回复消息
   * DeepSeek 特定的实现，优化现代化界面的查找
   */
  findAssistantMessages(): Element[] {
    const messages = super.findAssistantMessages();
    
    // 如果没有找到消息，尝试查找 DeepSeek 特有的选择器
    if (messages.length === 0) {
      // 查找带有数据属性的消息
      const dataMessages = document.querySelectorAll('[data-role="assistant"], [data-type="assistant"]');
      if (dataMessages.length > 0) {
        return Array.from(dataMessages);
      }
      
      // 查找包含文本的响应容器
      const responseContainers = document.querySelectorAll('[class*="response"], [class*="answer"], .prose');
      const assistantResponses: Element[] = [];
      
      responseContainers.forEach(container => {
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
          
          // 排除思考推理部分
          const isThinkingSection = container.closest('[class*="thinking"], [class*="reasoning"]');
          
          if (!isUserMessage && !isThinkingSection) {
            assistantResponses.push(container);
          }
        }
      });
      
      return assistantResponses;
    }
    
    return messages;
  }

  /**
   * 查找对应的用户消息
   * DeepSeek 特定的消息查找优化
   */
  findUserMessage(assistantMessage: Element): Element | null {
    // 方法1：使用基础适配器的实现
    const userMessage = super.findUserMessage(assistantMessage);
    if (userMessage) return userMessage;

    // 方法2：基于数据属性查找
    const assistantRole = assistantMessage.getAttribute('data-role');
    const assistantType = assistantMessage.getAttribute('data-type');
    
    if (assistantRole === 'assistant' || assistantType === 'assistant') {
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

    // 方法3：基于对话线程的查找
    const threadContainer = this.findThreadContainer(assistantMessage);
    if (threadContainer) {
      // 在对话线程中查找所有用户消息
      const userMessages = threadContainer.querySelectorAll(
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
   * DeepSeek 可能支持代码块和文件上传
   */
  extractAttachments(message: Element): AttachmentDraft[] {
    const attachments = super.extractAttachments(message);

    // DeepSeek 特定的附件处理
    // 1. 查找代码块和代码片段
    const codeBlocks = message.querySelectorAll(
      'pre code, [class*="code-block"], [class*="snippet"], [class*="代码"]'
    );
    
    codeBlocks.forEach((codeBlock, index) => {
      const codeText = codeBlock.textContent || '';
      if (codeText.trim().length > 0) {
        // 推断代码语言
        const language = this.guessCodeLanguage(codeBlock);
        const extension = this.getFileExtensionForLanguage(language);
        
        // 创建代码块的文本表示
        const codeBlob = new Blob([codeText], { type: 'text/plain' });
        const codeBlobUrl = URL.createObjectURL(codeBlob);
        
        attachments.push({
          name: `code-${index + 1}.${extension}`,
          mimeType: 'text/plain',
          sourceUrl: codeBlobUrl,
          localBlob: codeBlob,
        });
      }
    });

    // 2. 查找文件上传和预览
    const fileUploads = message.querySelectorAll(
      '[class*="upload"], [class*="file-"], [class*="attachment"]'
    );
    
    fileUploads.forEach(upload => {
      // 查找图片预览
      const img = upload.querySelector('img');
      if (img && img.src && !this.isExcludedImage(img)) {
        attachments.push({
          name: upload.getAttribute('data-filename') || 
                upload.getAttribute('aria-label') || 
                img.alt || 
                'attachment',
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
    });

    // 3. 查找表格和数据内容
    const tables = message.querySelectorAll('table');
    tables.forEach((table, index) => {
      // 将表格转换为 CSV 格式
      const csvData = this.tableToCSV(table);
      if (csvData.trim().length > 0) {
        const csvBlob = new Blob([csvData], { type: 'text/csv' });
        const csvBlobUrl = URL.createObjectURL(csvBlob);
        
        attachments.push({
          name: `table-${index + 1}.csv`,
          mimeType: 'text/csv',
          sourceUrl: csvBlobUrl,
          localBlob: csvBlob,
        });
      }
    });

    return attachments;
  }

  /**
   * 查找复制按钮
   * DeepSeek 可能使用现代化的按钮样式
   */
  findCopyButtons(): Element[] {
    const buttons = super.findCopyButtons();
    
    // 如果没有找到按钮，尝试查找代码块的复制按钮
    if (buttons.length === 0) {
      // 查找代码块内的复制按钮
      const codeContainers = document.querySelectorAll('pre, [class*="code-block"]');
      codeContainers.forEach(container => {
        const copyButtons = container.querySelectorAll('button');
        copyButtons.forEach(button => {
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          const title = (button.getAttribute('title') || '').toLowerCase();
          const textContent = (button.textContent || '').toLowerCase();
          
          // 检查是否是复制按钮（中英文支持）
          const isCopyButton = 
            ariaLabel.includes('copy') || ariaLabel.includes('复制') ||
            title.includes('copy') || title.includes('复制') ||
            textContent.includes('copy') || textContent.includes('复制');
          
          if (isCopyButton) {
            buttons.push(button);
          }
        });
      });
    }
    
    return buttons;
  }

  /**
   * 查找对话线程容器
   * DeepSeek 可能使用线程化的对话结构
   */
  private findThreadContainer(element: Element): Element | null {
    let current = element.parentElement;
    const maxAttempts = 10;
    let attempts = 0;

    while (current && attempts < maxAttempts) {
      // 检查是否是对话线程容器
      const classList = current.className || '';
      const isThreadContainer = 
        classList.includes('thread') ||
        classList.includes('conversation-thread') ||
        classList.includes('chat-thread') ||
        current.getAttribute('role') === 'log' ||
        current.getAttribute('data-type') === 'conversation';
      
      if (isThreadContainer) {
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
    
    // 检查常见的语言类名
    if (classList.includes('language-')) {
      const match = classList.match(/language-(\w+)/);
      if (match) return match[1];
    }
    
    // 检查特定的语言标记
    const languages = [
      { pattern: /python|py/, language: 'python' },
      { pattern: /javascript|js/, language: 'javascript' },
      { pattern: /typescript|ts/, language: 'typescript' },
      { pattern: /java/, language: 'java' },
      { pattern: /c\+\+|cpp/, language: 'cpp' },
      { pattern: /c#|csharp/, language: 'csharp' },
      { pattern: /go|golang/, language: 'go' },
      { pattern: /rust/, language: 'rust' },
      { pattern: /ruby/, language: 'ruby' },
      { pattern: /php/, language: 'php' },
      { pattern: /sql/, language: 'sql' },
      { pattern: /html/, language: 'html' },
      { pattern: /css/, language: 'css' },
      { pattern: /json/, language: 'json' },
      { pattern: /yaml|yml/, language: 'yaml' },
      { pattern: /markdown|md/, language: 'markdown' },
    ];
    
    for (const lang of languages) {
      if (lang.pattern.test(classList.toLowerCase())) {
        return lang.language;
      }
    }
    
    // 通过内容推断
    const content = codeElement.textContent || '';
    if (content.includes('<?php')) return 'php';
    if (content.includes('def ') && content.includes('import ')) return 'python';
    if (content.includes('function(') || content.includes('const ') || content.includes('let ')) return 'javascript';
    if (content.includes('public class')) return 'java';
    
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
   * 将表格转换为 CSV
   */
  private tableToCSV(table: HTMLTableElement): string {
    const rows: string[] = [];
    
    // 处理表头
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
      const headers: string[] = [];
      headerRow.querySelectorAll('th, td').forEach(cell => {
        headers.push(this.escapeCSV(cell.textContent || ''));
      });
      rows.push(headers.join(','));
    }
    
    // 处理数据行
    table.querySelectorAll('tbody tr, tr:not(thead tr)').forEach(row => {
      if (row === headerRow) return;
      
      const cells: string[] = [];
      row.querySelectorAll('td, th').forEach(cell => {
        cells.push(this.escapeCSV(cell.textContent || ''));
      });
      if (cells.length > 0) {
        rows.push(cells.join(','));
      }
    });
    
    return rows.join('\n');
  }

  /**
   * 转义 CSV 单元格内容
   */
  private escapeCSV(text: string): string {
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  /**
   * 推测文件 MIME 类型
   * 支持常见的文件类型
   */
  protected guessFileMimeType(url: string, filename: string): string {
    const lowerUrl = url.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    
    // 代码文件类型
    if (lowerUrl.includes('.py') || lowerFilename.includes('.py')) {
      return 'text/x-python';
    }
    if (lowerUrl.includes('.js') || lowerFilename.includes('.js')) {
      return 'application/javascript';
    }
    if (lowerUrl.includes('.ts') || lowerFilename.includes('.ts')) {
      return 'application/typescript';
    }
    if (lowerUrl.includes('.java') || lowerFilename.includes('.java')) {
      return 'text/x-java-source';
    }
    if (lowerUrl.includes('.cpp') || lowerFilename.includes('.cpp')) {
      return 'text/x-c++src';
    }
    if (lowerUrl.includes('.cs') || lowerFilename.includes('.cs')) {
      return 'text/x-csharp';
    }
    if (lowerUrl.includes('.go') || lowerFilename.includes('.go')) {
      return 'text/x-go';
    }
    if (lowerUrl.includes('.rs') || lowerFilename.includes('.rs')) {
      return 'text/x-rustsrc';
    }
    if (lowerUrl.includes('.rb') || lowerFilename.includes('.rb')) {
      return 'text/x-ruby';
    }
    if (lowerUrl.includes('.php') || lowerFilename.includes('.php')) {
      return 'application/x-httpd-php';
    }
    
    // 数据文件类型
    if (lowerUrl.includes('.csv') || lowerFilename.includes('.csv')) {
      return 'text/csv';
    }
    if (lowerUrl.includes('.json') || lowerFilename.includes('.json')) {
      return 'application/json';
    }
    if (lowerUrl.includes('.xml') || lowerFilename.includes('.xml')) {
      return 'application/xml';
    }
    
    // 文档类型
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
    
    // 默认
    return 'application/octet-stream';
  }
}

// 导出单例实例
export const deepseekAdapter = new DeepSeekAdapter();