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
 * 更新时间：2026年11月
 * 
 * Claude Web 界面特点：
 * - Anthropic 风格，简洁现代
 * - 使用虚拟滚动技术处理长对话
 * - 可能使用特定的字体类名
 * - 支持文件上传和代码显示
 * - 基于 Claude Clone 项目和社区信息
 */
export const CLAUDE_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    // Claude 特定的选择器
    '[data-testid="assistant-message"]',
    '[data-role="assistant"]',
    '[data-type="assistant"]',
    '.font-claude-message',
    '.claude-message',
    '.assistant-content',
    // 通用选择器
    '.prose',
    '[class*="assistant"]',
    '[class*="model-response"]',
    'div[class*="message"][class*="assistant"]',
    '[class*="message-bubble"][class*="assistant"]',
  ],
  userMessage: [
    // Claude 特定的选择器
    '[data-testid="user-message"]',
    '[data-role="user"]',
    '[data-type="user"]',
    '.font-user-message',
    '.user-message',
    '.human-content',
    // 通用选择器
    '[class*="user"]',
    '[class*="human"]',
    'div[class*="message"][class*="user"]',
    '[class*="message-bubble"][class*="user"]',
    'div[class*="input"][class*="human"]',
  ],
  copyButton: [
    // Claude 风格的按钮
    'button[aria-label="Copy"]',
    'button[aria-label="Copy message"]',
    'button[aria-label="Copy code"]',
    'button[aria-label="复制"]',
    'button[title="Copy"]',
    'button[title="复制"]',
    // Claude 特定的类名
    '[class*="copy-button"]',
    '[class*="copy-btn"]',
    '[class*="copy-icon"]',
    // 代码块的复制按钮
    'pre button[aria-label*="Copy"]',
    'pre button[aria-label*="复制"]',
  ],
  messageContainer: [
    // Claude 消息容器
    '[data-testid]',
    '[data-message-id]',
    '[data-chat-id]',
    // 容器类名
    '[class*="message-container"]',
    '[class*="chat-message"]',
    '[class*="conversation-item"]',
    '[class*="message-wrapper"]',
    // 通用容器
    'div[class*="message"]',
    'div[class*="chat"]',
  ],
  excludeSelectors: [
    // 排除头像和个人信息
    'img[alt*="avatar"]',
    'img[alt*="Avatar"]',
    'img[alt*="profile"]',
    'img[alt*="Profile"]',
    'img[src*="avatar"]',
    // 排除 Anthropic 品牌元素
    '[class*="anthropic"]',
    '[class*="claude-logo"]',
    '[class*="brand"]',
    // 导航和界面元素
    'nav',
    'header',
    'footer',
    '[class*="sidebar"]',
    '[class*="toolbar"]',
    '[class*="menu"]',
    // 虚拟滚动占位符
    '[class*="placeholder"]',
    '[class*="virtual"]',
    // 加载状态
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="skeleton"]',
  ],
};

/**
 * Gemini 选择器配置
 * 更新时间：2026年11月
 * 
 * Gemini Web 界面的 DOM 结构参考：
 * - 助手消息通常有特定的角色属性或类名
 * - 用户查询通常在 AI 回复前面
 * - 使用 Material Design (mat-*) 组件
 */
export const GEMINI_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    // 新版 Gemini 选择器
    '[role="assistant"]',
    '[data-message-type="model"]',
    '[class*="model-response"]',
    '[class*="assistant-message"]',
    '[class*="response-text"]',
    // 旧版备用选择器
    '.model-response-text',
    '[data-test-id="model-response"]',
    'message-content[role="assistant"]',
  ],
  userMessage: [
    // 新版 Gemini 选择器
    '[role="user"]',
    '[data-message-type="user"]',
    '[class*="user-query"]',
    '[class*="user-message"]',
    '[class*="query-text"]',
    // 旧版备用选择器
    '.user-query-text',
    '[data-test-id="user-query"]',
    'user-query[role="user"]',
  ],
  copyButton: [
    // 新版按钮选择器
    'button[aria-label*="Copy"]',
    'button[title*="Copy"]',
    'button[class*="copy"]',
    // 语言支持
    'button[aria-label*="复制"]',
    'button[title*="复制"]',
    // Material Design 按钮
    'mat-icon-button[aria-label*="Copy"]',
    'mat-icon-button[title*="Copy"]',
  ],
  messageContainer: [
    // 新版容器选择器
    '[role="listitem"]',
    '[class*="message-container"]',
    '[class*="chat-message"]',
    '[data-message-id]',
    // 旧版备用选择器
    '[data-test-id]',
    'message-content',
    'user-query',
  ],
  excludeSelectors: [
    // 排除头像、个人资料图片
    'img[alt*="avatar"]',
    'img[src*="avatar"]',
    'img[alt*="profile"]',
    'img[alt*="Profile"]',
    // Material Design 图标
    'mat-icon',
    'mat-icon-button[aria-label*="thumb"]',
    // 导航和头部
    'nav',
    'header',
    'footer',
    // 加载状态
    '[class*="loading"]',
    '[class*="spinner"]',
  ],
};

/**
 * WorkBuddy 选择器配置
 * 更新时间：2026年11月
 * 
 * WorkBuddy Web 界面特点：
 * - 腾讯生态风格的 UI
 * - 可能有中英文混合的类名和属性
 * - 支持文件上传和代码编辑
 * - 可能是基于 Electron 或 Web 技术的桌面应用
 */
