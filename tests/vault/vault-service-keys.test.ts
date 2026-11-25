import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AuthError,
  ConflictError,
  CorruptError,
  NotInitializedError,
  RecoveryKeyChecksumError,
  RecoveryKeyFormatError,
} from '../../src/vault/crypto/errors';
import {
  PASSWORD,
  createBarrier,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  isZeroed,
  sleep,
  snapshotVault,
  tamperKeys,
  toHex,
  trackKeyMaterial,
  type TestVault,
} from '../helpers/vault';

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeTestVaults();
});

const NEW_PASSWORD = 'a brand new passphrase 2026';

/** 一个已初始化的保险箱,加上共用同一个库的第二个面板(也已打开) */
async function twoPanels() {
  const a = await createInitializedVault();
  const b = createTestVault({ peerOf: a });
  await b.service.unlockWithMasterPassword(PASSWORD);
  return { a, b };
}

/** 让指定实例的 wrap 在这里停一下,把并发操作卡在"已经读过库、还没提交"的位置 */
function pauseAtWrap(vault: TestVault, wait: () => Promise<void>) {
  const wrap = vault.crypto.wrap.bind(vault.crypto);
  vi.spyOn(vault.crypto, 'wrap').mockImplementation(async (...args) => {
    await wait();
    return wrap(...args);
  });
}

async function expectLocked(vault: TestVault) {
  await vi.waitFor(() => expect(vault.session.isOpen()).toBe(false));
}

async function expectStillOpen(vault: TestVault) {
  await sleep(80); // 给广播留出到达的时间,再断言它没有到达
  expect(vault.session.isOpen()).toBe(true);
}

describe('changeMasterPassword', () => {
  test('旧密码失效、新密码可用、记录完整', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'api_key', title: 'Prod', secret: 'sk-123' });

    await vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    vault.session.lock();
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
    expect((await vault.service.getSecret(id)).secret).toBe('sk-123');
  });

  test('只换 master wrapper:Recovery wrapper 与 keyId 不变,revision + 1,salt 更新', async () => {
    const vault = await createInitializedVault();
    const before = (await vault.db.vaultKeys.get('singleton'))!;

    await vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    const after = (await vault.db.vaultKeys.get('singleton'))!;
    expect(after.wrapper.recovery).toEqual(before.wrapper.recovery);
    expect(toHex(after.wrapper.keyId)).toBe(toHex(before.wrapper.keyId));
    expect(after.wrapper.revision).toBe(before.wrapper.revision + 1);
    expect(after.recoveryRotationRequired).toBe(before.recoveryRotationRequired);
    expect(toHex(after.wrapper.master.wrappedKey)).not.toBe(toHex(before.wrapper.master.wrappedKey));
    expect(toHex((after.wrapper.master.kdf as { salt: Uint8Array }).salt)).not.toBe(
      toHex((before.wrapper.master.kdf as { salt: Uint8Array }).salt)
    );

    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey); // 改主密码不影响 Recovery Key
  });

  test('当前密码错误:AuthError,库不变,不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);

    await expect(a.service.changeMasterPassword('wrong', NEW_PASSWORD)).rejects.toBeInstanceOf(AuthError);

    expect(await snapshotVault(a.db)).toEqual(before);
    await expectStillOpen(b);
  });

  test('不碰当前会话:保持打开,epoch 不变', async () => {
    const vault = await createInitializedVault();
    const epoch = vault.session.getEpoch();

    await vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    expect(vault.session.isOpen()).toBe(true);
    expect(vault.session.getEpoch()).toBe(epoch);
  });

  test('提交后广播 wrapper-changed:其他面板被锁定,当前面板不受影响', async () => {
    const { a, b } = await twoPanels();

    await a.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    await expectLocked(b);
    expect(a.session.isOpen()).toBe(true);
  });

  test('新密码为空:TypeError,库不变', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    await expect(vault.service.changeMasterPassword(PASSWORD, '')).rejects.toBeInstanceOf(TypeError);
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('未初始化:NotInitializedError', async () => {
    const vault = createTestVault();
    await expect(vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD)).rejects.toBeInstanceOf(
      NotInitializedError
    );
  });

  test('提交前试解失败(新 wrapper 不能还原 Vault Key):不写库,不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);
    const wrap = a.crypto.wrap.bind(a.crypto);
    vi.spyOn(a.crypto, 'wrap').mockImplementation(async (...args) => {
      const wrapped = await wrap(...args);
      wrapped.wrappedKey[0] ^= 1; // 模拟包装出了问题
      return wrapped;
    });

    await expect(a.service.changeMasterPassword(PASSWORD, NEW_PASSWORD)).rejects.toBeInstanceOf(AuthError);

    expect(await snapshotVault(a.db)).toEqual(before);
    await expectStillOpen(b);
  });

  test('事务中途失败:旧 wrapper 原样保留,旧密码仍可用,新密码不可用,不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);
    vi.spyOn(a.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(a.service.changeMasterPassword(PASSWORD, NEW_PASSWORD)).rejects.toThrow('injected');

    expect(await snapshotVault(a.db)).toEqual(before);
    await a.service.verifyMasterPassword(PASSWORD);
    await expect(a.service.verifyMasterPassword(NEW_PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await expectStillOpen(b);
  });

  test('原始 Vault Key 字节清零,包括失败的路径', async () => {
    const vault = await createInitializedVault();
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);
    await expect(vault.service.changeMasterPassword('wrong', 'x')).rejects.toBeInstanceOf(AuthError);
    vi.spyOn(vault.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));
    await expect(vault.service.changeMasterPassword(NEW_PASSWORD, 'another')).rejects.toThrow('injected');

    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(isZeroed)).toBe(true);
  });
});

