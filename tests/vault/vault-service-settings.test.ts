import { afterEach, describe, expect, test, vi } from 'vitest';
import { VaultLockedError } from '../../src/vault/crypto/errors';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../../src/vault/types';
import {
  PASSWORD,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  sleep,
  snapshotVault,
} from '../helpers/vault';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await disposeTestVaults();
});

const ONE_MINUTE = 60_000;
const FIFTEEN_MINUTES = 900_000;

/** 一个已初始化的保险箱,加上共用同一个库、也已解锁的第二个面板 */
async function twoPanels() {
  const a = await createInitializedVault();
  const b = createTestVault({ peerOf: a });
  await b.service.unlockWithMasterPassword(PASSWORD);
  return { a, b };
}

/** 只伪造 Date,不动 setTimeout 等,免得影响 IndexedDB 的异步。必须在创建会话之前调用 */
function fakeDate(start = 1_000_000) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
  return start;
}

describe('保存与生效', () => {
  test('初始化之后:库里是默认的 5 分钟,会话里也是', async () => {
    const vault = await createInitializedVault();
    expect(await vault.service.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
  });

  test('初始化会把新库的默认值推给会话,不管会话之前缓存过什么', async () => {
    const vault = createTestVault();
    vault.session.setAutoLockTimeoutMs(ONE_MINUTE); // 比如这个会话之前属于另一个保险箱
    await vault.service.initialize(PASSWORD, async () => {});
    expect(vault.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
  });

  test.each([ONE_MINUTE, 300_000, FIFTEEN_MINUTES, 0])(
    'setAutoLockTimeout(%s):写进库,本面板的会话立即生效',
    async ms => {
      const vault = await createInitializedVault();
      await vault.service.setAutoLockTimeout(ms);

      expect(await vault.db.vaultSettings.get('singleton')).toEqual({ id: 'singleton', autoLockTimeoutMs: ms });
      expect(await vault.service.getAutoLockTimeout()).toBe(ms);
      expect(vault.session.getAutoLockTimeoutMs()).toBe(ms);
    }
  );

  test('只动 vaultSettings:vaultKeys、记录、快照原样不变', async () => {
    const vault = await createInitializedVault();
    await vault.service.createRecord({ type: 'api_key', title: 't', secret: 's' });
    const before = await snapshotVault(vault.db);

    await vault.service.setAutoLockTimeout(ONE_MINUTE);

    const after = await snapshotVault(vault.db);
    expect(after.keys).toEqual(before.keys); // revision 也没变:不会让别的面板的改密码提交冲突
    expect(after.records).toEqual(before.records);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.settings).not.toEqual(before.settings);
  });

  test('不要求已解锁就能读(解锁流程自己也要读它)', async () => {
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(ONE_MINUTE);
    vault.session.lock();
    expect(await vault.service.getAutoLockTimeout()).toBe(ONE_MINUTE);
  });

  test('端到端:改成 1 分钟之后,另一个面板解锁,61 秒没操作就被自动锁定', async () => {
    const start = fakeDate();
    const a = await createInitializedVault();
    await a.service.setAutoLockTimeout(ONE_MINUTE);

    const p = createTestVault({ peerOf: a }); // 全新的会话,自己还不知道设置
    await p.service.unlockWithMasterPassword(PASSWORD);
    expect(p.session.getAutoLockTimeoutMs()).toBe(ONE_MINUTE);

    vi.setSystemTime(start + 61_000);
    p.session.checkIdle();
    expect(p.session.isOpen()).toBe(false);
  });

  test('对照:没改设置时同样的 61 秒不会锁定(默认是 5 分钟),上一个测试不是碰巧通过', async () => {
    const start = fakeDate();
    const vault = await createInitializedVault();

    vi.setSystemTime(start + 61_000);
    vault.session.checkIdle();
    expect(vault.session.isOpen()).toBe(true);

    vi.setSystemTime(start + 301_000);
    vault.session.checkIdle();
    expect(vault.session.isOpen()).toBe(false);
  });

  test('改成 Never 之后,过了很久也不会自动锁定', async () => {
    const start = fakeDate();
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(0);

    vi.setSystemTime(start + 10 ** 11);
    vault.session.checkIdle();
    expect(vault.session.isOpen()).toBe(true);
  });

  test('改设置算一次有效活动:刷新自动锁定的计时', async () => {
    const start = fakeDate();
    const vault = await createInitializedVault();

    vi.setSystemTime(start + 50_000);
    await vault.service.setAutoLockTimeout(ONE_MINUTE); // 这一刻刷新计时

    vi.setSystemTime(start + 100_000); // 距上次操作 50 秒,距打开 100 秒
    vault.session.checkIdle();
    expect(vault.session.isOpen()).toBe(true); // 如果没刷新计时,100 秒已经超过 1 分钟

    vi.setSystemTime(start + 111_000); // 距上次操作 61 秒
    vault.session.checkIdle();
    expect(vault.session.isOpen()).toBe(false);
  });
});

describe('解锁、恢复时把已保存的值推给会话', () => {
  test('主密码解锁:全新的会话读到库里保存的值', async () => {
    const a = await createInitializedVault();
    await a.service.setAutoLockTimeout(FIFTEEN_MINUTES);

    const p = createTestVault({ peerOf: a });
    expect(p.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS); // 还没读
    await p.service.unlockWithMasterPassword(PASSWORD);
    expect(p.session.getAutoLockTimeoutMs()).toBe(FIFTEEN_MINUTES);
  });

  test('Recovery Key 解锁:同样读到', async () => {
    const a = await createInitializedVault();
    await a.service.setAutoLockTimeout(FIFTEEN_MINUTES);

    const p = createTestVault({ peerOf: a });
    await p.service.unlockWithRecoveryKey(a.recoveryKey);
    expect(p.session.getAutoLockTimeoutMs()).toBe(FIFTEEN_MINUTES);
  });

  test('recoverAccess:同样读到,而且提交之后没有多出可能失败的读库', async () => {
    const a = await createInitializedVault();
    await a.service.setAutoLockTimeout(FIFTEEN_MINUTES);

    const p = createTestVault({ peerOf: a });
    await p.service.recoverAccess(a.recoveryKey, 'a brand new passphrase 2026');
    expect(p.session.isOpen()).toBe(true);
    expect(p.session.getAutoLockTimeoutMs()).toBe(FIFTEEN_MINUTES);
  });

  test('recoverAccess 读设置失败:恢复照常成功,不会让调用方以为没改成', async () => {
    const a = await createInitializedVault();
    await a.service.setAutoLockTimeout(FIFTEEN_MINUTES);

    const p = createTestVault({ peerOf: a });
    vi.spyOn(p.db.vaultSettings, 'get').mockRejectedValue(new Error('injected'));

    await expect(p.service.recoverAccess(a.recoveryKey, 'a brand new passphrase 2026')).resolves.toEqual({
      accessRestored: true,
      rotationRequired: true,
    });
    expect(p.session.isOpen()).toBe(true);
    expect(p.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
  });

  test('读设置失败不阻止解锁:用默认值', async () => {
    const vault = await createInitializedVault();
    vault.session.setAutoLockTimeoutMs(ONE_MINUTE); // 会话里原来缓存的是 1 分钟
    vault.session.lock();
    vi.spyOn(vault.db.vaultSettings, 'get').mockRejectedValue(new Error('injected'));

    await vault.service.unlockWithMasterPassword(PASSWORD);

    expect(vault.session.isOpen()).toBe(true);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
  });

  test('读设置失败同样不阻止 Recovery Key 解锁', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    vi.spyOn(vault.db.vaultSettings, 'get').mockRejectedValue(new Error('injected'));

    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);

    expect(vault.session.isOpen()).toBe(true);
  });

  test('getAutoLockTimeout 自己读库失败时会抛,不吞(吞错只发生在解锁路径)', async () => {
    const vault = await createInitializedVault();
    vi.spyOn(vault.db.vaultSettings, 'get').mockRejectedValue(new Error('injected'));
    await expect(vault.service.getAutoLockTimeout()).rejects.toThrow('injected');
  });
});

