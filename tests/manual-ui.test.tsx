/**
 * 4a. 手动笔记管理界面测试
 * 主要测试业务逻辑，组件渲染依赖真实浏览器环境
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createManualNote, updateManualNote, NoteError } from '../src/shared/notes';
import { db } from '../src/db/schema';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

describe('手动笔记创建', () => {
  it('标题留空时，自动取正文第一行', async () => {
    const noteId = await createManualNote({
      title: '',
      content: '第一行\n第二行',
    });

    const note = await db.prompts.get(noteId);
    expect(note?.title).toBe('第一行');
    expect(note?.content).toBe('第一行\n第二行');
    expect(note?.type).toBe('manual');
    expect(note?.sourcePlatform).toBe('manual');
  });

  it('标题和正文都为空时，抛出 NoteError', async () => {
    await expect(createManualNote({ title: '', content: '' })).rejects.toThrow(
      '标题和正文不能都为空'
    );
  });

  it('创建时自动设置 uid 和 type', async () => {
    const noteId = await createManualNote({
      title: '测试',
      content: '内容',
    });

    const note = await db.prompts.get(noteId);
    expect(note?.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(note?.type).toBe('manual');
  });

  it('描述自动取正文开头', async () => {
    const longContent = 'A'.repeat(250);
    const noteId = await createManualNote({
      title: '测试',
      content: longContent,
    });

    const note = await db.prompts.get(noteId);
    expect(note?.description).toHaveLength(203); // 200 + '...'
    expect(note?.description?.endsWith('...')).toBe(true);
  });
});

describe('手动笔记编辑', () => {
  it('更新标题和正文', async () => {
    const noteId = await createManualNote({
      title: '旧标题',
      content: '旧内容',
    });

    const original = await db.prompts.get(noteId);

    await updateManualNote(noteId, {
      title: '新标题',
      content: '新内容',
    });

    const note = await db.prompts.get(noteId);
    expect(note?.title).toBe('新标题');
    expect(note?.content).toBe('新内容');
    expect(note?.updatedAt.getTime()).toBeGreaterThanOrEqual(original!.createdAt.getTime());
  });

  it('编辑 AI 笔记时抛出错误', async () => {
    const now = new Date();
    const aiNoteId = await db.prompts.add({
      uid: crypto.randomUUID(),
      type: 'ai',
      title: 'AI 对话',
      sourcePlatform: 'chatgpt',
      isFavorite: false,
      folderId: 1,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      updateManualNote(aiNoteId, { title: '尝试修改', content: '新内容' })
    ).rejects.toThrow('AI 对话笔记的内容是收藏时的原文，不能编辑');
  });

  it('编辑不存在的笔记时抛出错误', async () => {
    await expect(
      updateManualNote(999, { title: '标题', content: '内容' })
    ).rejects.toThrow('笔记不存在，可能已被删除');
  });
});

describe('手动笔记筛选', () => {
  it('type=manual 时只返回手动笔记', async () => {
    await createManualNote({ title: '手动笔记 1', content: 'content1' });
    await createManualNote({ title: '手动笔记 2', content: 'content2' });

    const now = new Date();
    await db.prompts.add({
      uid: crypto.randomUUID(),
      type: 'ai',
      title: 'AI 笔记',
      sourcePlatform: 'chatgpt',
      isFavorite: false,
      folderId: 1,
      createdAt: now,
      updatedAt: now,
    });

    const allPrompts = await db.prompts.toArray();
    expect(allPrompts).toHaveLength(3);

    const manualOnly = await db.prompts.where('type').equals('manual').toArray();
    expect(manualOnly).toHaveLength(2);
    expect(manualOnly.every(p => p.type === 'manual')).toBe(true);
  });

  it('手动笔记的 sourcePlatform 为 "manual"', async () => {
    const noteId = await createManualNote({
      title: '手动笔记',
      content: '测试',
    });

    const note = await db.prompts.get(noteId);
    expect(note?.sourcePlatform).toBe('manual');
  });
});

describe('手动笔记数据结构', () => {
  it('手动笔记只有 prompts 表记录，没有 versions 和 runs', async () => {
    const noteId = await createManualNote({
      title: '手动笔记',
      content: '正文存在 prompts.content 字段',
    });

    const note = await db.prompts.get(noteId);
    expect(note?.content).toBe('正文存在 prompts.content 字段');

    const versions = await db.promptVersions.where('promptId').equals(noteId).toArray();
    const runs = await db.runs.where('promptId').equals(noteId).toArray();

    expect(versions).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it('AI 笔记有 promptVersions 和 runs，content 字段为空', async () => {
    const now = new Date();
    const aiNoteId = await db.prompts.add({
      uid: crypto.randomUUID(),
      type: 'ai',
      title: 'AI 对话',
      description: '摘要',
      sourcePlatform: 'chatgpt',
      isFavorite: false,
      folderId: 1,
      createdAt: now,
      updatedAt: now,
    });

    await db.promptVersions.add({
      promptId: aiNoteId,
      content: '提问内容',
      versionNumber: 1,
      createdAt: now,
    });

    await db.runs.add({
      promptId: aiNoteId,
      promptVersionId: 1,
      outputText: 'AI 回复',
      createdAt: now,
    });

    const note = await db.prompts.get(aiNoteId);
    expect(note?.content).toBeUndefined();

    const versions = await db.promptVersions.where('promptId').equals(aiNoteId).toArray();
    const runs = await db.runs.where('promptId').equals(aiNoteId).toArray();

    expect(versions).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });
});
