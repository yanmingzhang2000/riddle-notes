/* global Blob, FileReader, atob, URL, setTimeout, crypto */
/**
 * 数据备份与恢复
 *
 * 导出：把所有表序列化为一个 JSON 对象。
 * 导入：先解析并校验文件，再用一个 IndexedDB 事务完成「清空 + 写入」。
 *       事务中任何一步失败都会整体回滚，现有数据保持原样。
 *
 * 文件格式（version 2.1.0）保留了旧格式的 version、exportedAt 和各表数组，
 * 因此旧版本的扩展也能导入新文件，新版本同样能导入旧文件（version 1.0.0、2.0.0）。
 * 2.1.0 起笔记带有 uid、type，手动笔记还有 content。旧版本扩展导入后看不到手动笔记的正文。
 */
import type {
  SidecarDB,
  Folder,
  Tag,
  Prompt,
  PromptVersion,
  Run,
  Attachment,
  ImprovementRequest,
} from '../db/schema';

export const BACKUP_APP_ID = 'riddle-notes';
export const BACKUP_FORMAT_VERSION = '2.1.0';
/** 能读取的最高格式主版本号。更高的版本来自更新的扩展，读取可能丢数据，所以拒绝 */
const SUPPORTED_MAJOR_VERSION = 2;

export const BACKUP_TABLES = [
  'folders',
  'tags',
  'prompts',
  'promptVersions',
  'runs',
  'attachments',
  'improvementRequests',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupCounts = Record<BackupTable, number>;

/** 导出文件里的附件：Blob 无法直接写进 JSON，真正的 Blob 会编码成 data URL */
export type ExportedAttachment = Omit<Attachment, 'localBlob'> & { localBlobDataUrl?: string };

export interface RestorableData {
  folders: Folder[];
  tags: Tag[];
  prompts: Prompt[];
  promptVersions: PromptVersion[];
  runs: Run[];
  attachments: Attachment[];
  improvementRequests: ImprovementRequest[];
}

export interface BackupFile {
  app: string;
  version: string;
  exportedAt: string;
  counts: BackupCounts;
  folders: Folder[];
  tags: Tag[];
  prompts: Prompt[];
  promptVersions: PromptVersion[];
  runs: Run[];
  attachments: ExportedAttachment[];
  improvementRequests: ImprovementRequest[];
}

export interface BackupPreview {
  version: string;
  exportedAt: string;
  /** 旧版本导出的文件（没有 app 标记） */
  legacyFormat: boolean;
  counts: BackupCounts;
  warnings: string[];
}

export interface ParsedBackup {
  data: RestorableData;
  preview: BackupPreview;
}

/** 面向用户的错误，message 可以直接展示 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new BackupError('附件数据格式不正确');
  }
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new BackupError('附件数据无法解码，备份文件可能已损坏');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
}

/** 读取所有表，生成备份对象。读取在同一个只读事务里完成，保证快照一致 */
export async function createBackup(db: SidecarDB): Promise<BackupFile> {
  const snapshot = await db.transaction(
    'r',
    [db.folders, db.tags, db.prompts, db.promptVersions, db.runs, db.attachments, db.improvementRequests],
    async () => ({
      folders: await db.folders.toArray(),
      tags: await db.tags.toArray(),
      prompts: await db.prompts.toArray(),
      promptVersions: await db.promptVersions.toArray(),
      runs: await db.runs.toArray(),
      attachments: await db.attachments.toArray(),
      improvementRequests: await db.improvementRequests.toArray(),
    })
  );

  // Blob 转换用到 FileReader，不能放在 IndexedDB 事务里（事务会提前结束）
  const attachments: ExportedAttachment[] = [];
  for (const attachment of snapshot.attachments) {
    const { localBlob, ...rest } = attachment;
    if (localBlob instanceof Blob) {
      attachments.push({ ...rest, localBlobDataUrl: await blobToDataUrl(localBlob) });
    } else {
      // 不是真正的 Blob（例如经消息传递后变成的空对象），没有可保存的内容
      attachments.push(rest);
    }
  }

  return {
    app: BACKUP_APP_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      folders: snapshot.folders.length,
      tags: snapshot.tags.length,
      prompts: snapshot.prompts.length,
      promptVersions: snapshot.promptVersions.length,
      runs: snapshot.runs.length,
      attachments: attachments.length,
      improvementRequests: snapshot.improvementRequests.length,
    },
    folders: snapshot.folders,
    tags: snapshot.tags,
    prompts: snapshot.prompts,
    promptVersions: snapshot.promptVersions,
    runs: snapshot.runs,
    attachments,
    improvementRequests: snapshot.improvementRequests,
  };
}

