/* global crypto */
/**
 * schema 从 v2 升级到 v3(给笔记补 uid 和 type)的测试。
 *
 * 先用旧版本的表结构建一个真实的 v2 数据库并写入数据,再用当前代码打开,
 * 让 Dexie 真正执行升级函数。这是升级路径上唯一不可逆的一步,所以不只验证成功,
 * 也验证中途失败时旧数据原样保留。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../src/db/schema';
import { snapshotDb } from './helpers/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const V1_STORES = {
  folders: '++id, name, sortOrder, createdAt, updatedAt',
  tags: '++id, name, createdAt',
  prompts: '++id, title, folderId, sourcePlatform, isFavorite, createdAt, updatedAt, *tags',
  promptVersions: '++id, promptId, versionNumber, createdAt',
  runs: '++id, promptId, promptVersionId, sourcePlatform, rating, createdAt',
  attachments: '++id, runId, createdAt',
  improvementRequests: '++id, promptId, sourceRunId, status, createdAt',
};
const V2_STORES = {
  ...V1_STORES,
  appSettings: '++id, updateCheckEnabled, lastUpdateCheckAt, lastNotifiedVersion, lastDismissedVersion, updateManifestUrl',
};

/** 升级前真实存在于用户库里的数据:没有 uid 和 type */
function v2Rows() {
  const t1 = new Date('2026-11-01T08:00:00.000Z');
  const t2 = new Date('2026-11-05T09:30:00.000Z');
  return {
    folders: [{ id: 1, name: '未分类', sortOrder: 0, createdAt: t1, updatedAt: t1 }],
    tags: [
      { id: 1, name: '高频使用', createdAt: t1 },
      { id: 2, name: '待改进', createdAt: t1 },
      { id: 3, name: '效果很好', createdAt: t1 },
    ],
    prompts: [
      { id: 1, title: '第一条', description: '摘要一', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: true, createdAt: t1, updatedAt: t1, tags: [1] },
      { id: 2, title: '第二条', description: '摘要二', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: false, createdAt: t2, updatedAt: t2 },
      { id: 3, title: '第三条', description: '摘要三', folderId: 1, sourcePlatform: 'chatgpt', isFavorite: false, createdAt: t2, updatedAt: t2 },
    ],
    promptVersions: [
      { id: 1, promptId: 1, versionNumber: 1, content: '提问一', changeNote: '初始版本', createdAt: t1 },
      { id: 2, promptId: 2, versionNumber: 1, content: '提问二', createdAt: t2 },
      { id: 3, promptId: 3, versionNumber: 1, content: '提问三', createdAt: t2 },
    ],
    runs: [
      { id: 1, promptId: 1, promptVersionId: 1, inputText: '提问一', outputText: '回复一', sourcePlatform: 'chatgpt', conversationUrl: 'https://chatgpt.com/c/1', createdAt: t1 },
      { id: 2, promptId: 2, promptVersionId: 2, inputText: '提问二', outputText: '回复二', sourcePlatform: 'chatgpt', createdAt: t2 },
      { id: 3, promptId: 3, promptVersionId: 3, inputText: '提问三', outputText: '回复三', sourcePlatform: 'chatgpt', createdAt: t2 },
    ],
    attachments: [{ id: 1, runId: 1, name: 'a.png', mimeType: 'image/png', sourceUrl: 'https://x/a.png', createdAt: t1 }],
    improvementRequests: [{ id: 1, promptId: 1, sourceRunId: 1, status: 'pending', createdAt: t1 }],
  };
}

async function readAllTables(database: Dexie) {
  const out: Record<string, any[]> = {};
  for (const table of database.tables) {
    out[table.name] = await table.toArray();
  }
  return out;
}

/** 删除现有库,用 v2 的表结构重建并写入数据。返回写入后读到的内容(升级前的状态) */
async function createV2Database() {
  await db.delete();
  const legacy = new Dexie('SidecarDB');
  legacy.version(1).stores(V1_STORES);
  legacy.version(2).stores(V2_STORES);
  await legacy.open();

  const rows = v2Rows() as Record<string, any[]>;
  for (const name of Object.keys(rows)) {
    await legacy.table(name).bulkAdd(rows[name]);
  }
  await legacy.table('appSettings').add({
    updateCheckEnabled: true,
    updateManifestUrl: 'https://example.com/m.json',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  });

  const state = await readAllTables(legacy);
  legacy.close();
  return state;
}