describe('库里的值缺失或不合法', () => {
  test('这一行不存在:读到默认值,解锁后会话也是默认值', async () => {
    const vault = await createInitializedVault();
    await vault.db.vaultSettings.clear();
    vault.session.setAutoLockTimeoutMs(ONE_MINUTE);
    vault.session.lock();

    expect(await vault.service.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    await vault.service.unlockWithMasterPassword(PASSWORD);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
  });

  test.each([7, -5, 299_999, NaN, 'abc', null])('库里是 %s:当作默认值,不抛错,也不改写库', async bad => {
    const vault = await createInitializedVault();
    await vault.db.vaultSettings.put({ id: 'singleton', autoLockTimeoutMs: bad as unknown as number });
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await vault.service.unlockWithMasterPassword(PASSWORD);

    expect(await vault.service.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    expect(await snapshotVault(vault.db)).toEqual(before);
  });
});

describe('setAutoLockTimeout 的前置条件与失败', () => {
  test.each([123, -1, 0.5, NaN, Infinity, 299_999, 1_800_000])('不在可选范围内的值 %s:TypeError,库和会话都不变', async bad => {
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(ONE_MINUTE);
    const before = await snapshotVault(vault.db);

    await expect(vault.service.setAutoLockTimeout(bad as never)).rejects.toBeInstanceOf(TypeError);

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(ONE_MINUTE);
  });

  test.each(['60000', null, undefined, {}, true])('不是数字的值 %s:TypeError', async bad => {
    const vault = await createInitializedVault();
    await expect(vault.service.setAutoLockTimeout(bad as never)).rejects.toBeInstanceOf(TypeError);
  });

  test('已锁定:VaultLockedError,什么都没写', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await expect(vault.service.setAutoLockTimeout(ONE_MINUTE)).rejects.toBeInstanceOf(VaultLockedError);

    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('保险箱还没创建:VaultLockedError,没有凭空写出设置', async () => {
    const vault = createTestVault();
    await expect(vault.service.setAutoLockTimeout(ONE_MINUTE)).rejects.toBeInstanceOf(VaultLockedError);
    expect(await vault.db.vaultSettings.count()).toBe(0);
  });

  test('写库失败:抛出原错误,会话里的值不变,也不通知其他面板', async () => {
    const { a, b } = await twoPanels();
    const heard = vi.fn();
    b.session.onSettingsChanged(heard);
    vi.spyOn(a.db.vaultSettings, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(a.service.setAutoLockTimeout(ONE_MINUTE)).rejects.toThrow('injected');

    expect(a.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS); // 内存和库一致
    expect(await a.service.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
    await sleep(100);
    expect(heard).not.toHaveBeenCalled();
  });

  test('被锁定的会话上调用,写之前就失败:不会通知其他面板', async () => {
    const { a, b } = await twoPanels();
    const heard = vi.fn();
    b.session.onSettingsChanged(heard);
    a.session.lockLocal();

    await expect(a.service.setAutoLockTimeout(ONE_MINUTE)).rejects.toBeInstanceOf(VaultLockedError);

    await sleep(100);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('跨面板', () => {
  test('一个面板改了:另一个面板的会话跟着更新,而且不会被锁定', async () => {
    const { a, b } = await twoPanels();
    const epochB = b.session.getEpoch();
    expect(b.session.getAutoLockTimeoutMs()).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);

    await a.service.setAutoLockTimeout(ONE_MINUTE);

    await vi.waitFor(() => expect(b.session.getAutoLockTimeoutMs()).toBe(ONE_MINUTE));
    expect(b.session.isOpen()).toBe(true);
    expect(b.session.getEpoch()).toBe(epochB);
    expect(a.session.isOpen()).toBe(true);
  });

  test('刷新读库失败:保持当前值,不会悄悄改回默认值', async () => {
    const { a, b } = await twoPanels();
    await a.service.setAutoLockTimeout(ONE_MINUTE);
    await vi.waitFor(() => expect(b.session.getAutoLockTimeoutMs()).toBe(ONE_MINUTE));

    vi.spyOn(b.db.vaultSettings, 'get').mockRejectedValue(new Error('injected'));
    await a.service.setAutoLockTimeout(FIFTEEN_MINUTES);
    await sleep(150);

    // 不是 5 分钟(默认值),也不是 15 分钟(读不到),而是它原来的 1 分钟
    expect(b.session.getAutoLockTimeoutMs()).toBe(ONE_MINUTE);
    expect(b.session.isOpen()).toBe(true);
  });

  test('两个面板几乎同时改:最后各自的会话都和库里的最终值一致', async () => {
    const { a, b } = await twoPanels();

    await Promise.all([a.service.setAutoLockTimeout(ONE_MINUTE), b.service.setAutoLockTimeout(FIFTEEN_MINUTES)]);

    const final = await a.service.getAutoLockTimeout();
    await vi.waitFor(() => {
      expect(a.session.getAutoLockTimeoutMs()).toBe(final);
      expect(b.session.getAutoLockTimeoutMs()).toBe(final);
    });
  });

  test('锁定类广播的行为不变:改主密码仍然会锁定其他面板', async () => {
    const { a, b } = await twoPanels();
    await a.service.changeMasterPassword(PASSWORD, 'a brand new passphrase 2026');
    await vi.waitFor(() => expect(b.session.isOpen()).toBe(false));
    expect(a.session.isOpen()).toBe(true);
  });
});
