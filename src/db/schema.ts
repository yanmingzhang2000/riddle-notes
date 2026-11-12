import Dexie, { Table } from 'dexie';

// 数据模型定义

export interface Folder {
  id?: number;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tag {
  id?: number;
  name: string;
  createdAt: Date;
}

export interface Prompt {
  id?: number;
  title: string;
  description?: string;
  folderId?: number;
  sourcePlatform: string;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags?: number[]; // Tag IDs
}

export interface PromptVersion {
  id?: number;
  promptId: number;
  versionNumber: number;
  content: string;
  changeNote?: string;
  createdAt: Date;
}

export interface Run {
  id?: number;
  promptId: number;
  promptVersionId: number;
  inputText: string;
  outputText: string;
  modelName?: string;
  sourcePlatform: string;
  conversationUrl?: string;
  rating?: number; // 1-5 stars
  feedback?: string;
  createdAt: Date;
}

export interface Attachment {
  id?: number;
  runId: number;
  name: string;
  mimeType: string;
  size?: number;
  sourceUrl?: string;
  localBlob?: Blob;
  createdAt: Date;
}

export interface ImprovementRequest {
  id?: number;
  promptId: number;
  sourceRunId: number;
  improvementGoal?: string;
  aiAnalysis?: string;
  suggestedPrompt?: string;
  suggestedChangeNote?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

export interface AppSettings {
  id?: number;
  updateCheckEnabled: boolean;
  lastUpdateCheckAt?: Date;
  lastNotifiedVersion?: string;
  lastDismissedVersion?: string;
  updateManifestUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

// Dexie 数据库类
export class SidecarDB extends Dexie {
  folders!: Table<Folder, number>;
  tags!: Table<Tag, number>;
  prompts!: Table<Prompt, number>;
  promptVersions!: Table<PromptVersion, number>;
  runs!: Table<Run, number>;
  attachments!: Table<Attachment, number>;
  improvementRequests!: Table<ImprovementRequest, number>;
  appSettings!: Table<AppSettings, number>;

  constructor() {
    super('SidecarDB');
    
    this.version(1).stores({
      folders: '++id, name, sortOrder, createdAt, updatedAt',
      tags: '++id, name, createdAt',
      prompts: '++id, title, folderId, sourcePlatform, isFavorite, createdAt, updatedAt, *tags',
      promptVersions: '++id, promptId, versionNumber, createdAt',
      runs: '++id, promptId, promptVersionId, sourcePlatform, rating, createdAt',
      attachments: '++id, runId, createdAt',
      improvementRequests: '++id, promptId, sourceRunId, status, createdAt',
    });
    
    // Version 2: Add appSettings table for update management
    this.version(2).stores({
      folders: '++id, name, sortOrder, createdAt, updatedAt',
      tags: '++id, name, createdAt',
      prompts: '++id, title, folderId, sourcePlatform, isFavorite, createdAt, updatedAt, *tags',
      promptVersions: '++id, promptId, versionNumber, createdAt',
      runs: '++id, promptId, promptVersionId, sourcePlatform, rating, createdAt',
      attachments: '++id, runId, createdAt',
      improvementRequests: '++id, promptId, sourceRunId, status, createdAt',
      appSettings: '++id, updateCheckEnabled, lastUpdateCheckAt, lastNotifiedVersion, lastDismissedVersion, updateManifestUrl',
    });
  }
}

// 导出单例实例
export const db = new SidecarDB();

// 初始化默认数据
export async function initializeDefaultData() {
  const folderCount = await db.folders.count();
  
  if (folderCount === 0) {
    await db.folders.bulkAdd([
      { name: '未分类', sortOrder: 0, createdAt: new Date(), updatedAt: new Date() },
      { name: 'AI 产品', sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
      { name: '项目复盘', sortOrder: 2, createdAt: new Date(), updatedAt: new Date() },
      { name: '简历与求职', sortOrder: 3, createdAt: new Date(), updatedAt: new Date() },
      { name: '知识整理', sortOrder: 4, createdAt: new Date(), updatedAt: new Date() },
      { name: '研究分析', sortOrder: 5, createdAt: new Date(), updatedAt: new Date() },
      { name: '写作', sortOrder: 6, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await db.tags.bulkAdd([
      { name: '高频使用', createdAt: new Date() },
      { name: '待改进', createdAt: new Date() },
      { name: '效果很好', createdAt: new Date() },
    ]);
  }

  // 初始化应用设置
  const settingsCount = await db.appSettings.count();
  
  if (settingsCount === 0) {
    await db.appSettings.add({
      updateCheckEnabled: true,
      updateManifestUrl: 'https://raw.githubusercontent.com/yanmingzhang2000/sidecar/main/update-manifest.json',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
