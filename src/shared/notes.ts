/* global crypto */
/**
 * 笔记的新建、编辑和搜索
 *
 * 手动笔记只有 prompts 一条记录：正文存在 content 字段里，没有 promptVersions 和 runs。
 * AI 对话笔记的提问和回复保持原文，只允许修改标题。
 */
import { db as defaultDb } from '../db/schema';
import type { SidecarDB } from '../db/schema';

export const MANUAL_PLATFORM = 'manual';

/** 手动笔记和 AI 笔记一样默认存入「未分类」（见 schema.ts 的 initializeDefaultData） */
const DEFAULT_FOLDER_ID = 1;
const TITLE_MAX_LENGTH = 50;
const DESCRIPTION_MAX_LENGTH = 200;

/** 面向用户的错误，message 可以直接展示 */
export class NoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteError';
  }
}

export interface ManualNoteInput {
  /** 留空时取正文的第一个非空行 */
  title?: string;
  content: string;
}

function truncate(text: string, max: number): string {
  return text.substring(0, max) + (text.length > max ? '...' : '');
}

/** 标题：优先用用户填的，留空则取正文第一个非空行 */
export function deriveTitle(title: string | undefined, content: string): string {
  const explicit = (title ?? '').trim();
  if (explicit) return truncate(explicit, TITLE_MAX_LENGTH);

  const firstLine = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);
  return truncate(firstLine ?? '', TITLE_MAX_LENGTH);
}

/** 摘要：正文开头，和 AI 笔记的做法一致 */
export function deriveDescription(content: string): string {
  return truncate(content.trim(), DESCRIPTION_MAX_LENGTH);
}

function requireSomeText(input: ManualNoteInput): void {
  if (!(input.title ?? '').trim() && !input.content.trim()) {
    throw new NoteError('标题和正文不能都为空');
  }
}

export async function createManualNote(
  input: ManualNoteInput,
  database: SidecarDB = defaultDb
): Promise<number> {
  requireSomeText(input);

  const now = new Date();
  return database.prompts.add({
    uid: crypto.randomUUID(),
    type: 'manual',
    title: deriveTitle(input.title, input.content),
    description: deriveDescription(input.content),
    content: input.content,
    sourcePlatform: MANUAL_PLATFORM,
    isFavorite: false,
    folderId: DEFAULT_FOLDER_ID,
    createdAt: now,
    updatedAt: now,
  });
}

/** 编辑手动笔记。直接覆盖，不保留历史 */
export async function updateManualNote(
  id: number,
  input: ManualNoteInput,
  database: SidecarDB = defaultDb
): Promise<void> {
  requireSomeText(input);

  const existing = await database.prompts.get(id);
  if (!existing) {
    throw new NoteError('笔记不存在，可能已被删除');
  }
  if (existing.type !== 'manual') {
    throw new NoteError('AI 对话笔记的内容是收藏时的原文，不能编辑');
  }

  await database.prompts.update(id, {
    title: deriveTitle(input.title, input.content),
    description: deriveDescription(input.content),
    content: input.content,
    updatedAt: new Date(),
  });
}

/** 修改标题，对两种笔记都可用。AI 笔记的提问和回复不受影响 */
export async function updateNoteTitle(
  id: number,
  title: string,
  database: SidecarDB = defaultDb
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new NoteError('标题不能为空');
  }

  const updated = await database.prompts.update(id, {
    title: truncate(trimmed, TITLE_MAX_LENGTH),
    updatedAt: new Date(),
  });
  if (updated === 0) {
    throw new NoteError('笔记不存在，可能已被删除');
  }
}

/**
 * 搜索：返回匹配的笔记 id。匹配范围是标题、摘要、手动笔记的正文，
 * 以及 AI 笔记的提问和回复。不区分大小写。
 *
 * 用游标逐条扫描，不把全部正文一次读进内存，也不在笔记上冗余保存搜索文本。
 */
export async function findMatchingNoteIds(
  query: string,
  database: SidecarDB = defaultDb
): Promise<Set<number>> {
  const needle = query.trim().toLowerCase();
  const matched = new Set<number>();
  if (!needle) return matched;

  const has = (text: string | undefined) => !!text && text.toLowerCase().includes(needle);

  await database.prompts.each(prompt => {
    if (has(prompt.title) || has(prompt.description) || has(prompt.content)) {
      matched.add(prompt.id!);
    }
  });
  await database.promptVersions.each(version => {
    if (has(version.content)) matched.add(version.promptId);
  });
  await database.runs.each(run => {
    if (has(run.outputText)) matched.add(run.promptId);
  });

  return matched;
}
