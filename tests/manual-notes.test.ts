/* global crypto, setTimeout */
/**
 * 手动笔记的数据层:新建、编辑、改标题、搜索,以及它们在备份和后台消息里的行为。
 * 使用真实的 Dexie 和内存里的 fake-indexeddb,每个测试开始前重建空库。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import * as N from '../src/shared/notes';
import * as B from '../src/shared/backup';
import { resetDb, snapshotDb } from './helpers/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(async () => {
  await resetDb();
});

/** 一条 AI 对话笔记:prompts + promptVersions + runs,和收藏时写入的结构一致 */
async function addAiNote(opts: { title?: string; prompt?: string; reply?: string } = {}) {
  const now = new Date();
  const promptId = await db.prompts.add({
    uid: crypto.randomUUID(),
    type: 'ai',
    title: opts.title ?? 'AI 笔记',
    description: (opts.prompt ?? '提问').substring(0, 200),
    sourcePlatform: 'chatgpt',
    isFavorite: false,
    folderId: 1,
    createdAt: now,
    updatedAt: now,
  });
  const versionId = await db.promptVersions.add({
    promptId,
    versionNumber: 1,
    content: opts.prompt ?? '提问',
    createdAt: now,
  });
  await db.runs.add({
    promptId,
    promptVersionId: versionId,
    inputText: opts.prompt ?? '提问',
    outputText: opts.reply ?? '回复',
    sourcePlatform: 'chatgpt',
    createdAt: now,
  });
  return promptId;
}

describe('新建手动笔记', () => {
  it('存为 type=manual,带 uid,默认进「未分类」,只写 prompts 一张表', async () => {
    const id = await N.createManualNote({ title: '会议记录', content: '今天讨论了排期' });
    const note = (await db.prompts.get(id))!;

    expect(note.type).toBe('manual');
    expect(note.uid).toMatch(UUID);
    expect(note.title).toBe('会议记录');
    expect(note.content).toBe('今天讨论了排期');
    expect(note.description).toBe('今天讨论了排期');
    expect(note.sourcePlatform).toBe('manual');
    expect(note.folderId).toBe(1);
    expect(note.isFavorite).toBe(false);
    expect(note.createdAt).toBeInstanceOf(Date);
    expect(note.updatedAt).toBeInstanceOf(Date);

    expect(await db.promptVersions.count()).toBe(0);
    expect(await db.runs.count()).toBe(0);
  });

  it('每条笔记的 uid 都不同', async () => {
    const a = await N.createManualNote({ content: 'a' });
    const b = await N.createManualNote({ content: 'b' });
    expect((await db.prompts.get(a))!.uid).not.toBe((await db.prompts.get(b))!.uid);
  });

  it('标题留空:取正文第一个非空行', async () => {
    const id = await N.createManualNote({ title: '   ', content: '\n\n  第一行内容  \n第二行' });
    expect((await db.prompts.get(id))!.title).toBe('第一行内容');
  });

  it('标题和摘要过长时截断,和 AI 笔记的做法一致', async () => {
    const long = '字'.repeat(300);
    const id = await N.createManualNote({ content: long });
    const note = (await db.prompts.get(id))!;
    expect(note.title).toBe('字'.repeat(50) + '...');
    expect(note.description).toBe('字'.repeat(200) + '...');
    expect(note.content).toBe(long);
  });

  it('只有标题没有正文:允许', async () => {
    const id = await N.createManualNote({ title: '待办', content: '' });
    expect((await db.prompts.get(id))!.title).toBe('待办');
  });

  it('标题和正文都为空(含只有空白):拒绝,不写入任何数据', async () => {
    await expect(N.createManualNote({ title: '', content: '' })).rejects.toThrow(N.NoteError);
    await expect(N.createManualNote({ title: '  ', content: ' \n\t ' })).rejects.toThrow('标题和正文不能都为空');
    expect(await db.prompts.count()).toBe(0);
  });

  it('正文保持用户输入的原样,不被修剪', async () => {
    const content = '  缩进保留\n\n\n空行保留  ';
    const id = await N.createManualNote({ content });
    expect((await db.prompts.get(id))!.content).toBe(content);
  });
});