beforeEach(async () => {
  db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('v2 升级到 v3', () => {
  it('前提:用旧结构建出来的确实是 v2,笔记上没有 uid 和 type', async () => {
    const before = await createV2Database();
    expect(before.prompts).toHaveLength(3);
    for (const p of before.prompts) {
      expect('uid' in p).toBe(false);
      expect('type' in p).toBe(false);
    }
    const probe = new Dexie('SidecarDB');
    await probe.open();
    expect(probe.verno).toBe(2);
    probe.close();
  });

  it('每条已有笔记都得到唯一的 uid 和 type=ai,其余数据逐字不变', async () => {
    const before = await createV2Database();

    await db.open();
    expect(db.verno).toBe(3);
    const after = await readAllTables(db);

    // 笔记:原有字段一个不少,另外多了 uid 和 type
    expect(after.prompts).toHaveLength(before.prompts.length);
    after.prompts.forEach((p, i) => {
      const { uid, type, ...rest } = p;
      expect(rest).toEqual(before.prompts[i]);
      expect(uid).toMatch(UUID);
      expect(type).toBe('ai');
    });
    expect(new Set(after.prompts.map(p => p.uid)).size).toBe(after.prompts.length);

    // 其他所有表完全不变,包括预置标签和更新设置
    for (const name of Object.keys(before)) {
      if (name === 'prompts') continue;
      expect(after[name], `表 ${name}`).toEqual(before[name]);
    }
    for (const p of after.prompts) {
      expect(p.createdAt).toBeInstanceOf(Date);
      expect(p.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('空库也能升级', async () => {
    await db.delete();
    const legacy = new Dexie('SidecarDB');
    legacy.version(1).stores(V1_STORES);
    legacy.version(2).stores(V2_STORES);
    await legacy.open();
    legacy.close();

    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.prompts.count()).toBe(0);
  });

  it('升级只发生一次:再次打开不会改变已经生成的 uid', async () => {
    await createV2Database();
    await db.open();
    const first = (await db.prompts.toArray()).map(p => p.uid);

    db.close();
    await db.open();
    const second = (await db.prompts.toArray()).map(p => p.uid);
    expect(second).toEqual(first);
  });

  it('升级后列表依赖的排序和筛选照常工作', async () => {
    await createV2Database();
    await db.open();

    const byUpdated = await db.prompts.orderBy('updatedAt').reverse().toArray();
    expect(byUpdated.map(p => p.id)).toEqual([3, 2, 1]);
    expect((await db.prompts.filter(p => p.isFavorite).toArray()).map(p => p.id)).toEqual([1]);
    expect((await db.prompts.where('type').equals('ai').count())).toBe(3);
  });

  it('升级中途失败:数据库保持 v2,所有旧数据原样保留,没有被改成一半', async () => {
    const before = await createV2Database();

    // 让第二条笔记生成 uid 时抛错,模拟升级到一半失败
    let calls = 0;
    const realUUID = crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      if (++calls === 2) throw new Error('boom');
      return realUUID();
    });

    await expect(db.open()).rejects.toThrow();
    db.close();
    vi.restoreAllMocks();

    // 用不带版本的方式打开,看库里实际是什么状态
    const probe = new Dexie('SidecarDB');
    await probe.open();
    expect(probe.verno).toBe(2);
    const after = await readAllTables(probe);
    probe.close();
    expect(after).toEqual(before);
    for (const p of after.prompts) {
      expect('uid' in p).toBe(false);
      expect('type' in p).toBe(false);
    }
  });

  it('升级失败之后不会卡死:问题消失后再打开,可以正常完成升级', async () => {
    const before = await createV2Database();

    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(db.open()).rejects.toThrow();
    db.close();
    vi.restoreAllMocks();

    await db.open();
    expect(db.verno).toBe(3);
    const prompts = await db.prompts.toArray();
    expect(prompts).toHaveLength(before.prompts.length);
    expect(prompts.every(p => UUID.test(p.uid ?? '') && p.type === 'ai')).toBe(true);
  });
});

describe('v3 的索引', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const base = () => ({
    title: 't',
    sourcePlatform: 'chatgpt',
    isFavorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('uid 唯一:重复的 uid 被拒绝', async () => {
    await db.prompts.add({ ...base(), uid: 'same' });
    await expect(db.prompts.add({ ...base(), uid: 'same' })).rejects.toThrow();
    expect(await db.prompts.count()).toBe(1);
  });

  it('没有 uid 的行可以并存(测试数据和旧代码写入的数据不会互相冲突)', async () => {
    await db.prompts.add(base());
    await db.prompts.add(base());
    expect(await db.prompts.count()).toBe(2);
  });

  it('可以按 uid 和 type 查询', async () => {
    await db.prompts.add({ ...base(), uid: 'a', type: 'ai' });
    await db.prompts.add({ ...base(), uid: 'b', type: 'manual', content: 'x' });
    expect((await db.prompts.where('uid').equals('b').first())?.type).toBe('manual');
    expect(await db.prompts.where('type').equals('manual').count()).toBe(1);
  });
});

describe('新用户的默认数据', () => {
  it('不再预置标签,只有「未分类」文件夹', async () => {
    await db.delete();
    await db.open();
    const { initializeDefaultData } = await import('../src/db/schema');
    await initializeDefaultData();

    const snap = await snapshotDb();
    expect(snap.folders.map(f => f.name)).toEqual(['未分类']);
    expect(snap.tags).toEqual([]);
  });

  it('已有用户的库:不会因为升级而新增或删除标签和文件夹', async () => {
    const before = await createV2Database();
    await db.open();
    const { initializeDefaultData } = await import('../src/db/schema');
    await initializeDefaultData();

    const after = await snapshotDb();
    expect(after.tags).toEqual(before.tags);
    expect(after.folders).toEqual(before.folders);
  });
});