export async function getBackupCounts(db: SidecarDB): Promise<BackupCounts> {
  const [folders, tags, prompts, promptVersions, runs, attachments, improvementRequests] = await Promise.all([
    db.folders.count(),
    db.tags.count(),
    db.prompts.count(),
    db.promptVersions.count(),
    db.runs.count(),
    db.attachments.count(),
    db.improvementRequests.count(),
  ]);
  return { folders, tags, prompts, promptVersions, runs, attachments, improvementRequests };
}

/**
 * 安装扩展时系统自动写入的默认数据(见 schema.ts 的 initializeDefaultData):
 * 1 个「未分类」文件夹。它不是用户产生的内容,丢了也没有损失,
 * 所以判断「有没有值得备份的数据」时不能把它算进去,否则刚安装、一条笔记都没有的用户
 * 第一次导入也会被当成「有旧数据」。
 *
 * tags 为 3 是因为早期版本会预置 3 个标签。现在新用户不再预置,但已经装过的老用户库里
 * 仍有这 3 个,所以判断时继续容忍它们,不能改成 0。
 */
export const DEFAULT_SEED_COUNTS = { folders: 1, tags: 3 } as const;

/**
 * 是否有值得在覆盖前备份的用户数据。
 * 有任何笔记及其附属数据就算有。没有笔记时,只有文件夹或标签的数量超过系统默认值才算,
 * 这样以后用户能自己新建文件夹或标签时,这些改动也会被保护起来。
 */
export function hasAnyData(counts: BackupCounts): boolean {
  const content: BackupTable[] = ['prompts', 'promptVersions', 'runs', 'attachments', 'improvementRequests'];
  if (content.some(table => counts[table] > 0)) return true;
  return counts.folders > DEFAULT_SEED_COUNTS.folders || counts.tags > DEFAULT_SEED_COUNTS.tags;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 手动导出的文件名，按本地日期命名 */
export function exportFileName(now: Date = new Date()): string {
  return `riddle-notes-export-${localDate(now)}.json`;
}

/**
 * 覆盖导入前自动备份的文件名。用本地时间并精确到秒，
 * 这样同一天多次导入也不会覆盖之前的备份，文件名里的时间也和用户的时钟一致。
 */
export function safetyBackupFileName(now: Date = new Date()): string {
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  return `riddle-notes-backup-before-import-${localDate(now)}_${time}.json`;
}

/** 触发浏览器下载一个 JSON 文件 */
export function downloadBackupFile(backup: BackupFile, fileName: string): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // 稍后再释放，避免下载还没开始地址就失效
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// 解析与校验
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'date';

interface TableSpec {
  /** 用在错误提示里的名称 */
  label: string;
  /** 必须存在且类型正确的字段。date 表示 ISO 字符串，会被还原为 Date */
  required: Array<[string, FieldType]>;
  /** 可以缺失，但存在时会被还原为 Date 的字段 */
  optionalDates: string[];
}

/**
 * 只校验应用依赖的字段。缺少 updatedAt 的笔记不会出现在列表里（按该字段排序），
 * 缺少 sortOrder 的文件夹也一样，所以这两类字段是必填的。
 */
const TABLE_SPECS: Record<BackupTable, TableSpec> = {
  folders: {
    label: '文件夹',
    required: [['name', 'string'], ['sortOrder', 'number'], ['createdAt', 'date'], ['updatedAt', 'date']],
    optionalDates: [],
  },
  tags: { label: '标签', required: [['name', 'string']], optionalDates: ['createdAt'] },
  prompts: {
    label: '笔记',
    required: [['title', 'string'], ['createdAt', 'date'], ['updatedAt', 'date']],
    optionalDates: [],
  },
  promptVersions: {
    label: '提问内容',
    required: [['promptId', 'number'], ['content', 'string']],
    optionalDates: ['createdAt'],
  },
  runs: {
    label: 'AI 回复',
    required: [['promptId', 'number'], ['outputText', 'string']],
    optionalDates: ['createdAt'],
  },
  attachments: { label: '附件', required: [['runId', 'number']], optionalDates: ['createdAt'] },
  improvementRequests: { label: '改进记录', required: [['promptId', 'number']], optionalDates: ['createdAt'] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reviveDate(row: Record<string, unknown>, field: string, where: string, required: boolean): void {
  const value = row[field];
  if (value === undefined || value === null) {
    if (required) {
      throw new BackupError(`${where}缺少「${field}」`);
    }
    return;
  }
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BackupError(`${where}的「${field}」不是有效的日期`);
  }
  row[field] = date;
}

/**
 * 校验并补全笔记的 uid、type。
 * 旧格式（2.0.0 及以前）的文件里没有这两个字段，而那时只存在 AI 对话笔记，
 * 所以缺少 type 就当作 'ai'，缺少 uid 就现场生成。
 */
function normalizePrompts(rows: Record<string, unknown>[]): void {
  const label = TABLE_SPECS.prompts.label;
  const seenUids = new Set<string>();

  rows.forEach((row, index) => {
    const where = `「${label}」第 ${index + 1} 条`;

    if (row.type === undefined || row.type === null) {
      row.type = 'ai';
    } else if (row.type !== 'ai' && row.type !== 'manual') {
      throw new BackupError(`${where}的类型不正确`);
    }
    if (row.type === 'manual' && typeof row.content !== 'string') {
      throw new BackupError(`${where}是手动笔记，但缺少正文`);
    }

    if (row.uid !== undefined && row.uid !== null) {
      if (typeof row.uid !== 'string' || row.uid === '') {
        throw new BackupError(`${where}的 uid 格式不正确`);
      }
      if (seenUids.has(row.uid)) {
        throw new BackupError(`「${label}」中有重复的 uid ${row.uid}`);
      }
      seenUids.add(row.uid);
    }
  });

  // 文件里已有的 uid 全部登记之后，再给缺少 uid 的笔记生成，避免和后面才出现的 uid 重复
  for (const row of rows) {
    if (row.uid === undefined || row.uid === null) {
      let uid = crypto.randomUUID();
      while (seenUids.has(uid)) uid = crypto.randomUUID();
      seenUids.add(uid);
      row.uid = uid;
    }
  }
}

function readTable(raw: Record<string, unknown>, table: BackupTable): Record<string, unknown>[] {
  const spec = TABLE_SPECS[table];
  const value = raw[table];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BackupError(`备份数据不正确：「${spec.label}」不是列表`);
  }

  const seen = new Set<number>();
  value.forEach((row: unknown, index: number) => {
    const where = `「${spec.label}」第 ${index + 1} 条`;
    if (!isRecord(row)) {
      throw new BackupError(`${where}不是有效的记录`);
    }
    const id = row.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new BackupError(`${where}缺少有效的编号`);
    }
    if (seen.has(id)) {
      throw new BackupError(`「${spec.label}」中有重复的编号 ${id}`);
    }
    seen.add(id);

    for (const [field, type] of spec.required) {
      if (type === 'date') {
        reviveDate(row, field, where, true);
      } else if (typeof row[field] !== type) {
        throw new BackupError(`${where}缺少「${field}」或格式不正确`);
      }
    }
    for (const field of spec.optionalDates) {
      reviveDate(row, field, where, false);
    }
  });
  return value as Record<string, unknown>[];
}

