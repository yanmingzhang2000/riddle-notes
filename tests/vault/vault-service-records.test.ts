import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AuthError,
  ConflictError,
  CorruptError,
  NotFoundError,
  VaultLockedError,
} from '../../src/vault/crypto/errors';
import type { VaultRecord, VaultRecordInput, VaultSecretPlain, VaultSummaryPlain } from '../../src/vault/types';
import {
  PASSWORD,
  containsSubarray,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  snapshotVault,
  toHex,
  type TestVault,
} from '../helpers/vault';

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeTestVaults();
});

const FULL: VaultRecordInput = {
  type: 'api_key',
  title: 'My Production Server',
  secret: 'sk-very-secret-key-1234567890',
  username: 'admin',
  url: 'https://internal.example',
  notes: 'rotate every 90 days',
  tags: ['prod', 'aws'],
};

async function vaultWithClock() {
  const clock = { now: 1_000 };
  const vault = await createInitializedVault({ now: () => clock.now });
  return { vault, clock };
}

/** 直接解密库里某条记录的一段,用来验证"哪些字段在哪一段" */
async function decryptStored<T>(vault: TestVault, row: VaultRecord, segment: 'summary' | 'secret') {
  const { key } = vault.session.requireKey();
  return vault.crypto.decryptSegment<T>(row[segment], key, {
    recordId: row.id,
    type: row.type,
    formatVersion: 1,
    segment,
  });
}

async function tamperRecord(vault: TestVault, id: string, change: (row: VaultRecord) => void) {
  const row = (await vault.db.vaultRecords.get(id))!;
  change(row);
  await vault.db.vaultRecords.put(row);
}

describe('完整流程', () => {
  test('初始化 → 创建 → 锁定 → 读取被拒 → 重新解锁 → 读取成功', async () => {
    const vault = createTestVault();
    await vault.service.initialize(PASSWORD, async () => {});
    expect(vault.session.isOpen()).toBe(true);

    const id = await vault.service.createRecord({ type: 'api_key', title: 'Test API Key', secret: 'sk-test-123' });
    vault.session.lock();
    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(VaultLockedError);

    await vault.service.unlockWithMasterPassword(PASSWORD);
    expect((await vault.service.getSecret(id)).secret).toBe('sk-test-123');
  });
});

