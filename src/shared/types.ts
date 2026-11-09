// 平台适配器接口
export interface AttachmentDraft {
  name: string;
  mimeType: string;
  size?: number;
  sourceUrl?: string;
  localBlob?: Blob;
}

export interface PlatformAdapter {
  platformId: string;
  platformName: string;
  matches(url: string): boolean;
  findAssistantMessages(): Element[];
  findUserMessage(assistantMessage: Element): Element | null;
  findCopyButtons(): Element[];
  extractMessageText(message: Element): string;
  extractAttachments(message: Element): AttachmentDraft[];
  getConversationUrl(): string;
}

// 消息类型（用于扩展内部通信）
export type MessageType = 
  | 'SAVE_PROMPT'
  | 'GET_PROMPTS'
  | 'UPDATE_PROMPT'
  | 'DELETE_PROMPT'
  | 'SEARCH_PROMPTS'
  | 'CREATE_VERSION'
  | 'GET_VERSIONS'
  | 'IMPROVE_PROMPT';

export interface ExtensionMessage<T = any> {
  type: MessageType;
  payload?: T;
}

export interface ExtensionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Toast 通知类型
export interface ToastData {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// 搜索和筛选
export interface SearchFilters {
  query?: string;
  folderId?: number;
  tags?: number[];
  platform?: string;
  isFavorite?: boolean;
}

export type SortField = 'updatedAt' | 'createdAt' | 'rating' | 'usageCount';
export type SortOrder = 'asc' | 'desc';

export interface SortOptions {
  field: SortField;
  order: SortOrder;
}

// AI 配置
export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// Prompt 导出格式
export interface PromptExport {
  version: string;
  exportedAt: string;
  prompts: any[];
  folders: any[];
  tags: any[];
  promptVersions: any[];
  runs: any[];
  attachments?: any[];
}