describe('并发与乐观锁', () => {
  test('两个实例同时改主密码(都已读过库):一个成功,另一个 ConflictError,revision 只加一次', async () => {
    const { a, b } = await twoPanels();
    const barrier = createBarrier(2);
    pauseAtWrap(a, barrier.wait);
    pauseAtWrap(b, barrier.wait);
    const before = (await a.db.vaultKeys.get('singleton'))!;

    const [resultA, resultB] = await Promise.allSettled([
      a.service.changeMasterPassword(PASSWORD, 'password chosen by A'),
      b.service.changeMasterPassword(PASSWORD, 'password chosen by B'),
    ]);

    expect([resultA, resultB].filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = [resultA, resultB].find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);

    const after = (await a.db.vaultKeys.get('singleton'))!;
    expect(after.wrapper.revision).toBe(before.wrapper.revision + 1);

    const [winnerPassword, loserPassword] =
      resultA.status === 'fulfilled'
        ? ['password chosen by A', 'password chosen by B']
        : ['password chosen by B', 'password chosen by A'];
    await a.service.verifyMasterPassword(winnerPassword);
    await expect(a.service.verifyMasterPassword(loserPassword)).rejects.toBeInstanceOf(AuthError);
  });

  test('改主密码与重新生成 Recovery Key 并发:后到的抛 ConflictError,不会把旧 recovery wrapper 写回去', async () => {
    const { a, b } = await twoPanels();
    const gate = createGate();
    pauseAtWrap(b, gate.wait); // b 改主密码:读了库(revision 1)之后停住

    const pendingChange = b.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);
    pendingChange.catch(() => {});
    await sleep(30);

    let newRecoveryKey = '';
    await a.service.rotateRecoveryKey(PASSWORD, async formatted => {
      newRecoveryKey = formatted;
    });
    gate.release();

    await expect(pendingChange).rejects.toBeInstanceOf(ConflictError);

    // 库里是新的 recovery wrapper,没有被 b 手里读到的旧版本覆盖
    a.session.lock();
    await a.service.unlockWithRecoveryKey(newRecoveryKey);
    a.session.lock();
    await expect(a.service.unlockWithRecoveryKey(a.recoveryKey)).rejects.toBeInstanceOf(AuthError);
    // b 的主密码修改没有生效
    await a.service.unlockWithMasterPassword(PASSWORD);
    await expect(a.service.unlockWithMasterPassword(NEW_PASSWORD)).rejects.toBeInstanceOf(AuthError);
  });

  test('revision 相同但 keyId 不同(库被整体替换):ConflictError', async () => {
    const { a, b } = await twoPanels();
    const gate = createGate();
    pauseAtWrap(b, gate.wait);

    const pending = b.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);
    pending.catch(() => {});
    await sleep(30);
    const keys = (await a.db.vaultKeys.get('singleton'))!;
    keys.wrapper.keyId = new Uint8Array(8).fill(7); // revision 没变
    await a.db.vaultKeys.put(keys);
    gate.release();

    await expect(pending).rejects.toBeInstanceOf(ConflictError);
  });

  test('提交被冲突拒绝时不广播', async () => {
    const { a, b } = await twoPanels();
    const gate = createGate();
    pauseAtWrap(b, gate.wait);
    const pending = b.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);
    pending.catch(() => {});
    await sleep(30);

    const keys = (await a.db.vaultKeys.get('singleton'))!;
    keys.wrapper.revision += 1;
    await a.db.vaultKeys.put(keys);
    const subscriber = vi.fn();
    a.session.subscribe(subscriber);
    gate.release();
    await expect(pending).rejects.toBeInstanceOf(ConflictError);

    await expectStillOpen(a);
    expect(subscriber).not.toHaveBeenCalled();
  });
});