describe('createRecord / getSecret', () => {
  test('往返所有字段,时间戳来自服务的时钟', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);

    expect(await vault.service.getSecret(id)).toEqual({ ...FULL, id, createdAt: 1_000, updatedAt: 1_000 });
  });

  test('只有必填字段时,可选字段不会凭空出现', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord({ type: 'secure_note', title: 'Note', secret: 'body' });

    const got = await vault.service.getSecret(id);
    expect(Object.keys(got).sort()).toEqual(['createdAt', 'id', 'secret', 'title', 'type', 'updatedAt']);
  });

  test('空字符串与未提供是两回事,往返后保持不变', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord({ type: 'password', title: 'T', secret: '', username: '' });

    const got = await vault.service.getSecret(id);
    expect(got.secret).toBe('');
    expect(got.username).toBe('');
    expect('url' in got).toBe(false);
  });

  test('中文、emoji、换行', async () => {
    const { vault } = await vaultWithClock();
    const input: VaultRecordInput = {
      type: 'secure_note',
      title: '生产环境 🔑',
      secret: '密码:p@ss\nword',
      notes: '多行\n备注\t制表符',
    };
    const id = await vault.service.createRecord(input);
    expect(await vault.service.getSecret(id)).toMatchObject(input);
  });

  test('四种类型都能创建', async () => {
    const { vault } = await vaultWithClock();
    for (const type of ['api_key', 'password', 'database', 'secure_note'] as const) {
      const id = await vault.service.createRecord({ type, title: type, secret: 's' });
      expect((await vault.service.getSecret(id)).type).toBe(type);
    }
  });

  test('记录写入时带上 Session 的 keyId 与 formatVersion', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const row = (await vault.db.vaultRecords.get(id))!;

    expect(toHex(row.keyId)).toBe(toHex(vault.session.requireKey().keyId));
    expect(row.formatVersion).toBe(1);
  });

  test('并发创建 20 条:全部写入,id 互不相同', async () => {
    const { vault } = await vaultWithClock();
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => vault.service.createRecord({ type: 'api_key', title: `k${i}`, secret: `s${i}` }))
    );
    expect(new Set(ids).size).toBe(20);
    expect(await vault.db.vaultRecords.count()).toBe(20);
  });

  test('getSecret:记录不存在抛 NotFoundError', async () => {
    const { vault } = await vaultWithClock();
    await expect(vault.service.getSecret('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('两段加密', () => {
  test('summary 只含 title 与 tags,secret 段含其余字段,互不混入', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const row = (await vault.db.vaultRecords.get(id))!;

    expect(await decryptStored<VaultSummaryPlain>(vault, row, 'summary')).toEqual({
      title: FULL.title,
      tags: FULL.tags,
    });
    expect(await decryptStored<VaultSecretPlain>(vault, row, 'secret')).toEqual({
      secret: FULL.secret,
      username: FULL.username,
      url: FULL.url,
      notes: FULL.notes,
    });
  });

  test('两段用不同的 IV', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const row = (await vault.db.vaultRecords.get(id))!;
    expect(toHex(row.summary.iv)).not.toBe(toHex(row.secret.iv));
  });

  test('列表只解密 summary,不碰 secret 段', async () => {
    const { vault } = await vaultWithClock();
    for (let i = 0; i < 3; i++) await vault.service.createRecord({ ...FULL, title: `k${i}` });
    const decrypt = vi.spyOn(vault.crypto, 'decryptSegment');

    await vault.service.listSummaries();

    expect(decrypt).toHaveBeenCalledTimes(3);
    expect(decrypt.mock.calls.map(call => call[2].segment)).toEqual(['summary', 'summary', 'summary']);
  });

  test('详情解密两段', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const decrypt = vi.spyOn(vault.crypto, 'decryptSegment');

    await vault.service.getSecret(id);

    expect(decrypt.mock.calls.map(call => call[2].segment).sort()).toEqual(['secret', 'summary']);
  });

  test('列表里没有任何 secret 段的内容', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.createRecord(FULL);
    const text = JSON.stringify(await vault.service.listSummaries());
    for (const word of [FULL.secret, FULL.username!, FULL.url!, FULL.notes!]) expect(text).not.toContain(word);
  });
});