describe('编辑手动笔记', () => {
  it('直接覆盖:内容、标题、摘要、更新时间变化,创建时间和 uid 不变,不产生版本记录', async () => {
    const id = await N.createManualNote({ title: '旧标题', content: '旧正文' });
    const before = (await db.prompts.get(id))!;
    await new Promise(r => setTimeout(r, 5));

    await N.updateManualNote(id, { title: '新标题', content: '新正文' });
    const after = (await db.prompts.get(id))!;

    expect(after.title).toBe('新标题');
    expect(after.content).toBe('新正文');
    expect(after.description).toBe('新正文');
    expect(after.uid).toBe(before.uid);
    expect(after.type).toBe('manual');
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(await db.promptVersions.count()).toBe(0);
  });

  it('更新后笔记排到列表最前(列表按更新时间倒序)', async () => {
    const first = await N.createManualNote({ content: '先建的' });
    await new Promise(r => setTimeout(r, 5));
    await N.createManualNote({ content: '后建的' });
    await new Promise(r => setTimeout(r, 5));

    await N.updateManualNote(first, { content: '先建的,改过' });
    const list = await db.prompts.orderBy('updatedAt').reverse().toArray();
    expect(list[0].id).toBe(first);
  });

  it('标题清空:按新正文重新取标题', async () => {
    const id = await N.createManualNote({ title: '手写的标题', content: '旧' });
    await N.updateManualNote(id, { title: '', content: '全新的第一行\n第二行' });
    expect((await db.prompts.get(id))!.title).toBe('全新的第一行');
  });

  it('改成全空:拒绝,原笔记不变', async () => {
    const id = await N.createManualNote({ title: '标题', content: '正文' });
    const before = await db.prompts.get(id);
    await expect(N.updateManualNote(id, { title: '', content: '  ' })).rejects.toThrow('标题和正文不能都为空');
    expect(await db.prompts.get(id)).toEqual(before);
  });

  it('AI 对话笔记不能编辑内容:拒绝,提问、回复、标题都不变', async () => {
    const id = await addAiNote({ title: '原标题', prompt: '原提问', reply: '原回复' });
    const before = await snapshotDb();

    await expect(N.updateManualNote(id, { title: '改了', content: '改了' })).rejects.toThrow('不能编辑');
    expect(await snapshotDb()).toEqual(before);
  });

  it('没有 type 的旧笔记按 AI 笔记处理:也不能编辑', async () => {
    const id = await db.prompts.add({
      title: '旧', sourcePlatform: 'chatgpt', isFavorite: false, createdAt: new Date(), updatedAt: new Date(),
    });
    await expect(N.updateManualNote(id, { content: 'x' })).rejects.toThrow(N.NoteError);
  });

  it('笔记不存在:报错,不新建', async () => {
    await expect(N.updateManualNote(999, { content: 'x' })).rejects.toThrow('笔记不存在');
    expect(await db.prompts.count()).toBe(0);
  });
});

describe('修改标题', () => {
  it('AI 笔记可以改标题,提问和回复保持原文', async () => {
    const id = await addAiNote({ title: '原标题', prompt: '原提问', reply: '原回复' });
    const versionsBefore = await db.promptVersions.toArray();
    const runsBefore = await db.runs.toArray();
    const before = (await db.prompts.get(id))!;
    await new Promise(r => setTimeout(r, 5));

    await N.updateNoteTitle(id, '  新标题  ');
    const after = (await db.prompts.get(id))!;

    expect(after.title).toBe('新标题');
    expect(after.description).toBe(before.description);
    expect(after.type).toBe('ai');
    expect(after.uid).toBe(before.uid);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(await db.promptVersions.toArray()).toEqual(versionsBefore);
    expect(await db.runs.toArray()).toEqual(runsBefore);
  });

  it('手动笔记改标题:正文不变', async () => {
    const id = await N.createManualNote({ title: '旧', content: '正文不动' });
    await N.updateNoteTitle(id, '新');
    const note = (await db.prompts.get(id))!;
    expect(note.title).toBe('新');
    expect(note.content).toBe('正文不动');
  });

  it('空标题:拒绝', async () => {
    const id = await addAiNote({ title: '原标题' });
    await expect(N.updateNoteTitle(id, '   ')).rejects.toThrow('标题不能为空');
    expect((await db.prompts.get(id))!.title).toBe('原标题');
  });

  it('笔记不存在:报错', async () => {
    await expect(N.updateNoteTitle(999, '标题')).rejects.toThrow('笔记不存在');
  });
});