describe('Recovery 步骤一:recoverAccess', () => {
  test('新主密码立即生效,标记需要轮换,Session 打开,记录完整', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: 'Mail', secret: 'hunter2' });
    vault.session.lock();

    const result = await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    expect(result).toEqual({ accessRestored: true, rotationRequired: true });
    expect(vault.session.isOpen()).toBe(true);
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(true);
    expect((await vault.service.getSecret(id)).secret).toBe('hunter2');

    vault.session.lock();
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
    vault.session.lock();
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(AuthError);
  });

  test('旧 Recovery Key 仍然有效,recovery wrapper 原样保留', async () => {
    const vault = await createInitializedVault();
    const before = (await vault.db.vaultKeys.get('singleton'))!;
    vault.session.lock();

    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    const after = (await vault.db.vaultKeys.get('singleton'))!;
    expect(after.wrapper.recovery).toEqual(before.wrapper.recovery);
    expect(after.wrapper.revision).toBe(before.wrapper.revision + 1);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test.each([
    ['格式错误', () => 'garbage', RecoveryKeyFormatError],
    ['校验和错误', (k: string) => k.slice(0, 8) + (k.charAt(8) === 'A' ? 'B' : 'A') + k.slice(9), RecoveryKeyChecksumError],
  ])('Recovery Key %s:对应的错误,库不变,Session 不打开', async (_name, corrupt, errorClass) => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await expect(vault.service.recoverAccess(corrupt(vault.recoveryKey), NEW_PASSWORD)).rejects.toBeInstanceOf(
      errorClass
    );

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('格式正确但不是这个保险箱的 Key:AuthError,库不变', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);
    const other = await vault.crypto.generateRecoveryKey();

    await expect(vault.service.recoverAccess(other.formatted, NEW_PASSWORD)).rejects.toBeInstanceOf(AuthError);

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('新主密码为空:TypeError,库不变', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    await expect(vault.service.recoverAccess(vault.recoveryKey, '')).rejects.toBeInstanceOf(TypeError);
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('事务中途失败:旧主密码与 Recovery Key 都仍可用,不标记轮换,Session 不打开', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);
    vi.spyOn(vault.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD)).rejects.toThrow('injected');

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(vault.session.isOpen()).toBe(false);
    await vault.service.unlockWithMasterPassword(PASSWORD);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test('提交时遇到并发修改:ConflictError,不覆盖别人的写入,Session 不打开', async () => {
    const { a, b } = await twoPanels();
    a.session.lock();
    const gate = createGate();
    pauseAtWrap(a, gate.wait);

    const pending = a.service.recoverAccess(a.recoveryKey, NEW_PASSWORD);
    pending.catch(() => {});
    await sleep(30);
    await b.service.changeMasterPassword(PASSWORD, 'changed by the other panel');
    const after = await snapshotVault(b.db);
    gate.release();

    await expect(pending).rejects.toBeInstanceOf(ConflictError);
    expect(await snapshotVault(a.db)).toEqual(after);
    expect(a.session.isOpen()).toBe(false);
  });

  test('提交之后不因期间被锁定而报错:库已经改成功了,不能让调用方以为没改成,会话照常打开', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();

    const pending = vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
    vault.session.lockLocal(); // 期间收到别处的锁定广播

    await expect(pending).resolves.toEqual({ accessRestored: true, rotationRequired: true });
    expect(vault.session.isOpen()).toBe(true);
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(true);
  });

  test('提交后广播:其他面板被锁定', async () => {
    const { a, b } = await twoPanels();
    a.session.lock();
    await expectLocked(b); // a.lock() 本身也会广播,先让它落地
    await b.service.unlockWithMasterPassword(PASSWORD);

    await a.service.recoverAccess(a.recoveryKey, NEW_PASSWORD);

    await expectLocked(b);
  });

  test('原始字节都已清零', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    expect(tracked.length).toBeGreaterThanOrEqual(3);
    expect(tracked.every(isZeroed)).toBe(true);
  });
});

