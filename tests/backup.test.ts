/**
 * 备份与恢复(src/shared/backup.ts)的测试。
 *
 * 使用真实的 Dexie 和内存里的 fake-indexeddb(见 tests/setup.ts),
 * 每个测试开始前用 resetDb() 重建空库,互不影响。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';
import * as B from '../src/shared/backup';
import { resetDb, snapshotDb, TABLE_NAMES } from './helpers/db';

const d = (s: string) => new Date(s);

function seedRows() {
  const t1 = d('2026-11-01T08:00:00.000Z');
  const t2 = d('2026-11-05T09:30:00.000Z');
  const t3 = d('2026-11-10T12:00:00.000Z');
  return {
    folders: [
      { id: 1, name: '未分类', sortOrder: 0, createdAt: t1, updatedAt: t1 },
      { id: 2, name: '工作', sortOrder: 1, createdAt: t1, updatedAt: t2 },
    ],
    tags: [
      { id: 1, name: '高频使用', createdAt: t1 },
      { id: 2, name: '待改进', createdAt: t1 },
    ],
    prompts: [
      { id: 1, title: '第一条', description: '摘要一', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: true, createdAt: t1, updatedAt: t1, tags: [1, 2] },
      { id: 2, title: '第二条', description: '摘要二', folderId: 2, sourcePlatform: 'claude', isFavorite: false, createdAt: t2, updatedAt: t2 },
      { id: 3, title: '第三条', description: '摘要三', folderId: 1, sourcePlatform: 'gemini', isFavorite: false, createdAt: t3, updatedAt: t3 },
    ],
    promptVersions: [
      { id: 1, promptId: 1, versionNumber: 1, content: '提问一', changeNote: '初始版本', createdAt: t1 },
      { id: 2, promptId: 1, versionNumber: 2, content: '提问一(改)', changeNote: '第二版', createdAt: t2 },
      { id: 3, promptId: 2, versionNumber: 1, content: '提问二', createdAt: t2 },
      { id: 4, promptId: 3, versionNumber: 1, content: '提问三', createdAt: t3 },
    ],
    runs: [
      { id: 1, promptId: 1, promptVersionId: 2, inputText: '提问一', outputText: '回复一\n第二行\n第三行', sourcePlatform: 'chatgpt', conversationUrl: 'https://chatgpt.com/c/1', rating: 2, createdAt: t1 },
      { id: 2, promptId: 2, promptVersionId: 3, inputText: '提问二', outputText: '回复二', sourcePlatform: 'claude', createdAt: t2 },
      { id: 3, promptId: 3, promptVersionId: 4, inputText: '提问三', outputText: '回复三', sourcePlatform: 'gemini', createdAt: t3 },
    ],
    attachments: [{ id: 1, runId: 1, name: 'a.png', mimeType: 'image/png', sourceUrl: 'https://x/a.png', createdAt: t1 }],
    improvementRequests: [{ id: 1, promptId: 1, sourceRunId: 1, status: 'pending', createdAt: t1 }],
  };
}

async function seed(rows: Partial<ReturnType<typeof seedRows>> = seedRows()) {
  for (const name of TABLE_NAMES) {
    const r = (rows as any)[name];
    if (r?.length) await (db as any)[name].bulkAdd(r);
  }
}

/** 旧版本(1.0.0)导出的文件:没有 app 和 counts,日期是字符串,附件的 Blob 被序列化成了 {} */
const legacyFile = () => ({
  version: '1.0.0',
  exportedAt: '2026-11-09T00:00:00.000Z',
  folders: [{ id: 1, name: '未分类', sortOrder: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }],
  tags: [],
  prompts: [
    { id: 1, title: '旧笔记', description: 'd', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
  ],
  promptVersions: [{ id: 1, promptId: 1, versionNumber: 1, content: 'q', createdAt: '2026-11-01T00:00:00.000Z' }],
  runs: [{ id: 1, promptId: 1, promptVersionId: 1, inputText: 'q', outputText: 'a', sourcePlatform: 'chatgpt', createdAt: '2026-11-01T00:00:00.000Z' }],
  attachments: [{ id: 1, runId: 1, name: 'f.txt', mimeType: 'text/plain', localBlob: {}, createdAt: '2026-11-01T00:00:00.000Z' }],
});

beforeEach(async () => {
  await resetDb();
});

describe('测试环境隔离', () => {
  it('每个测试开始时数据库都是空的(上一个测试写入的数据不会残留)', async () => {
    expect(B.hasAnyData(await B.getBackupCounts(db))).toBe(false);
    await seed();
    expect((await B.getBackupCounts(db)).prompts).toBe(3);
  });

  it('同样是空的:即使上一个测试刚写入过数据', async () => {
    expect(B.hasAnyData(await B.getBackupCounts(db))).toBe(false);
  });
});

describe('导出再导入:数据完整一致', () => {
  it('所有表往返后与原数据完全相同,日期是 Date', async () => {
    await seed();
    const before = await snapshotDb();

    const text = JSON.stringify(await B.createBackup(db));
    await resetDb();
    expect((await B.getBackupCounts(db)).prompts).toBe(0);

    await B.restoreBackup(db, B.parseBackup(text).data);
    const after = await snapshotDb();

    expect(after).toEqual(before);
    for (const p of after.prompts) {
      expect(p.createdAt).toBeInstanceOf(Date);
      expect(p.updatedAt).toBeInstanceOf(Date);
    }
    expect(after.runs[0].outputText).toBe('回复一\n第二行\n第三行');
    expect(after.improvementRequests).toHaveLength(1);
  });

  it('导出内容:有 app、version、counts,并满足旧版导入器的检查', async () => {
    await seed();
    const b = await B.createBackup(db);
    expect(b.app).toBe('riddle-notes');
    expect(b.version).toBe(B.BACKUP_FORMAT_VERSION);
    expect(b.counts).toEqual({ folders: 2, tags: 2, prompts: 3, promptVersions: 4, runs: 3, attachments: 1, improvementRequests: 1 });
    // 旧版本扩展的导入器只检查这三项
    expect(b.version).toBeTruthy();
    expect(b.exportedAt).toBeTruthy();
    expect(Array.isArray(b.prompts)).toBe(true);
  });

  it('空数据库也能导出并导入', async () => {
    const parsed = B.parseBackup(JSON.stringify(await B.createBackup(db)));
    expect(parsed.preview.counts.prompts).toBe(0);
    await B.restoreBackup(db, parsed.data);
    expect((await B.getBackupCounts(db)).prompts).toBe(0);
  });

  it('导出和导入互不污染:导入不会保留导入前的数据', async () => {
    await seed();
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    await B.restoreBackup(db, parsed.data);
    const after = await snapshotDb();
    expect(after.prompts.map(p => p.title)).toEqual(['旧笔记']);
    expect(after.tags).toEqual([]);
    expect(after.improvementRequests).toEqual([]);
  });
});

describe('旧格式兼容', () => {
  it('旧版本导出的文件可以导入:日期还原,空 localBlob 被去掉', async () => {
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    expect(parsed.preview.legacyFormat).toBe(true);
    expect(parsed.preview.version).toBe('1.0.0');
    expect(parsed.preview.counts.prompts).toBe(1);

    await B.restoreBackup(db, parsed.data);
    const snap = await snapshotDb();
    expect(snap.prompts[0].createdAt).toBeInstanceOf(Date);
    expect(snap.prompts[0].updatedAt).toBeInstanceOf(Date);
    expect(snap.folders[0].createdAt).toBeInstanceOf(Date);
    expect('localBlob' in snap.attachments[0]).toBe(false);
    expect(snap.improvementRequests).toEqual([]);
  });

  it('回归:导入旧文件后,新收集的笔记仍排在最前面', async () => {
    await B.restoreBackup(db, B.parseBackup(JSON.stringify(legacyFile())).data);
    await db.prompts.add({ title: '刚收集的', sourcePlatform: 'chatgpt', isFavorite: false, createdAt: new Date(), updatedAt: new Date() });
    const list = await db.prompts.orderBy('updatedAt').reverse().toArray();
    expect(list[0].title).toBe('刚收集的');
  });

  it('对照:日期若保留为字符串(旧的导入方式),新笔记会被排到旧笔记后面', async () => {
    // IndexedDB 的键排序里 Date 排在字符串之前,所以按 updatedAt 倒序时字符串排在前面
    await db.prompts.bulkAdd(legacyFile().prompts as any);
    await db.prompts.add({ title: '刚收集的', sourcePlatform: 'chatgpt', isFavorite: false, createdAt: new Date(), updatedAt: new Date() });
    const list = await db.prompts.orderBy('updatedAt').reverse().toArray();
    expect(list[0].title).not.toBe('刚收集的');
  });
});

describe('失败时不损坏现有数据', () => {
  it('写入中途失败(AI 回复编号重复):整体回滚,现有数据原样保留', async () => {
    await seed();
    const before = await snapshotDb();
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    // 绕过解析校验,构造一份会在事务中途失败的数据:笔记等表写入成功后,回复表里有重复编号
    const data = { ...parsed.data, runs: [parsed.data.runs[0], { ...parsed.data.runs[0] }] };

    await expect(B.restoreBackup(db, data)).rejects.toThrow();
    expect(await snapshotDb()).toEqual(before);
  });

  it('写入第一张表就失败:同样回滚', async () => {
    await seed();
    const before = await snapshotDb();
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    const data = { ...parsed.data, folders: [parsed.data.folders[0], { ...parsed.data.folders[0] }] };

    await expect(B.restoreBackup(db, data)).rejects.toThrow();
    expect(await snapshotDb()).toEqual(before);
  });

  it('对照:旧的做法(先清空再逐表写入,没有事务)在同样的失败下会丢光数据', async () => {
    await seed();
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    const runs = [parsed.data.runs[0], { ...parsed.data.runs[0] }];

    // 旧实现的做法
    await db.folders.clear();
    await db.tags.clear();
    await db.prompts.clear();
    await db.promptVersions.clear();
    await db.runs.clear();
    await db.attachments.clear();
    await db.folders.bulkAdd(parsed.data.folders);
    await db.prompts.bulkAdd(parsed.data.prompts);
    await expect(db.runs.bulkAdd(runs)).rejects.toThrow();

    // 原来的 3 条笔记和标签已经没了,回不来
    const counts = await B.getBackupCounts(db);
    expect(counts.prompts).toBe(1);
    expect(counts.tags).toBe(0);
  });
});

describe('损坏或不合法的文件被拒绝,且不碰数据库', () => {
  const cases: Array<[string, (v: any) => any, string]> = [
    ['不是 JSON', () => 'not json {', '不是有效的 JSON'],
    ['JSON 但不是对象', () => '[1,2,3]', '不是备份数据'],
    ['来自别的应用', v => ({ ...v, app: 'other-app' }), '不是 Riddle Notes 的备份文件'],
    ['缺少 version', v => { delete v.version; return v; }, '无法识别备份文件的格式版本'],
    ['version 不是数字', v => ({ ...v, version: 'abc' }), '无法识别的备份格式版本'],
    ['来自更新版本的格式', v => ({ ...v, version: '3.0.0' }), '更新版本'],
    ['缺少 exportedAt', v => { delete v.exportedAt; return v; }, '导出时间'],
    ['exportedAt 无效', v => ({ ...v, exportedAt: 'yesterday' }), '导出时间'],
    ['prompts 不是数组', v => ({ ...v, prompts: {} }), '缺少笔记列表'],
    ['tags 不是列表', v => ({ ...v, tags: 'x' }), '不是列表'],
    ['文件被截断(记录数与 counts 不符)', v => { v.prompts.pop(); return v; }, '备份文件不完整'],
    ['笔记缺少 title', v => { delete v.prompts[0].title; return v; }, '缺少「title」'],
    ['笔记缺少 updatedAt', v => { delete v.prompts[0].updatedAt; return v; }, '缺少「updatedAt」'],
    ['日期无效', v => { v.prompts[0].createdAt = 'not-a-date'; return v; }, '不是有效的日期'],
    ['编号重复', v => { v.prompts[1].id = v.prompts[0].id; return v; }, '重复的编号'],
    ['编号不是整数', v => { v.prompts[0].id = 1.5; return v; }, '缺少有效的编号'],
    ['记录不是对象', v => { v.runs[0] = 'oops'; return v; }, '不是有效的记录'],
  ];

  it.each(cases)('%s', async (_name, mutate, expected) => {
    await seed();
    const before = await snapshotDb();
    const valid = JSON.parse(JSON.stringify(await B.createBackup(db)));
    const mutated = mutate(valid);
    const text = typeof mutated === 'string' ? mutated : JSON.stringify(mutated);

    let error: unknown;
    try {
      B.parseBackup(text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(B.BackupError);
    expect((error as Error).message).toContain(expected);
    expect(await snapshotDb()).toEqual(before);
  });

  it('引用了不存在记录:只警告,不拒绝', async () => {
    await seed();
    const v = JSON.parse(JSON.stringify(await B.createBackup(db)));
    v.runs.push({ id: 99, promptId: 12345, promptVersionId: 1, inputText: 'x', outputText: 'y', sourcePlatform: 'chatgpt', createdAt: '2026-11-01T00:00:00.000Z' });
    v.counts.runs += 1;
    const parsed = B.parseBackup(JSON.stringify(v));
    expect(parsed.preview.warnings).toHaveLength(1);
    expect(parsed.preview.warnings[0]).toContain('AI 回复找不到对应的笔记');
    expect(parsed.data.runs).toHaveLength(4);
  });
});

describe('附件的二进制内容', () => {
  const stub = (rows: any[]) => ({ toArray: async () => rows, count: async () => rows.length });

  it('真正的 Blob 编码为 data URL,导入时还原;非 Blob(空对象)不写入', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 250])], { type: 'image/png' });
    // fake-indexeddb 对 jsdom 的 Blob 无法做结构化克隆,所以这里用桩对象代替数据库来测编码与还原
    const fakeDb: any = {
      folders: stub([]), tags: stub([]), prompts: stub([]), promptVersions: stub([]), runs: stub([]), improvementRequests: stub([]),
      attachments: stub([
        { id: 1, runId: 1, name: 'real.png', mimeType: 'image/png', localBlob: png, createdAt: new Date() },
        { id: 2, runId: 1, name: 'empty.txt', mimeType: 'text/plain', localBlob: {}, createdAt: new Date() },
      ]),
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<unknown>) => fn(),
    };
    const backup = await B.createBackup(fakeDb);
    const [withBlob, withoutBlob] = backup.attachments as any[];
    expect('localBlob' in withBlob).toBe(false);
    expect(withBlob.localBlobDataUrl).toMatch(/^data:image\/png;base64,/);
    expect('localBlob' in withoutBlob).toBe(false);
    expect('localBlobDataUrl' in withoutBlob).toBe(false);

    const restored = B.parseBackup(JSON.stringify(backup)).data.attachments;
    expect(restored[0].localBlob).toBeInstanceOf(Blob);
    expect(restored[0].localBlob!.size).toBe(8);
    expect(restored[0].localBlob!.type).toBe('image/png');
    expect('localBlob' in restored[1]).toBe(false);
  });

  it('附件数据损坏时给出明确错误', () => {
    const v: any = { ...legacyFile(), app: 'riddle-notes', version: '2.0.0' };
    v.attachments[0] = { id: 1, runId: 1, name: 'x', mimeType: 'image/png', createdAt: '2026-11-01T00:00:00.000Z', localBlobDataUrl: 'data:image/png;base64,@@@' };
    expect(() => B.parseBackup(JSON.stringify(v))).toThrow(/无法解码|格式不正确/);
  });
});