describe('listSummaries', () => {
  test('空库返回空数组', async () => {
    const { vault } = await vaultWithClock();
    expect(await vault.service.listSummaries()).toEqual([]);
  });

  test('按 updatedAt 从新到旧排序(主键顺序与时间顺序相反,不排序就会暴露)', async () => {
    // 数据库默认按主键升序返回:这里最旧的记录主键最小,不排序得到的就是 old、middle、newest
    const ids = ['a-old', 'b-middle', 'c-newest'];
    const clock = { now: 0 };
    const vault = await createInitializedVault({ now: () => clock.now, newId: () => ids.shift()! });
    clock.now = 100;
    await vault.service.createRecord({ type: 'api_key', title: 'old', secret: 's' });
    clock.now = 200;
    await vault.service.createRecord({ type: 'api_key', title: 'middle', secret: 's' });
    clock.now = 300;
    await vault.service.createRecord({ type: 'api_key', title: 'newest', secret: 's' });

    expect((await vault.service.listSummaries()).map(s => s.title)).toEqual(['newest', 'middle', 'old']);
  });

  test('解密遇到不是认证/结构类的错误(比如程序错误):照常抛出,不伪装成 unreadable', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.createRecord(FULL);
    vi.spyOn(vault.crypto, 'decryptSegment').mockRejectedValue(new Error('unexpected bug'));

    await expect(vault.service.listSummaries()).rejects.toThrow('unexpected bug');
  });

  test('按类型过滤', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.createRecord({ type: 'api_key', title: 'a', secret: 's' });
    await vault.service.createRecord({ type: 'password', title: 'b', secret: 's' });
    await vault.service.createRecord({ type: 'api_key', title: 'c', secret: 's' });

    const keys = await vault.service.listSummaries({ type: 'api_key' });
    expect(keys.map(s => s.title).sort()).toEqual(['a', 'c']);
    expect(await vault.service.listSummaries({ type: 'database' })).toEqual([]);
  });

  test('条目字段:id、type、title、tags、时间戳', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    expect(await vault.service.listSummaries()).toEqual([
      { id, type: 'api_key', title: FULL.title, tags: FULL.tags, createdAt: 1_000, updatedAt: 1_000 },
    ]);
  });

  test('100 条记录的列表加载 < 500ms', async () => {
    const { vault } = await vaultWithClock();
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => vault.service.createRecord({ ...FULL, title: `record ${i}` }))
    );
    const start = performance.now();
    const list = await vault.service.listSummaries();
    const elapsed = performance.now() - start;
    console.log(`listSummaries(100): ${elapsed.toFixed(0)}ms`);
    expect(list).toHaveLength(100);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('updateRecord', () => {
  test('保留 createdAt,更新 updatedAt 与内容', async () => {
    const { vault, clock } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    clock.now = 5_000;

    await vault.service.updateRecord(id, { ...FULL, title: 'Renamed', secret: 'sk-new' });

    expect(await vault.service.getSecret(id)).toMatchObject({
      id,
      title: 'Renamed',
      secret: 'sk-new',
      createdAt: 1_000,
      updatedAt: 5_000,
    });
    expect(await vault.db.vaultRecords.count()).toBe(1);
  });

  test('两段都用新的 IV 重新加密,即使内容没变', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const before = (await vault.db.vaultRecords.get(id))!;

    await vault.service.updateRecord(id, FULL);

    const after = (await vault.db.vaultRecords.get(id))!;
    expect(toHex(after.summary.iv)).not.toBe(toHex(before.summary.iv));
    expect(toHex(after.secret.iv)).not.toBe(toHex(before.secret.iv));
    expect(toHex(after.secret.data)).not.toBe(toHex(before.secret.data));
  });

  test('可以改类型:AAD 随之更新,仍能解密,过滤结果跟着变', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);

    await vault.service.updateRecord(id, { ...FULL, type: 'password' });

    expect((await vault.service.getSecret(id)).type).toBe('password');
    expect(await vault.service.listSummaries({ type: 'api_key' })).toEqual([]);
    expect(await vault.service.listSummaries({ type: 'password' })).toHaveLength(1);
  });

  test('省略可选字段 = 清除它们', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await vault.service.updateRecord(id, { type: 'api_key', title: 'Bare', secret: 's' });

    const got = await vault.service.getSecret(id);
    expect('username' in got || 'url' in got || 'notes' in got || 'tags' in got).toBe(false);
  });

  test('记录不存在:NotFoundError,不会当作新建', async () => {
    const { vault } = await vaultWithClock();
    await expect(vault.service.updateRecord('missing', FULL)).rejects.toBeInstanceOf(NotFoundError);
    expect(await vault.db.vaultRecords.count()).toBe(0);
  });

  test('id 里含 | 这类会让 AAD 产生歧义的字符:CorruptError', async () => {
    const { vault } = await vaultWithClock();
    await expect(vault.service.updateRecord('a|b', FULL)).rejects.toBeInstanceOf(CorruptError);
  });
});