describe('Recovery 步骤二:rotateRecoveryKey', () => {
  test('步骤一后回调取消:新主密码与旧 Recovery Key 都可用,仍标记需要轮换', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
    const before = await snapshotVault(vault.db);

    await expect(
      vault.service.rotateRecoveryKey(NEW_PASSWORD, async () => {
        throw new Error('cancel');
      })
    ).rejects.toThrow('cancel');

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(true);
    vault.session.lock();
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test('步骤二完成:新 Recovery Key 可用,旧的不再能解开当前库,轮换标记清除', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
    let newKey = '';

    await vault.service.rotateRecoveryKey(NEW_PASSWORD, async formatted => {
      newKey = formatted;
    });

    expect(newKey).not.toBe(vault.recoveryKey);
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(false);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(newKey);
    vault.session.lock();
    await expect(vault.service.unlockWithRecoveryKey(vault.recoveryKey)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD); // 主密码不受影响
  });

  test('只换 recovery wrapper:master wrapper 与 keyId 不变,revision + 1', async () => {
    const vault = await createInitializedVault();
    const before = (await vault.db.vaultKeys.get('singleton'))!;

    await vault.service.rotateRecoveryKey(PASSWORD, async () => {});

    const after = (await vault.db.vaultKeys.get('singleton'))!;
    expect(after.wrapper.master).toEqual(before.wrapper.master);
    expect(toHex(after.wrapper.keyId)).toBe(toHex(before.wrapper.keyId));
    expect(after.wrapper.revision).toBe(before.wrapper.revision + 1);
    expect(toHex(after.wrapper.recovery.wrappedKey)).not.toBe(toHex(before.wrapper.recovery.wrappedKey));
  });

  test('Settings 里重新生成(没有待轮换标记时):同样可用,标记保持 false', async () => {
    const vault = await createInitializedVault();
    let newKey = '';
    await vault.service.rotateRecoveryKey(PASSWORD, async formatted => {
      newKey = formatted;
    });

    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(false);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(newKey);
  });

  test('提交前试解失败(新 recovery wrapper 不能还原 Vault Key):不调用回调,不写库,不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);
    const wrap = a.crypto.wrap.bind(a.crypto);
    vi.spyOn(a.crypto, 'wrap').mockImplementation(async (...args) => {
      const wrapped = await wrap(...args);
      wrapped.wrappedKey[0] ^= 1;
      return wrapped;
    });
    const callback = vi.fn(async () => {});

    await expect(a.service.rotateRecoveryKey(PASSWORD, callback)).rejects.toBeInstanceOf(AuthError);

    expect(callback).not.toHaveBeenCalled(); // 不能让用户抄下一个根本解不开的 Key
    expect(await snapshotVault(a.db)).toEqual(before);
    await expectStillOpen(b);
  });

  test('需要主密码:错误时抛 AuthError,不调用回调,库不变', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    const callback = vi.fn(async () => {});

    await expect(vault.service.rotateRecoveryKey('wrong', callback)).rejects.toBeInstanceOf(AuthError);

    expect(callback).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('回调被调用时库里还没有变化,Session 不受影响', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    const epoch = vault.session.getEpoch();
    let seen: Awaited<ReturnType<typeof snapshotVault>> | undefined;

    await vault.service.rotateRecoveryKey(PASSWORD, async () => {
      seen = await snapshotVault(vault.db);
    });

    expect(seen).toEqual(before);
    expect(vault.session.getEpoch()).toBe(epoch);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('等用户抄写期间,原始 Vault Key 和新 Recovery Key 的字节都已清零', async () => {
    const vault = await createInitializedVault();
    const tracked = trackKeyMaterial(vault.crypto);
    let zeroedDuringCallback: boolean | undefined;

    await vault.service.rotateRecoveryKey(PASSWORD, async () => {
      zeroedDuringCallback = tracked.length > 0 && tracked.every(isZeroed);
    });

    expect(zeroedDuringCallback).toBe(true);
  });

  test('回调取消时原始字节也已清零', async () => {
    const vault = await createInitializedVault();
    const tracked = trackKeyMaterial(vault.crypto);
    await expect(
      vault.service.rotateRecoveryKey(PASSWORD, async () => {
        throw new Error('cancel');
      })
    ).rejects.toThrow('cancel');
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(isZeroed)).toBe(true);
  });

  test('用户抄写期间别的面板改了主密码:ConflictError,旧 Recovery Key 仍可用', async () => {
    const { a, b } = await twoPanels();
    let shownKey = '';

    await expect(
      a.service.rotateRecoveryKey(PASSWORD, async formatted => {
        shownKey = formatted;
        await b.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);
      })
    ).rejects.toBeInstanceOf(ConflictError);

    a.session.lock();
    await a.service.unlockWithRecoveryKey(a.recoveryKey); // 旧 Key 还在
    a.session.lock();
    await expect(a.service.unlockWithRecoveryKey(shownKey)).rejects.toBeInstanceOf(AuthError); // 没写入的新 Key 无效
  });

  test('事务中途失败:旧 Recovery Key 仍可用,轮换标记不变,不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);
    vi.spyOn(a.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(a.service.rotateRecoveryKey(PASSWORD, async () => {})).rejects.toThrow('injected');

    expect(await snapshotVault(a.db)).toEqual(before);
    await expectStillOpen(b); // 必须在任何 lock() 之前检查:lock() 自己也会广播
    a.session.lock();
    await a.service.unlockWithRecoveryKey(a.recoveryKey);
  });

  test('提交后广播:其他面板被锁定,当前面板保持打开', async () => {
    const { a, b } = await twoPanels();
    await a.service.rotateRecoveryKey(PASSWORD, async () => {});
    await expectLocked(b);
    expect(a.session.isOpen()).toBe(true);
  });

  test('未初始化:NotInitializedError', async () => {
    const vault = createTestVault();
    await expect(vault.service.rotateRecoveryKey(PASSWORD, async () => {})).rejects.toBeInstanceOf(
      NotInitializedError
    );
  });
});