/**
 * 解析并校验备份文件内容。校验不通过会抛出 BackupError，此时不会碰数据库。
 * 同时兼容旧格式（version 1.0.0，没有 app 和 counts，附件的 Blob 被序列化成空对象）。
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('文件不是有效的 JSON，可能已损坏，或者不是 Riddle Notes 的备份文件');
  }
  if (!isRecord(raw)) {
    throw new BackupError('文件内容不是备份数据');
  }
  if (raw.app !== undefined && raw.app !== BACKUP_APP_ID) {
    throw new BackupError('这不是 Riddle Notes 的备份文件');
  }

  if (typeof raw.version !== 'string' || raw.version === '') {
    throw new BackupError('无法识别备份文件的格式版本');
  }
  const major = parseInt(raw.version.split('.')[0], 10);
  if (!Number.isFinite(major) || major < 1) {
    throw new BackupError(`无法识别的备份格式版本：${raw.version}`);
  }
  if (major > SUPPORTED_MAJOR_VERSION) {
    throw new BackupError(`这份备份来自更新版本的 Riddle Notes（格式 ${raw.version}），请先更新扩展再导入`);
  }

  const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : '';
  if (!exportedAt || Number.isNaN(new Date(exportedAt).getTime())) {
    throw new BackupError('备份文件缺少有效的导出时间');
  }
  if (!Array.isArray(raw.prompts)) {
    throw new BackupError('备份数据不完整：缺少笔记列表');
  }

  const rows = {} as Record<BackupTable, Record<string, unknown>[]>;
  for (const table of BACKUP_TABLES) {
    rows[table] = readTable(raw, table);
  }
  normalizePrompts(rows.prompts);

  // 记录数与文件声明的不一致，说明文件被截断或手动改过
  if (isRecord(raw.counts)) {
    for (const table of BACKUP_TABLES) {
      const declared = raw.counts[table];
      if (typeof declared === 'number' && declared !== rows[table].length) {
        throw new BackupError(
          `备份文件不完整：「${TABLE_SPECS[table].label}」应有 ${declared} 条，实际只有 ${rows[table].length} 条。文件可能被截断或手动修改过`
        );
      }
    }
  }

  // 附件：真正的 Blob 从 data URL 还原；旧格式里被序列化成 {} 的 localBlob 没有内容，直接去掉
  for (const attachment of rows.attachments) {
    const dataUrl = attachment.localBlobDataUrl;
    delete attachment.localBlobDataUrl;
    delete attachment.localBlob;
    if (typeof dataUrl === 'string') {
      attachment.localBlob = dataUrlToBlob(dataUrl);
    }
  }

  const counts = {} as BackupCounts;
  for (const table of BACKUP_TABLES) {
    counts[table] = rows[table].length;
  }

  return {
    data: {
      folders: rows.folders as unknown as Folder[],
      tags: rows.tags as unknown as Tag[],
      prompts: rows.prompts as unknown as Prompt[],
      promptVersions: rows.promptVersions as unknown as PromptVersion[],
      runs: rows.runs as unknown as Run[],
      attachments: rows.attachments as unknown as Attachment[],
      improvementRequests: rows.improvementRequests as unknown as ImprovementRequest[],
    },
    preview: {
      version: raw.version,
      exportedAt,
      legacyFormat: raw.app === undefined,
      counts,
      warnings: findOrphans(rows),
    },
  };
}

/** 引用了不存在记录的数据：只警告不拒绝，因为拒绝会让用户连备份都恢复不了 */
function findOrphans(rows: Record<BackupTable, Record<string, unknown>[]>): string[] {
  const ids = (table: BackupTable) => new Set(rows[table].map(row => row.id as number));
  const folderIds = ids('folders');
  const promptIds = ids('prompts');
  const runIds = ids('runs');

  const checks: Array<[string, number]> = [
    ['有笔记所属的文件夹不存在', rows.prompts.filter(p => typeof p.folderId === 'number' && !folderIds.has(p.folderId)).length],
    ['有提问内容找不到对应的笔记', rows.promptVersions.filter(v => !promptIds.has(v.promptId as number)).length],
    ['有 AI 回复找不到对应的笔记', rows.runs.filter(r => !promptIds.has(r.promptId as number)).length],
    ['有附件找不到对应的 AI 回复', rows.attachments.filter(a => !runIds.has(a.runId as number)).length],
  ];
  return checks.filter(([, count]) => count > 0).map(([text, count]) => `${text}（${count} 条），仍会原样导入`);
}