describe('搜索', () => {
  it('能搜到手动笔记超出摘要范围的正文(摘要只有前 200 字)', async () => {
    const body = '开头'.repeat(150) + '深处的关键词';
    const id = await N.createManualNote({ title: '长笔记', content: body });
    const note = (await db.prompts.get(id))!;
    expect(note.description).not.toContain('深处的关键词');

    expect([...(await N.findMatchingNoteIds('深处的关键词'))]).toEqual([id]);
  });

  it('能搜到 AI 笔记的提问和 AI 回复正文(以前只能搜标题和摘要)', async () => {
    const id = await addAiNote({
      title: '标题里没有',
      prompt: '摘要里有的提问\n' + '填充'.repeat(150) + '提问深处的词',
      reply: '回复正文里独有的词',
    });
    expect((await N.findMatchingNoteIds('回复正文里独有的词')).has(id)).toBe(true);
    expect((await N.findMatchingNoteIds('提问深处的词')).has(id)).toBe(true);
  });

  it('能搜到标题和摘要', async () => {
    const id = await addAiNote({ title: '独特的标题词', prompt: '普通' });
    expect((await N.findMatchingNoteIds('独特的标题词')).has(id)).toBe(true);
    expect((await N.findMatchingNoteIds('普通')).has(id)).toBe(true);
  });

  it('不区分大小写,首尾空白被忽略', async () => {
    const id = await N.createManualNote({ content: 'Hello World' });
    expect((await N.findMatchingNoteIds('  hello world ')).has(id)).toBe(true);
    expect((await N.findMatchingNoteIds('HELLO')).has(id)).toBe(true);
  });

  it('只返回匹配的笔记,同一条笔记多处命中只算一次', async () => {
    const a = await addAiNote({ title: '苹果', prompt: '苹果提问', reply: '苹果回复' });
    const b = await N.createManualNote({ content: '香蕉' });
    const hits = await N.findMatchingNoteIds('苹果');
    expect([...hits]).toEqual([a]);
    expect(hits.has(b)).toBe(false);
  });

  it('没有命中或查询为空:返回空集合', async () => {
    await N.createManualNote({ content: '内容' });
    expect((await N.findMatchingNoteIds('不存在的词')).size).toBe(0);
    expect((await N.findMatchingNoteIds('')).size).toBe(0);
    expect((await N.findMatchingNoteIds('   ')).size).toBe(0);
  });

  it('空库不报错', async () => {
    expect((await N.findMatchingNoteIds('任何词')).size).toBe(0);
  });
});