describe('isRecoveryRotationRequired', () => {
  test('新初始化的保险箱:不需要', async () => {
    const vault = await createInitializedVault();

    expect(await vault.service.isRecoveryRotationRequired()).toBe(false);
  });

  test('用 Recovery Key 找回访问之后:需要', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();

    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
  });

  test('步骤二回调取消:仍然需要', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    await expect(
      vault.service.rotateRecoveryKey(NEW_PASSWORD, async () => {
        throw new Error('cancel');
      })
    ).rejects.toThrow('cancel');

    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
  });

  test('重新生成 Recovery Key 完成之后:不再需要', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);

    await vault.service.rotateRecoveryKey(NEW_PASSWORD, async () => {});

    expect(await vault.service.isRecoveryRotationRequired()).toBe(false);
  });

  test('不要求已解锁(这个标记不是秘密)', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
    vault.session.lock();

    expect(vault.session.isOpen()).toBe(false);
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
  });

  test('只读:不写库、不碰 Session、不广播', async () => {
    const { a, b } = await twoPanels();
    const before = await snapshotVault(a.db);
    const epochA = a.session.getEpoch();
    const epochB = b.session.getEpoch();

    await a.service.isRecoveryRotationRequired();

    expect(await snapshotVault(a.db)).toEqual(before);
    expect(a.session.getEpoch()).toBe(epochA);
    await expectStillOpen(b);
    expect(b.session.getEpoch()).toBe(epochB);
  });

  test('还没有初始化:抛 NotInitializedError', async () => {
    const vault = createTestVault();

    await expect(vault.service.isRecoveryRotationRequired()).rejects.toBeInstanceOf(NotInitializedError);
  });

  test('wrapper 结构损坏:抛 CorruptError,不当成"不需要"', async () => {
    const vault = await createInitializedVault();
    await tamperKeys(vault.db, keys => {
      (keys as unknown as { wrapper: unknown }).wrapper = undefined;
    });

    await expect(vault.service.isRecoveryRotationRequired()).rejects.toBeInstanceOf(CorruptError);
  });

  test.each([
    ['字段缺失', undefined],
    ['字符串 "false"', 'false'],
    ['数字 0', 0],
    ['null', null],
  ])('标记不是明确的 false(%s):按"需要"处理,多提醒一次无害', async (_name, value) => {
    const vault = await createInitializedVault();
    await tamperKeys(vault.db, keys => {
      (keys as unknown as { recoveryRotationRequired: unknown }).recoveryRotationRequired = value;
    });

    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
  });
});
