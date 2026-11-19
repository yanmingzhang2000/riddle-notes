import Dexie from 'dexie';
import { beforeEach, describe, expect, test } from 'vitest';
import { db as notesDb } from '../../src/db/schema';
import { RiddleVaultDB, VAULT_DB_NAME, isVaultInitialized, vaultDb } from '../../src/db/vault-schema';
import * as Backup from '../../src/shared/backup';
import { createManualNote, findMatchingNoteIds } from '../../src/shared/notes';
import { resetDb } from '../helpers/db';
import { createTestVaultDb, makeKeys, makeRecord } from '../helpers/vault';

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('RiddleVaultDB 结构', () => {
  test('是独立的数据库,名字不同于 SidecarDB', () => {
    expect(vaultDb.name).toBe(VAULT_DB_NAME);
    expect(VAULT_DB_NAME).toBe('RiddleVaultDB');
    expect(notesDb.name).toBe('SidecarDB');
  });

  test('四张表,版本 1', async () => {
    const db = createTestVaultDb();
    await db.open();
    expect(db.tables.map(t => t.name).sort()).toEqual([
      'vaultKeys',
      'vaultRecords',
      'vaultSettings',
      'vaultSnapshot',
    ]);
    expect(db.verno).toBe(1);
    db.close();
  });

  test('vaultSnapshot 在 v1 就存在(发布后再加就要 v2)', async () => {
    const db = createTestVaultDb();
    await db.open();
    expect(db.tables.some(t => t.name === 'vaultSnapshot')).toBe(true);
    db.close();
  });

  test('vaultRecords 有 type 和 updatedAt 索引', async () => {
    const db = createTestVaultDb();
    await db.open();
    const indexes = db.table('vaultRecords').schema.idxByName;
    expect(Object.keys(indexes).sort()).toEqual(['type', 'updatedAt']);
    db.close();
  });

  test('SidecarDB 里没有任何 Vault 表', () => {
    const names = notesDb.tables.map(t => t.name);
    expect(names.filter(n => n.toLowerCase().includes('vault'))).toEqual([]);
  });

  test('Notes 备份的表清单里没有 Vault 表', () => {
    const names = Backup.BACKUP_TABLES as readonly string[];
    expect(names.filter(n => n.toLowerCase().includes('vault'))).toEqual([]);
  });
});

describe('isVaultInitialized', () => {
  let db: RiddleVaultDB;
  beforeEach(() => {
    db = createTestVaultDb();
  });

  test('新库是未初始化:vaultKeys 没有记录就是未初始化,不需要 initialized 字段', async () => {
    expect(await isVaultInitialized(db)).toBe(false);
  });

  test('写入 singleton 后是已初始化', async () => {
    await db.vaultKeys.add(makeKeys());
    expect(await isVaultInitialized(db)).toBe(true);
  });

  test('只有 vaultSettings 或 vaultRecords 不算已初始化', async () => {
    await db.vaultSettings.add({ id: 'singleton', autoLockTimeoutMs: 300_000 });
    await db.vaultRecords.add(makeRecord('r1'));
    expect(await isVaultInitialized(db)).toBe(false);
  });

  test('singleton 主键重复的 add 失败(并发初始化的最后一道防线)', async () => {
    await db.vaultKeys.add(makeKeys());
    await expect(db.vaultKeys.add(makeKeys())).rejects.toThrow();
  });
});