describe('备份:手动笔记', () => {
  async function seedMixed() {
    await db.folders.add({ name: '未分类', sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await addAiNote({ title: 'AI 笔记', prompt: '提问', reply: '回复' });
    await N.createManualNote({ title: '手动笔记', content: '第一行\n\n第三行  \n中文、emoji 🙂' });
  }

  it('导出再导入:AI 笔记和手动笔记逐字一致,uid 和 type 保留', async () => {
    await seedMixed();
    const before = await snapshotDb();

    const text = JSON.stringify(await B.createBackup(db));
    await resetDb();
    await B.restoreBackup(db, B.parseBackup(text).data);
    const after = await snapshotDb();

    expect(after).toEqual(before);
    const manual = after.prompts.find(p => p.type === 'manual')!;
    expect(manual.content).toBe('第一行\n\n第三行  \n中文、emoji 🙂');
    expect(manual.uid).toMatch(UUID);
    expect(manual.createdAt).toBeInstanceOf(Date);
    expect(after.prompts.find(p => p.type === 'ai')!.uid).toMatch(UUID);
  });

  it('预览统计:手动笔记计入笔记数,没有提问和回复也不会被当成孤儿数据', async () => {
    await seedMixed();
    const parsed = B.parseBackup(JSON.stringify(await B.createBackup(db)));
    expect(parsed.preview.counts).toMatchObject({ prompts: 2, promptVersions: 1, runs: 1 });
    expect(parsed.preview.warnings).toEqual([]);
  });

  it('导出文件的格式版本是 2.1.0,主版本仍是 2', async () => {
    const backup = await B.createBackup(db);
    expect(backup.version).toBe('2.1.0');
    expect(B.parseBackup(JSON.stringify(backup)).preview.version).toBe('2.1.0');
  });

  describe('旧格式文件(没有 uid 和 type)', () => {
    const t = '2026-11-01T00:00:00.000Z';
    const oldFile = (version: string, extra: Record<string, unknown> = {}) => ({
      version,
      exportedAt: t,
      ...extra,
      folders: [{ id: 1, name: '未分类', sortOrder: 0, createdAt: t, updatedAt: t }],
      tags: [],
      prompts: [
        { id: 1, title: '甲', description: 'd', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: false, createdAt: t, updatedAt: t },
        { id: 2, title: '乙', description: 'd', folderId: 1, sourcePlatform: 'claude', isFavorite: false, createdAt: t, updatedAt: t },
      ],
      promptVersions: [],
      runs: [],
      attachments: [],
    });

    it.each([
      ['1.0.0 的文件', oldFile('1.0.0')],
      ['2.0.0 的文件', oldFile('2.0.0', { app: 'riddle-notes' })],
    ])('%s:导入后每条笔记都有唯一的 uid,type 是 ai', async (_name, file) => {
      const parsed = B.parseBackup(JSON.stringify(file));
      await B.restoreBackup(db, parsed.data);

      const prompts = await db.prompts.toArray();
      expect(prompts).toHaveLength(2);
      expect(prompts.every(p => p.type === 'ai')).toBe(true);
      expect(prompts.every(p => UUID.test(p.uid ?? ''))).toBe(true);
      expect(new Set(prompts.map(p => p.uid)).size).toBe(2);
    });

    it('同一份旧文件导入两次,每次生成不同的 uid(不会冲突,也不会假装是同一条)', async () => {
      const text = JSON.stringify(oldFile('1.0.0'));
      const first = B.parseBackup(text).data.prompts.map(p => p.uid);
      const second = B.parseBackup(text).data.prompts.map(p => p.uid);
      expect(first.some((uid, i) => uid === second[i])).toBe(false);
    });

    it('文件里已有 uid 的笔记保留原值,只给缺少的补', async () => {
      const file = oldFile('2.0.0', { app: 'riddle-notes' });
      (file.prompts[0] as any).uid = 'keep-me';
      const parsed = B.parseBackup(JSON.stringify(file));
      expect(parsed.data.prompts[0].uid).toBe('keep-me');
      expect(parsed.data.prompts[1].uid).toMatch(UUID);
    });
  });

  describe('不合法的新字段被拒绝', () => {
    const t = '2026-11-01T00:00:00.000Z';
    const fileWith = (prompts: any[]) =>
      JSON.stringify({
        app: 'riddle-notes', version: '2.1.0', exportedAt: t,
        folders: [], tags: [], promptVersions: [], runs: [], attachments: [], improvementRequests: [],
        prompts: prompts.map((p, i) => ({ id: i + 1, title: 't', sourcePlatform: 'manual', isFavorite: false, createdAt: t, updatedAt: t, ...p })),
      });

    it('type 不是 ai 或 manual', () => {
      expect(() => B.parseBackup(fileWith([{ type: 'weird' }]))).toThrow('类型不正确');
    });

    it('手动笔记缺少正文', () => {
      expect(() => B.parseBackup(fileWith([{ type: 'manual' }]))).toThrow('缺少正文');
      expect(() => B.parseBackup(fileWith([{ type: 'manual', content: 123 }]))).toThrow('缺少正文');
    });

    it('手动笔记的正文可以是空字符串(只有标题的笔记)', () => {
      expect(() => B.parseBackup(fileWith([{ type: 'manual', content: '' }]))).not.toThrow();
    });

    it('uid 重复', () => {
      expect(() => B.parseBackup(fileWith([{ uid: 'x' }, { uid: 'x' }]))).toThrow('重复的 uid');
    });

    it('uid 不是非空字符串', () => {
      expect(() => B.parseBackup(fileWith([{ uid: 5 }]))).toThrow('uid 格式不正确');
      expect(() => B.parseBackup(fileWith([{ uid: '' }]))).toThrow('uid 格式不正确');
    });

    it('被拒绝的文件不会碰数据库(解析在写入之前)', async () => {
      await seedMixed();
      const before = await snapshotDb();
      expect(() => B.parseBackup(fileWith([{ uid: 'x' }, { uid: 'x' }]))).toThrow(B.BackupError);
      expect(await snapshotDb()).toEqual(before);
    });
  });

  it('只有手动笔记的库,覆盖前也会被当成有数据而备份', async () => {
    await N.createManualNote({ content: '只有这一条' });
    expect(B.hasAnyData(await B.getBackupCounts(db))).toBe(true);
  });
});

describe('后台消息:保存和删除(真实的 service-worker.ts)', () => {
  type Send = (message: unknown) => Promise<any>;
  let send: Send;

  beforeEach(async () => {
    const runtime = (globalThis as any).chrome.runtime;
    runtime.onInstalled = { addListener: vi.fn() };
    runtime.onMessage.addListener.mockClear();

    vi.resetModules();
    // service-worker.ts 在导入时注册监听器,这里取出它注册的函数来驱动
    await import('../src/background/service-worker');
    const listener = runtime.onMessage.addListener.mock.calls[0][0];
    send = (message: unknown) => new Promise(resolve => listener(message, {}, resolve));
  });

  const save = (promptText = '提问内容', outputText = '回复内容') =>
    send({
      type: 'SAVE_PROMPT',
      payload: { promptText, outputText, sourcePlatform: 'chatgpt', conversationUrl: 'https://chatgpt.com/c/1' },
    });

  it('收藏一段对话:笔记带 uid 和 type=ai,提问和回复照常写入', async () => {
    // 用同一份模块实例读取:resetModules 之后 db 是新实例,但指向同一个内存库
    const { db: freshDb } = await import('../src/db/schema');
    const res = await save('怎么煮面', '先烧水');
    expect(res.success).toBe(true);

    const note = (await freshDb.prompts.get(res.data.promptId))!;
    expect(note.type).toBe('ai');
    expect(note.uid).toMatch(UUID);
    expect(note.title).toBe('怎么煮面');
    expect((await freshDb.promptVersions.toArray())[0].content).toBe('怎么煮面');
    expect((await freshDb.runs.toArray())[0].outputText).toBe('先烧水');
  });

  it('连续收藏:每条的 uid 不同', async () => {
    const { db: freshDb } = await import('../src/db/schema');
    await save('一');
    await save('二');
    const uids = (await freshDb.prompts.toArray()).map(p => p.uid);
    expect(new Set(uids).size).toBe(2);
  });

  it('删除手动笔记:这条被删掉,别的笔记(包括它们的提问和回复)原样保留', async () => {
    const { db: freshDb } = await import('../src/db/schema');
    const N2 = await import('../src/shared/notes');
    const ai = await save('要保留的提问', '要保留的回复');
    const manualId = await N2.createManualNote({ title: '要删的', content: '正文' }, freshDb);
    const before = {
      versions: await freshDb.promptVersions.toArray(),
      runs: await freshDb.runs.toArray(),
    };

    const res = await send({ type: 'DELETE_PROMPT', payload: { promptId: manualId } });
    expect(res.success).toBe(true);

    expect(await freshDb.prompts.get(manualId)).toBeUndefined();
    expect(await freshDb.prompts.get(ai.data.promptId)).toBeDefined();
    expect(await freshDb.promptVersions.toArray()).toEqual(before.versions);
    expect(await freshDb.runs.toArray()).toEqual(before.runs);
  });

  it('删除 AI 笔记:提问、回复一并删除,手动笔记不受影响', async () => {
    const { db: freshDb } = await import('../src/db/schema');
    const N2 = await import('../src/shared/notes');
    const ai = await save('提问', '回复');
    const manualId = await N2.createManualNote({ content: '手动的' }, freshDb);
    const manualBefore = await freshDb.prompts.get(manualId);

    await send({ type: 'DELETE_PROMPT', payload: { promptId: ai.data.promptId } });

    expect(await freshDb.prompts.get(ai.data.promptId)).toBeUndefined();
    expect(await freshDb.promptVersions.count()).toBe(0);
    expect(await freshDb.runs.count()).toBe(0);
    expect(await freshDb.prompts.get(manualId)).toEqual(manualBefore);
  });
});