describe('是否有值得备份的用户数据(hasAnyData)', () => {
  const counts = (over: Partial<B.BackupCounts> = {}): B.BackupCounts => ({
    folders: 0, tags: 0, prompts: 0, promptVersions: 0, runs: 0, attachments: 0, improvementRequests: 0, ...over,
  });

  it('完全空的库:没有', () => {
    expect(B.hasAnyData(counts())).toBe(false);
  });

  it('刚安装扩展时的默认状态(1 个文件夹 + 3 个预置标签,没有笔记):没有', () => {
    // 这是真实 Chrome 里验证出来的:全新安装的库并不是空的,但里面没有任何用户内容
    expect(B.hasAnyData(counts({ folders: 1, tags: 3 }))).toBe(false);
  });

  it('有笔记就算有,即使其他表都是空的', () => {
    expect(B.hasAnyData(counts({ prompts: 1 }))).toBe(true);
  });

  it('笔记的附属数据也算有', () => {
    for (const table of ['promptVersions', 'runs', 'attachments', 'improvementRequests'] as const) {
      expect(B.hasAnyData(counts({ [table]: 1 }))).toBe(true);
    }
  });

  it('用户新建了文件夹或标签(超过默认数量):算有,这些改动也要保护', () => {
    expect(B.hasAnyData(counts({ folders: 2, tags: 3 }))).toBe(true);
    expect(B.hasAnyData(counts({ folders: 1, tags: 4 }))).toBe(true);
  });

  it('默认值与 schema.ts 实际写入的预置数据一致', async () => {
    // 如果有人改了 initializeDefaultData 里预置的文件夹或标签数量,这里会失败,
    // 提醒同步修改 DEFAULT_SEED_COUNTS,否则刚安装的用户又会被误判成「有旧数据」
    const { initializeDefaultData } = await import('../src/db/schema');
    await initializeDefaultData();
    const seeded = await B.getBackupCounts(db);
    expect(seeded.folders).toBe(B.DEFAULT_SEED_COUNTS.folders);
    expect(seeded.tags).toBe(B.DEFAULT_SEED_COUNTS.tags);
    expect(seeded.prompts).toBe(0);
    expect(B.hasAnyData(seeded)).toBe(false);
  });
});