export const WORKBUDDY_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    // 腾讯风格的选择器
    '.ai-response',
    '.assistant-message',
    '[class*="ai-"]',
    '[class*="assistant-"]',
    '[class*="response-"]',
    '[data-role="assistant"]',
    '[data-type="ai"]',
    // 通用选择器
    '[data-testid="ai-message"]',
    'div[class*="assistant"]',
    'div[class*="response"]',
    'div[class*="model"]',
  ],
  userMessage: [
    // 腾讯风格的选择器
    '.user-input',
    '.user-message',
    '[class*="user-"]',
    '[class*="input-"]',
    '[data-role="user"]',
    '[data-type="user"]',
    // 通用选择器
    '[data-testid="user-message"]',
    'div[class*="user"]',
    'div[class*="input"]',
    'div[class*="query"]',
  ],
  copyButton: [
    // 中英文支持
    'button[aria-label="Copy"]',
    'button[aria-label="复制"]',
    'button[aria-label="拷贝"]',
    'button[title="Copy"]',
    'button[title="复制"]',
    'button[title="拷贝"]',
    // 腾讯风格
    '[class*="copy-btn"]',
    '[class*="copy-button"]',
    '[class*="复制"]',
    '[class*="拷贝"]',
    // 图标按钮
    'button svg[aria-label*="Copy"]',
    'button svg[aria-label*="复制"]',
  ],
  messageContainer: [
    // 消息容器选择器
    '[class*="message-"]',
    '[class*="chat-"]',
    '[class*="conversation-"]',
    '[data-message-id]',
    '[data-chat-id]',
    // 通用选择器
    '[data-testid]',
    'div[class*="message"]',
    'div[class*="chat"]',
  ],
  excludeSelectors: [
    // 排除头像和个人信息
    'img[alt*="avatar"]',
    'img[alt*="Avatar"]',
    'img[alt*="头像"]',
    'img[src*="avatar"]',
    'img[src*="profile"]',
    // 腾讯生态组件
    '[class*="qq-"]',
    '[class*="wecom-"]',
    '[class*="tencent-"]',
    // 导航和界面元素
    'nav',
    'header',
    'footer',
    '[class*="sidebar"]',
    '[class*="toolbar"]',
    '[class*="menu"]',
    // 加载状态
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="placeholder"]',
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
  deepseek: 'DeepSeek',
};

/**
 * 平台域名映射
 */
export const PLATFORM_DOMAINS: Record<string, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  workbuddy: ['workbuddy.ai'],
  deepseek: ['chat.deepseek.com'],
};


/**
 * DeepSeek 选择器配置
 * 更新时间：2026年11月
 * 
 * DeepSeek Web 界面特点：
 * - 现代化聊天界面，可能有类似 OpenAI 的风格
 * - 支持 RTL/LTR 文本方向
 * - 有思考推理部分（thinking sections）
 * - 可能使用现代化的 CSS 框架
 * - 基于 DeepSeekPlus 扩展的信息推测
 */
export const DEEPSEEK_SELECTORS: PlatformSelectors = {
  assistantMessage: [
    // DeepSeek 风格的选择器
    '[data-role="assistant"]',
    '[data-type="assistant"]',
    '[class*="assistant-message"]',
    '[class*="model-response"]',
    '[class*="deepseek-answer"]',
    '[class*="ai-response"]',
    // 通用选择器
    '.prose',
    '[class*="markdown"]',
    '[class*="message"][class*="assistant"]',
  ],
  userMessage: [
    // DeepSeek 风格的选择器
    '[data-role="user"]',
    '[data-type="user"]',
    '[class*="user-message"]',
    '[class*="user-query"]',
    '[class*="human-input"]',
    // 通用选择器
    '[class*="message"][class*="user"]',
    '[class*="query"][class*="user"]',
    '[class*="input"][class*="human"]',
  ],
  copyButton: [
    // DeepSeek 风格的按钮
    'button[aria-label*="Copy"]',
    'button[aria-label*="复制"]',
    'button[title*="Copy"]',
    'button[title*="复制"]',
    '[class*="copy-button"]',
    '[class*="copy-btn"]',
    '[class*="copy-icon"]',
    // 代码块的复制按钮
    'button[aria-label*="Copy code"]',
    'button[aria-label*="复制代码"]',
  ],
  messageContainer: [
    // 消息容器
    '[data-message-id]',
    '[data-chat-id]',
    '[class*="message-container"]',
    '[class*="chat-message"]',
    '[class*="conversation-item"]',
    // 通用容器
    '[class*="message"]:has([class*="content"])',
    '[class*="chat"]:has([class*="content"])',
  ],
  excludeSelectors: [
    // 排除思考推理部分
    '[class*="thinking"]',
    '[class*="reasoning"]',
    '[class*="推理"]',
    // 排除头像和用户信息
    'img[alt*="avatar"]',
    'img[alt*="Avatar"]',
    'img[alt*="头像"]',
    'img[src*="avatar"]',
    // 排除界面元素
    'nav',
    'header',
    'footer',
    '[class*="sidebar"]',
    '[class*="toolbar"]',
    '[class*="menu"]',
    // 排除加载状态
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="placeholder"]',
    // 排除系统提示
    '[class*="system-prompt"]',
    '[class*="system-message"]',
  ],
};