describe('deleteRecord', () => {
  test('删除后读不到,其他记录不受影响', async () => {
    const { vault } = await vaultWithClock();
    const keep = await vault.service.createRecord({ ...FULL, title: 'keep' });
    const drop = await vault.service.createRecord({ ...FULL, title: 'drop' });

    await vault.service.deleteRecord(drop);

    await expect(vault.service.getSecret(drop)).rejects.toBeInstanceOf(NotFoundError);
    expect((await vault.service.getSecret(keep)).title).toBe('keep');
    expect(await vault.db.vaultRecords.count()).toBe(1);
  });

  test('记录不存在:NotFoundError', async () => {
    const { vault } = await vaultWithClock();
    await expect(vault.service.deleteRecord('missing')).rejects.toBeInstanceOf(NotFoundError);
    const id = await vault.service.createRecord(FULL);
    await vault.service.deleteRecord(id);
    await expect(vault.service.deleteRecord(id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('输入校验', () => {
  test.each<[string, unknown]>([
    ['类型不在列表里', { ...FULL, type: 'credit_card' }],
    ['缺 type', { ...FULL, type: undefined }],
    ['title 不是字符串', { ...FULL, title: 42 }],
    ['secret 不是字符串', { ...FULL, secret: null }],
    ['username 不是字符串', { ...FULL, username: 1 }],
    ['tags 不是数组', { ...FULL, tags: 'prod' }],
    ['tags 里有非字符串', { ...FULL, tags: ['ok', 2] }],
  ])('%s:TypeError,什么都没写', async (_name, input) => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const before = await snapshotVault(vault.db);

    await expect(vault.service.createRecord(input as VaultRecordInput)).rejects.toBeInstanceOf(TypeError);
    await expect(vault.service.updateRecord(id, input as VaultRecordInput)).rejects.toBeInstanceOf(TypeError);

    expect(await snapshotVault(vault.db)).toEqual(before);
  });
});

describe('锁定状态', () => {
  test('会话关闭时所有记录操作都抛 VaultLockedError', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await expect(vault.service.listSummaries()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(VaultLockedError);
    await expect(vault.service.createRecord(FULL)).rejects.toBeInstanceOf(VaultLockedError);
    await expect(vault.service.updateRecord(id, FULL)).rejects.toBeInstanceOf(VaultLockedError);
    await expect(vault.service.deleteRecord(id)).rejects.toBeInstanceOf(VaultLockedError);

    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('getSecret 进行中被锁定:明文不会返回给调用方', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);

    const pending = vault.service.getSecret(id);
    vault.session.lockLocal();

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
  });

  test('listSummaries 进行中被锁定:不返回标题', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.createRecord(FULL);

    const pending = vault.service.listSummaries();
    vault.session.lockLocal();

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
  });

  // 锁定可能发生在 await 之间的任何位置。下面两组分别把它放在"读库之后、解密之前"
  // 和"解密进行中",两处检查各自都要能拦住,不能靠另一处兜底。
  describe.each([
    ['getSecret', (v: TestVault, id: string) => v.service.getSecret(id)],
    ['listSummaries', (v: TestVault) => v.service.listSummaries()],
  ])('%s', (_name, read) => {
    test('读库期间被锁定:不再尝试解密', async () => {
      const { vault } = await vaultWithClock();
      const id = await vault.service.createRecord(FULL);
      const decrypt = vi.spyOn(vault.crypto, 'decryptSegment');

      const pending = read(vault, id);
      vault.session.lockLocal();

      await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
      expect(decrypt).not.toHaveBeenCalled();
    });

    test('解密进行中被锁定:已经解出来的明文也不返回', async () => {
      const { vault } = await vaultWithClock();
      const id = await vault.service.createRecord(FULL);
      const decrypt = vault.crypto.decryptSegment.bind(vault.crypto);
      let locked = false;
      vi.spyOn(vault.crypto, 'decryptSegment').mockImplementation(async (...args) => {
        const plain = await decrypt(...args);
        if (!locked) {
          locked = true;
          vault.session.lockLocal(); // 第一段解出来之后、返回之前被锁定
        }
        return plain;
      });

      await expect(read(vault, id)).rejects.toBeInstanceOf(VaultLockedError);
      expect(locked).toBe(true);
    });
  });

  test('createRecord 进行中被锁定:什么都不写', async () => {
    const { vault } = await vaultWithClock();

    const pending = vault.service.createRecord(FULL);
    vault.session.lockLocal();

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
    expect(await vault.db.vaultRecords.count()).toBe(0);
  });

  test('updateRecord / deleteRecord 进行中被锁定:库里的记录原样保留', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const before = await snapshotVault(vault.db);

    const update = vault.service.updateRecord(id, { ...FULL, title: 'changed' });
    vault.session.lockLocal();
    await expect(update).rejects.toBeInstanceOf(VaultLockedError);
    expect(await snapshotVault(vault.db)).toEqual(before);

    await vault.service.unlockWithMasterPassword(PASSWORD);
    const del = vault.service.deleteRecord(id);
    vault.session.lockLocal();
    await expect(del).rejects.toBeInstanceOf(VaultLockedError);
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('另一个面板广播锁定时,本面板进行中的读取同样作废', async () => {
    const a = await createInitializedVault();
    const b = createTestVault({ peerOf: a });
    await b.service.unlockWithMasterPassword(PASSWORD);
    const id = await b.service.createRecord(FULL);

    const pending = b.service.getSecret(id);
    a.session.lock();

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
  });

  test('记录操作刷新自动锁定计时,列表不刷新', async () => {
    const { vault } = await vaultWithClock();
    const touch = vi.spyOn(vault.session, 'touch');

    const id = await vault.service.createRecord(FULL);
    await vault.service.getSecret(id);
    await vault.service.updateRecord(id, FULL);
    await vault.service.deleteRecord(id);
    expect(touch).toHaveBeenCalledTimes(4);

    touch.mockClear();
    await vault.service.listSummaries();
    expect(touch).not.toHaveBeenCalled();
  });
});

describe('keyId 校验:库被导入或替换之后,旧会话不能再写', () => {
  /** 用另一个保险箱的 wrapper 替换当前库的 vaultKeys,等于"导入了别的备份" */
  async function replaceWithOtherVault(vault: TestVault) {
    const other = await createInitializedVault();
    await vault.db.vaultKeys.put((await other.db.vaultKeys.get('singleton'))!);
  }

  test('createRecord:ConflictError,什么都不写', async () => {
    const { vault } = await vaultWithClock();
    await replaceWithOtherVault(vault);
    const before = await snapshotVault(vault.db);

    await expect(vault.service.createRecord(FULL)).rejects.toBeInstanceOf(ConflictError);

    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('updateRecord 与 deleteRecord:ConflictError,记录原样保留', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await replaceWithOtherVault(vault);
    const before = await snapshotVault(vault.db);

    await expect(vault.service.updateRecord(id, { ...FULL, title: 'x' })).rejects.toBeInstanceOf(ConflictError);
    await expect(vault.service.deleteRecord(id)).rejects.toBeInstanceOf(ConflictError);

    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('vaultKeys 被整个删掉:同样 ConflictError', async () => {
    const { vault } = await vaultWithClock();
    await vault.db.vaultKeys.clear();
    await expect(vault.service.createRecord(FULL)).rejects.toBeInstanceOf(ConflictError);
    expect(await vault.db.vaultRecords.count()).toBe(0);
  });

  test('改主密码/Recovery 不改 keyId,所以不会误伤正常写入', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.changeMasterPassword(PASSWORD, 'brand new passphrase');
    await vault.service.rotateRecoveryKey('brand new passphrase', async () => {});

    await expect(vault.service.createRecord(FULL)).resolves.toEqual(expect.any(String));
  });
});

describe('事务中途失败:没有部分写入', () => {
  test('createRecord', async () => {
    const { vault } = await vaultWithClock();
    vi.spyOn(vault.db.vaultRecords, 'add').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.createRecord(FULL)).rejects.toThrow('injected');

    expect(await vault.db.vaultRecords.count()).toBe(0);
    await expect(vault.service.createRecord(FULL)).resolves.toEqual(expect.any(String));
  });

  test('updateRecord:原记录原样保留', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const before = await snapshotVault(vault.db);
    vi.spyOn(vault.db.vaultRecords, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.updateRecord(id, { ...FULL, title: 'x' })).rejects.toThrow('injected');

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect((await vault.service.getSecret(id)).title).toBe(FULL.title);
  });

  test('deleteRecord:记录仍在', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    vi.spyOn(vault.db.vaultRecords, 'delete').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.deleteRecord(id)).rejects.toThrow('injected');

    expect(await vault.db.vaultRecords.count()).toBe(1);
  });
});

describe('IndexedDB 里不含明文', () => {
  test('扫描记录与 wrapper 的原始字节,找不到任何已知明文', async () => {
    const { vault } = await vaultWithClock();
    await vault.service.createRecord(FULL);

    const encoder = new TextEncoder();
    const needles = [FULL.secret, FULL.title, FULL.username!, FULL.url!, FULL.notes!, 'prod', 'aws', PASSWORD].map(s =>
      encoder.encode(s)
    );
    const rows = await vault.db.vaultRecords.toArray();
    const keys = (await vault.db.vaultKeys.get('singleton'))!;
    const binaries = [
      ...rows.flatMap(r => [r.summary.data, r.summary.iv, r.secret.data, r.secret.iv, r.keyId]),
      keys.wrapper.master.wrappedKey,
      keys.wrapper.recovery.wrappedKey,
    ];
    for (const bytes of binaries) {
      for (const needle of needles) expect(containsSubarray(bytes, needle)).toBe(false);
    }
  });

  test('记录行里只有 type 与时间戳是明文,没有多出来的字段', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    const row = (await vault.db.vaultRecords.get(id))!;

    expect(Object.keys(row).sort()).toEqual([
      'createdAt',
      'formatVersion',
      'id',
      'keyId',
      'secret',
      'summary',
      'type',
      'updatedAt',
    ]);
    expect(Object.keys(row.summary).sort()).toEqual(['data', 'iv']);
    expect(Object.keys(row.secret).sort()).toEqual(['data', 'iv']);
  });
});

describe('篡改检测', () => {
  test('改了明文的 type:详情 AuthError,列表标记 unreadable', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => (row.type = 'password'));

    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(AuthError);
    const [item] = await vault.service.listSummaries();
    expect(item).toMatchObject({ id, unreadable: true, title: '' });
  });

  test('把 A 记录的密文放到 B 记录上:AuthError', async () => {
    const { vault } = await vaultWithClock();
    const a = await vault.service.createRecord({ ...FULL, title: 'A', secret: 'secret-of-A' });
    const b = await vault.service.createRecord({ ...FULL, title: 'B', secret: 'secret-of-B' });
    const rowA = (await vault.db.vaultRecords.get(a))!;
    await tamperRecord(vault, b, row => {
      row.summary = rowA.summary;
      row.secret = rowA.secret;
    });

    await expect(vault.service.getSecret(b)).rejects.toBeInstanceOf(AuthError);
  });

  test('summary 与 secret 两段互换:AuthError', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => [row.summary, row.secret] = [row.secret, row.summary]);

    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(AuthError);
  });

  test('secret 段被改了一个字节:详情 AuthError,列表不受影响(列表不碰 secret 段)', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => (row.secret.data[0] ^= 1));

    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(AuthError);
    const [item] = await vault.service.listSummaries();
    expect(item).toMatchObject({ id, title: FULL.title });
    expect(item.unreadable).toBeUndefined();
  });

  test('iv 被截断:CorruptError', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => (row.summary.iv = new Uint8Array(8)));

    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(CorruptError);
    expect((await vault.service.listSummaries())[0].unreadable).toBe(true);
  });

  test('formatVersion 不认识:CorruptError', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => ((row as { formatVersion: number }).formatVersion = 2));

    await expect(vault.service.getSecret(id)).rejects.toBeInstanceOf(CorruptError);
    expect((await vault.service.listSummaries())[0].unreadable).toBe(true);
  });

  test('一条坏记录不会拖垮整个列表', async () => {
    const { vault } = await vaultWithClock();
    const good1 = await vault.service.createRecord({ ...FULL, title: 'good-1' });
    const bad = await vault.service.createRecord({ ...FULL, title: 'bad' });
    const good2 = await vault.service.createRecord({ ...FULL, title: 'good-2' });
    await tamperRecord(vault, bad, row => (row.summary.data[0] ^= 1));

    const list = await vault.service.listSummaries();

    expect(list).toHaveLength(3);
    expect(list.find(s => s.id === bad)).toMatchObject({ unreadable: true, title: '' });
    expect(list.find(s => s.id === good1)).toMatchObject({ title: 'good-1' });
    expect(list.find(s => s.id === good2)).toMatchObject({ title: 'good-2' });
    expect(list.filter(s => s.unreadable)).toHaveLength(1);
  });

  test('用另一个 Vault Key 加密的记录(比如库里混进了别的保险箱的数据)标记 unreadable', async () => {
    const { vault } = await vaultWithClock();
    const other = await createInitializedVault();
    const foreignId = await other.service.createRecord(FULL);
    await vault.db.vaultRecords.put((await other.db.vaultRecords.get(foreignId))!);

    expect((await vault.service.listSummaries())[0]).toMatchObject({ id: foreignId, unreadable: true });
    await expect(vault.service.getSecret(foreignId)).rejects.toBeInstanceOf(AuthError);
  });

  test('错误对象不携带记录内容', async () => {
    const { vault } = await vaultWithClock();
    const id = await vault.service.createRecord(FULL);
    await tamperRecord(vault, id, row => (row.secret.data[0] ^= 1));

    const error = await vault.service.getSecret(id).catch(e => e);

    const text = JSON.stringify({ name: error.name, message: error.message });
    for (const word of [FULL.secret, FULL.title, FULL.username!]) expect(text).not.toContain(word);
  });
});
