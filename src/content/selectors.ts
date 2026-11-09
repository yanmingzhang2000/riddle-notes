/**
 * 平台 DOM 选择器配置
 * 
 * 集中管理所有平台的 DOM 选择器，方便后续维护
 * 当平台更新 DOM 结构时，只需修改此文件
 */

export interface PlatformSelectors {
  // AI 回复消息的选择器
  assistantMessage: string[];
  
  // 用户消息的选择器
  userMessage: string[];
  
  // 复制按钮的选择器（用于定位插入星标的位置）
  copyButton: string[];
  
  // 消息容器的选择器（向上查找）
  messageContainer: string[];
  
  // 排除的选择器（如头像、导航等）
  excludeSelectors: string[];
}

/**
 * ChatGPT 选择器配置
 * 更新时间：2024
 */
export const CHATGPT_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    '[data-testid="assistant-message"]',
    '[data-message-author-role="assistant"]',
    '.markdown',
  ],
  userMessage: [
    '[data-testid="user-message"]',
    '[data-message-author-role="user"]',
  ],
  copyButton: [
    'button[aria-label="Copy"]',
    'button[aria-label="复制"]',
    'button[aria-label="Copy code"]',
  ],
  messageContainer: [
    '[data-testid]',
    '[data-message-author-role]',
  ],
  excludeSelectors: [
    'img[alt*="avatar"]',
    'img[src*="avatar"]',
    'nav',
    'header',
  ],
};

/**
 * Claude 选择器配置
 * 更新时间：2024
 */
export const CLAUDE_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    '.font-claude-message',
    '[data-testid="assistant-message"]',
    '.prose',
    'div[class*="message"]',
  ],
  userMessage: [
    '.font-user-message',
    '[data-testid="user-message"]',
    'div[class*="human"]',
    'div[class*="user-message"]',
  ],
  copyButton: [
    'button[aria-label="Copy"]',
    'button[aria-label="复制"]',
    'button[class*="copy"]',
  ],
  messageContainer: [
    '[data-testid]',
    'div[class*="message"]',
  ],
  excludeSelectors: [
    'img[alt*="avatar"]',
    'img[alt*="profile"]',
    'nav',
    'header',
  ],
};

/**
 * Gemini 选择器配置
 * 更新时间：2024
 */
export const GEMINI_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    '.model-response-text',
    '[data-test-id="model-response"]',
    'div[class*="model-response"]',
    'message-content',
  ],
  userMessage: [
    '.user-query-text',
    '[data-test-id="user-query"]',
    'div[class*="user-query"]',
    'user-query',
  ],
  copyButton: [
    'button[aria-label="Copy"]',
    'button[aria-label="复制"]',
    'button[title*="copy"]',
    'button[title*="复制"]',
  ],
  messageContainer: [
    '[data-test-id]',
    'message-content',
    'user-query',
  ],
  excludeSelectors: [
    'img[alt*="avatar"]',
    'img[alt*="profile"]',
    'mat-icon',
    'nav',
  ],
};

/**
 * WorkBuddy 选择器配置
 * 更新时间：2024
 */
export const WORKBUDDY_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    '.ai-response',
    '[data-testid="ai-message"]',
    'div[class*="assistant"]',
    'div[class*="response"]',
  ],
  userMessage: [
    '.user-input',
    '[data-testid="user-message"]',
    'div[class*="user"]',
    'div[class*="input"]',
  ],
  copyButton: [
    'button[aria-label="Copy"]',
    'button[aria-label="复制"]',
    'button[class*="copy"]',
  ],
  messageContainer: [
    '[data-testid]',
    'div[class*="message"]',
  ],
  excludeSelectors: [
    'img[alt*="avatar"]',
    'nav',
    'header',
  ],
};

/**
 * 平台显示名称映射
 */
export const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  workbuddy: 'WorkBuddy',
};

/**
 * 平台域名映射
 */
export const PLATFORM_DOMAINS: Record<string, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  workbuddy: ['workbuddy.ai'],
};