describe('备份文件名', () => {
  // 用本地时间的各个部分构造日期,这样断言与运行机器的时区无关
  const at = (y: number, mo: number, da: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, da, h, mi, s);

  it('手动导出:带本地日期', () => {
    expect(B.exportFileName(at(2026, 11, 17, 8, 30))).toBe('riddle-notes-export-2026-11-17.json');
    expect(B.exportFileName(at(2026, 1, 5))).toBe('riddle-notes-export-2026-01-05.json');
  });

  it('覆盖前备份:带本地日期和时间,精确到秒', () => {
    expect(B.safetyBackupFileName(at(2026, 11, 17, 9, 5, 7))).toBe('riddle-notes-backup-before-import-2026-11-17_09-05-07.json');
    expect(B.safetyBackupFileName(at(2026, 12, 31, 23, 59, 59))).toBe('riddle-notes-backup-before-import-2026-12-31_23-59-59.json');
  });

  it('同一天的两次备份文件名不同,不会覆盖历史备份', () => {
    const a = B.safetyBackupFileName(at(2026, 11, 17, 9, 0, 0));
    const b = B.safetyBackupFileName(at(2026, 11, 17, 9, 0, 1));
    expect(a).not.toBe(b);
  });

  it('文件名里没有 Windows 不允许的字符', () => {
    const name = B.safetyBackupFileName(at(2026, 11, 17, 9, 5, 7));
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });
});

describe('导入前的预览文案', () => {
  it('包含数量、导出时间,并说明覆盖和自动备份', async () => {
    await seed();
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    const text = B.describeImport(parsed.preview, await B.getBackupCounts(db));
    expect(text).toContain('1 条笔记');
    expect(text).toContain('旧版本导出');
    expect(text).toContain('完全覆盖现有数据（3 条笔记');
    expect(text).toContain('先自动下载一份现有数据的备份');
    expect(text).not.toContain('Prompt');
  });

  it('现有数据为空时不提覆盖和备份', async () => {
    const parsed = B.parseBackup(JSON.stringify(legacyFile()));
    const text = B.describeImport(parsed.preview, await B.getBackupCounts(db));
    expect(text).toContain('当前没有数据');
    expect(text).not.toContain('覆盖');
    expect(text).not.toContain('自动下载');
  });
});
