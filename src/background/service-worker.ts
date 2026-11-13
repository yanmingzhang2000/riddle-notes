import { db, initializeDefaultData } from '@db/schema';

// 监听扩展安装
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Sidecar] Extension installed:', details.reason);
  
  // 初始化默认数据
  await initializeDefaultData();
  
  // 设置 Side Panel 行为
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  
  console.log('[Sidecar] Initialization complete');
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // 保持消息通道开启
});

/**
 * 处理来自 content script 和 sidepanel 的消息
 */
async function handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  try {
    switch (message.type) {
      case 'SAVE_PROMPT':
        return await savePrompt(message.payload);
      
      case 'GET_PROMPTS':
        return await getPrompts(message.payload);
      
      case 'UPDATE_PROMPT':
        return await updatePrompt(message.payload);
      
      case 'DELETE_PROMPT':
        return await deletePrompt(message.payload);
      
      case 'SEARCH_PROMPTS':
        return await searchPrompts(message.payload);
      
      case 'CREATE_VERSION':
        return await createVersion(message.payload);
      
      case 'GET_VERSIONS':
        return await getVersions(message.payload);
      
      case 'IMPROVE_PROMPT':
        return await improvePrompt(message.payload);
      
      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('[Sidecar] Handle message error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 保存 Prompt
 */
async function savePrompt(data: {
  promptText: string;
  outputText: string;
  sourcePlatform: string;
  conversationUrl: string;
  attachments?: any[];
}) {
  // 1. 创建 Prompt 记录
  const promptId = await db.prompts.add({
    title: generateTitle(data.promptText),
    description: generateDescription(data.promptText),
    sourcePlatform: data.sourcePlatform,
    isFavorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    folderId: 1, // 默认"未分类"
  });

  // 2. 创建第一个版本
  const versionId = await db.promptVersions.add({
    promptId: promptId,
    versionNumber: 1,
    content: data.promptText,
    changeNote: '初始版本',
    createdAt: new Date(),
  });

  // 3. 创建运行记录
  const runId = await db.runs.add({
    promptId: promptId,
    promptVersionId: versionId,
    inputText: data.promptText,
    outputText: data.outputText,
    sourcePlatform: data.sourcePlatform,
    conversationUrl: data.conversationUrl,
    createdAt: new Date(),
  });

  // 4. 保存附件（如果有）
  if (data.attachments && data.attachments.length > 0) {
    for (const attachment of data.attachments) {
      await db.attachments.add({
        runId: runId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sourceUrl: attachment.sourceUrl,
        localBlob: attachment.localBlob,
        createdAt: new Date(),
      });
    }
  }

  return {
    success: true,
    data: {
      promptId,
      versionId,
      runId,
    },
  };
}

/**
 * 获取 Prompt 列表
 */
async function getPrompts(filters?: {
  folderId?: number;
  tags?: number[];
  isFavorite?: boolean;
  platform?: string;
}) {
  let collection = db.prompts.orderBy('updatedAt').reverse();

  if (filters?.folderId) {
    collection = db.prompts.where('folderId').equals(filters.folderId);
  }

  if (filters?.isFavorite !== undefined) {
    // 需要手动过滤
  }

  const prompts = await collection.toArray();

  return {
    success: true,
    data: prompts,
  };
}

/**
 * 更新 Prompt
 */
async function updatePrompt(data: {
  promptId: number;
  updates: Partial<{
    title: string;
    description: string;
    folderId: number;
    isFavorite: boolean;
    tags: number[];
  }>;
}) {
  await db.prompts.update(data.promptId, {
    ...data.updates,
    updatedAt: new Date(),
  });

  return { success: true };
}

/**
 * 删除 Prompt
 */
async function deletePrompt(data: { promptId: number }) {
  // 删除相关的所有数据
  await db.transaction('rw', [db.prompts, db.promptVersions, db.runs, db.attachments], async () => {
    // 删除附件
    const runs = await db.runs.where('promptId').equals(data.promptId).toArray();
    for (const run of runs) {
      await db.attachments.where('runId').equals(run.id!).delete();
    }

    // 删除运行记录
    await db.runs.where('promptId').equals(data.promptId).delete();

    // 删除版本
    await db.promptVersions.where('promptId').equals(data.promptId).delete();

    // 删除 Prompt
    await db.prompts.delete(data.promptId);
  });

  return { success: true };
}

/**
 * 搜索 Prompt
 */
async function searchPrompts(data: { query: string }) {
  // 简单的全文搜索（可以在后续优化为更复杂的搜索）
  const prompts = await db.prompts
    .filter(prompt => 
      prompt.title.toLowerCase().includes(data.query.toLowerCase()) ||
      (prompt.description?.toLowerCase().includes(data.query.toLowerCase()) ?? false)
    )
    .toArray();

  return {
    success: true,
    data: prompts,
  };
}

/**
 * 创建新版本
 */
async function createVersion(data: {
  promptId: number;
  content: string;
  changeNote?: string;
}) {
  // 获取当前最大版本号
  const versions = await db.promptVersions
    .where('promptId')
    .equals(data.promptId)
    .toArray();
  
  const maxVersion = Math.max(...versions.map(v => v.versionNumber), 0);
  const newVersionNumber = maxVersion + 1;

  const versionId = await db.promptVersions.add({
    promptId: data.promptId,
    versionNumber: newVersionNumber,
    content: data.content,
    changeNote: data.changeNote,
    createdAt: new Date(),
  });

  // 更新 Prompt 的更新时间
  await db.prompts.update(data.promptId, {
    updatedAt: new Date(),
  });

  return {
    success: true,
    data: {
      versionId,
      versionNumber: newVersionNumber,
    },
  };
}

/**
 * 获取版本历史
 */
async function getVersions(data: { promptId: number }) {
  const versions = await db.promptVersions
    .where('promptId')
    .equals(data.promptId)
    .reverse()
    .toArray();

  return {
    success: true,
    data: versions,
  };
}

/**
 * AI 改进 Prompt
 * 注：这个功能需要配置 AI API，将在后续实现
 */
async function improvePrompt(data: {
  promptId: number;
  runId: number;
  improvementGoal?: string;
}) {
  // TODO: 实现 AI 改进功能
  return {
    success: false,
    error: 'AI improvement feature not implemented yet',
  };
}

/**
 * 生成标题（从 Prompt 前 50 个字符）
 */
function generateTitle(text: string): string {
  return text.substring(0, 50) + (text.length > 50 ? '...' : '');
}

/**
 * 生成描述（从 Prompt 前 200 个字符）
 */
function generateDescription(text: string): string {
  return text.substring(0, 200) + (text.length > 200 ? '...' : '');
}

console.log('[Sidecar] Service worker loaded');
