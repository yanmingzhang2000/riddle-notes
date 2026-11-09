// 支持的平台
export const SUPPORTED_PLATFORMS = {
  CHATGPT: 'chatgpt',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  WORKBUDDY: 'workbuddy',
} as const;

export type PlatformId = typeof SUPPORTED_PLATFORMS[keyof typeof SUPPORTED_PLATFORMS];

// 平台域名映射
export const PLATFORM_DOMAINS: Record<PlatformId, string[]> = {
  [SUPPORTED_PLATFORMS.CHATGPT]: ['chat.openai.com', 'chatgpt.com'],
  [SUPPORTED_PLATFORMS.CLAUDE]: ['claude.ai'],
  [SUPPORTED_PLATFORMS.GEMINI]: ['gemini.google.com'],
  [SUPPORTED_PLATFORMS.WORKBUDDY]: ['workbuddy.ai'],
};

// 星标按钮样式
export const STAR_BUTTON_STYLE = `
  .sidecar-star-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-left: 4px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    background: transparent;
    border: none;
    color: #6b7280;
  }
  
  .sidecar-star-btn:hover {
    background: #f3f4f6;
    color: #fbbf24;
  }
  
  .sidecar-star-btn.saved {
    color: #fbbf24;
  }
  
  .sidecar-star-btn svg {
    width: 16px;
    height: 16px;
  }
`;

// Toast 样式
export const TOAST_STYLE = `
  .sidecar-toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    background: #1f2937;
    color: #f9fafb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    animation: slideIn 0.3s ease;
  }
  
  @keyframes slideIn {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`;

// 默认 AI 改进指令
export const DEFAULT_IMPROVEMENT_PROMPT = `你是 Prompt 优化助手。

请分析以下 Prompt 的实际运行结果，并提出一个可验证的改进版本。

请输出：
1. 当前 Prompt 的优点；
2. 当前结果存在的问题；
3. 问题可能来自 Prompt 的哪些部分；
4. 改进后的 Prompt；
5. 本次修改点；
6. 可能带来的副作用；
7. 建议如何验证新版 Prompt。

要求：
1. 不要编造输入材料中没有的事实；
2. 不要直接覆盖原 Prompt；
3. 改进版本必须保留原 Prompt 的核心目标；
4. 如果问题来自输入材料或模型能力，而不是 Prompt，要明确说明；
5. 将改进后的 Prompt 作为新版本候选返回。`;

// 文件大小限制（字节）
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 导出版本
export const EXPORT_VERSION = '1.0.0';