describe('二进制字段的存取', () => {
  test('Uint8Array 经 IndexedDB 往返后内容不变,仍是字节数组', async () => {
    const db = createTestVaultDb();
    const keys = makeKeys();
    await db.vaultKeys.add(keys);

    const loaded = (await db.vaultKeys.get('singleton'))!;
    expect(ArrayBuffer.isView(loaded.wrapper.master.wrappedKey)).toBe(true);
    expect(toHex(loaded.wrapper.master.wrappedKey)).toBe(toHex(keys.wrapper.master.wrappedKey));
    expect(toHex(loaded.wrapper.master.iv)).toBe(toHex(keys.wrapper.master.iv));
    expect(toHex(loaded.wrapper.keyId)).toBe(toHex(keys.wrapper.keyId));
    if (loaded.wrapper.master.kdf.algorithm === 'PBKDF2-SHA256') {
      expect(toHex(loaded.wrapper.master.kdf.salt)).toBe(toHex(new Uint8Array(32).fill(3)));
      expect(loaded.wrapper.master.kdf.iterations).toBe(600_000);
    }
  });

  test('记录的密文段往返不变', async () => {
    const db = createTestVaultDb();
    const rec = makeRecord('r1');
    await db.vaultRecords.add(rec);
    const loaded = (await db.vaultRecords.get('r1'))!;
    expect(toHex(loaded.summary.data)).toBe(toHex(rec.summary.data));
    expect(toHex(loaded.secret.iv)).toBe(toHex(rec.secret.iv));
    expect(loaded.type).toBe('api_key');
  });

  test('按 type 与 updatedAt 查询', async () => {
    const db = createTestVaultDb();
    await db.vaultRecords.bulkAdd([
      makeRecord('a', { type: 'api_key', updatedAt: 300 }),
      makeRecord('b', { type: 'password', updatedAt: 100 }),
      makeRecord('c', { type: 'api_key', updatedAt: 200 }),
    ]);
    expect((await db.vaultRecords.where('type').equals('api_key').toArray()).map(r => r.id).sort()).toEqual([
      'a',
      'c',
    ]);
    expect((await db.vaultRecords.orderBy('updatedAt').reverse().toArray()).map(r => r.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });
});

// 这一组必须用真实的 vaultDb 单例:Notes 代码将来若误碰 Vault,碰的是这个实例,
// 用临时库测不出来。每个测试文件在独立进程里运行,内存数据库不会污染其他文件。
describe('与 Notes 数据库隔离(回归测试)', () => {
  beforeEach(async () => {
    await resetDb();
    await vaultDb.delete();
    await vaultDb.open();
  });

  async function seedVault(db: RiddleVaultDB) {
    await db.vaultKeys.add(makeKeys());
    await db.vaultSettings.add({ id: 'singleton', autoLockTimeoutMs: 300_000 });
    await db.vaultRecords.bulkAdd([makeRecord('r1'), makeRecord('r2'), makeRecord('r3')]);
  }

  async function vaultCounts(db: RiddleVaultDB) {
    return {
      keys: await db.vaultKeys.count(),
      settings: await db.vaultSettings.count(),
      records: await db.vaultRecords.count(),
    };
  }

  test('Notes 导出前后,Vault 各表行数不变', async () => {
    const db = vaultDb;
    await seedVault(db);
    const before = await vaultCounts(db);

    await Backup.createBackup(notesDb);

    expect(await vaultCounts(db)).toEqual(before);
  });

  test('Notes 导入(清空并覆盖)前后,Vault 各表行数不变', async () => {
    const db = vaultDb;
    await seedVault(db);
    await createManualNote({ title: 'before', content: 'x' });
    const text = JSON.stringify(await Backup.createBackup(notesDb));
    const before = await vaultCounts(db);

    await Backup.restoreBackup(notesDb, Backup.parseBackup(text).data);

    expect(await vaultCounts(db)).toEqual(before);
  });

  test('Notes 搜索不会匹配 Vault 里的内容', async () => {
    const db = vaultDb;
    await seedVault(db);
    await createManualNote({ title: 'visible note', content: 'hello' });
    expect((await findMatchingNoteIds('hello')).size).toBe(1);
    expect((await findMatchingNoteIds('r1')).size).toBe(0);
    expect(await vaultCounts(db)).toEqual({ keys: 1, settings: 1, records: 3 });
  });

  test('Notes 导出的 JSON 不含 Vault 的任何内容', async () => {
    const db = vaultDb;
    await seedVault(db);
    const text = JSON.stringify(await Backup.createBackup(notesDb));
    for (const word of ['vaultKeys', 'vaultRecords', 'vaultSettings', 'vaultSnapshot', 'keyId', 'wrapper']) {
      expect(text).not.toContain(word);
    }
  });

  test('对 SidecarDB 调 delete() 不影响 RiddleVaultDB', async () => {
    const db = vaultDb;
    await seedVault(db);
    const before = await vaultCounts(db);

    await notesDb.delete();
    await notesDb.open();

    expect(await vaultCounts(db)).toEqual(before);
    expect(await isVaultInitialized(db)).toBe(true);
  });

  test('反过来,删除 Vault 库不影响 Notes', async () => {
    const db = vaultDb;
    await seedVault(db);
    await createManualNote({ title: 'keep me', content: 'x' });

    await db.delete();

    expect(await notesDb.prompts.count()).toBe(1);
  });

  test('两个库在 IndexedDB 里是两个独立的数据库', async () => {
    const names = await Dexie.getDatabaseNames();
    expect(names).toContain('RiddleVaultDB');
    expect(names).toContain('SidecarDB');
  });
});