// ---------------------------------------------------------------------------
// 恢复
// ---------------------------------------------------------------------------

/**
 * 用备份数据整体覆盖现有数据。
 * 清空和写入在同一个事务里：任何一步失败，事务回滚，现有数据保持原样。
 */
export async function restoreBackup(db: SidecarDB, data: RestorableData): Promise<void> {
  await db.transaction(
    'rw',
    [db.folders, db.tags, db.prompts, db.promptVersions, db.runs, db.attachments, db.improvementRequests],
    async () => {
      await db.folders.clear();
      await db.tags.clear();
      await db.prompts.clear();
      await db.promptVersions.clear();
      await db.runs.clear();
      await db.attachments.clear();
      await db.improvementRequests.clear();

      if (data.folders.length > 0) await db.folders.bulkAdd(data.folders);
      if (data.tags.length > 0) await db.tags.bulkAdd(data.tags);
      if (data.prompts.length > 0) await db.prompts.bulkAdd(data.prompts);
      if (data.promptVersions.length > 0) await db.promptVersions.bulkAdd(data.promptVersions);
      if (data.runs.length > 0) await db.runs.bulkAdd(data.runs);
      if (data.attachments.length > 0) await db.attachments.bulkAdd(data.attachments);
      if (data.improvementRequests.length > 0) await db.improvementRequests.bulkAdd(data.improvementRequests);
    }
  );
}

// ---------------------------------------------------------------------------
// 展示用文案
// ---------------------------------------------------------------------------

/** 导入前给用户确认的文案。current 是现有数据的统计 */
export function describeImport(preview: BackupPreview, current: BackupCounts): string {
  const lines: string[] = [];
  lines.push('即将导入备份：');
  lines.push(`- 导出时间：${new Date(preview.exportedAt).toLocaleString('zh-CN')}`);
  lines.push(`- 内容：${preview.counts.prompts} 条笔记，${preview.counts.folders} 个文件夹`);
  if (preview.legacyFormat) {
    lines.push('- 这是旧版本导出的备份，可以正常导入');
  }
  for (const warning of preview.warnings) {
    lines.push(`- 注意：${warning}`);
  }
  lines.push('');
  if (hasAnyData(current)) {
    lines.push(`导入会完全覆盖现有数据（${current.prompts} 条笔记，${current.folders} 个文件夹）。`);
    lines.push('导入前会先自动下载一份现有数据的备份。');
  } else {
    lines.push('当前没有数据，会直接导入。');
  }
  lines.push('');
  lines.push('是否继续？');
  return lines.join('\n');
}
