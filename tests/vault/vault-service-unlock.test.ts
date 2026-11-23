import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AlreadyInitializedError,
  AuthError,
  CorruptError,
  NotInitializedError,
  RecoveryKeyChecksumError,
  RecoveryKeyFormatError,
  UnsupportedKdfError,
  VaultLockedError,
} from '../../src/vault/crypto/errors';
import { DEFAULT_KDF_POLICY } from '../../src/vault/services/vault-service';
import {
  PASSWORD,
  containsSubarray,
  createBarrier,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  fastKdfPolicy,
  isZeroed,
  sleep,
  snapshotVault,
  tamperKeys,
  toHex,
  trackKeyMaterial,
} from '../helpers/vault';

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeTestVaults();
});

describe('initialize', () => {
  test('创建后会话打开,库里有 wrapper 和默认设置', async () => {
    const vault = createTestVault({ now: () => 1_700_000_000_000 });
    expect(await vault.service.isInitialized()).toBe(false);

    await vault.service.initialize(PASSWORD, async () => {});

    expect(vault.session.isOpen()).toBe(true);
    expect(await vault.service.isInitialized()).toBe(true);

    const keys = (await vault.db.vaultKeys.get('singleton'))!;
    expect(keys.wrapper.revision).toBe(1);
    expect(keys.wrapper.formatVersion).toBe(1);
    expect(keys.wrapper.keyId).toHaveLength(8);
    expect(keys.wrapper.master.wrappedKey).toHaveLength(48);
    expect(keys.wrapper.master.iv).toHaveLength(12);
    expect(keys.wrapper.master.kdf).toMatchObject({ algorithm: 'PBKDF2-SHA256', iterations: 1000 });
    expect(keys.wrapper.recovery.wrappedKey).toHaveLength(48);
    expect(keys.recoveryRotationRequired).toBe(false);
    expect(keys.createdAt).toBe(1_700_000_000_000);
    expect(keys.updatedAt).toBe(1_700_000_000_000);
    expect(await vault.db.vaultSettings.get('singleton')).toEqual({
      id: 'singleton',
      autoLockTimeoutMs: 300_000,
    });
    expect(await vault.db.vaultRecords.count()).toBe(0);
  });

  test('回调收到的 Recovery Key 格式正确,并且能解开保险箱', async () => {
    const vault = await createInitializedVault();
    expect(vault.recoveryKey).toMatch(/^RN-V1-([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);

    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('回调被调用时库里还没有任何 Vault 数据', async () => {
    const vault = createTestVault();
    let seen: Awaited<ReturnType<typeof snapshotVault>> | undefined;
    let initializedInCallback: boolean | undefined;

    await vault.service.initialize(PASSWORD, async () => {
      seen = await snapshotVault(vault.db);
      initializedInCallback = await vault.service.isInitialized();
    });

    expect(seen).toEqual({ keys: [], settings: [], records: [], snapshot: [] });
    expect(initializedInCallback).toBe(false);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('回调 reject(用户取消):库里没有任何数据,会话保持关闭,抛的是回调的错误', async () => {
    const vault = createTestVault();
    const cancel = new Error('user cancelled');

    await expect(
      vault.service.initialize(PASSWORD, async () => {
        throw cancel;
      })
    ).rejects.toBe(cancel);

    expect(await snapshotVault(vault.db)).toEqual({ keys: [], settings: [], records: [], snapshot: [] });
    expect(vault.session.isOpen()).toBe(false);
    expect(await vault.service.isInitialized()).toBe(false);
  });

  test('取消之后可以重新初始化', async () => {
    const vault = createTestVault();
    await expect(
      vault.service.initialize(PASSWORD, async () => {
        throw new Error('cancel');
      })
    ).rejects.toThrow('cancel');

    await vault.service.initialize(PASSWORD, async () => {});
    expect(await vault.service.isInitialized()).toBe(true);
  });

  test('事务中途失败(写 vaultSettings 抛错):vaultKeys 也不会留下,没有半初始化', async () => {
    const vault = createTestVault();
    vi.spyOn(vault.db.vaultSettings, 'put').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.initialize(PASSWORD, async () => {})).rejects.toThrow('injected');

    expect(await snapshotVault(vault.db)).toEqual({ keys: [], settings: [], records: [], snapshot: [] });
    expect(await vault.service.isInitialized()).toBe(false);
    expect(vault.session.isOpen()).toBe(false);

    await vault.service.initialize(PASSWORD, async () => {});
    expect(await vault.service.isInitialized()).toBe(true);
  });

  test('事务中途失败(写 vaultKeys 抛错):库里没有任何数据', async () => {
    const vault = createTestVault();
    vi.spyOn(vault.db.vaultKeys, 'add').mockRejectedValueOnce(new Error('injected'));

    await expect(vault.service.initialize(PASSWORD, async () => {})).rejects.toThrow('injected');

    expect(await snapshotVault(vault.db)).toEqual({ keys: [], settings: [], records: [], snapshot: [] });
  });

  test('已经初始化:抛 AlreadyInitializedError,不调用回调,原 wrapper 不变', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    const callback = vi.fn(async () => {});

    await expect(vault.service.initialize('another-password', callback)).rejects.toBeInstanceOf(
      AlreadyInitializedError
    );

    expect(callback).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('两个实例同时初始化(都已通过回填):只有一个成功,另一个抛 AlreadyInitializedError', async () => {
    const a = createTestVault();
    const b = createTestVault({ peerOf: a });
    const barrier = createBarrier(2); // 两边都走到回调,保证都通过了开头的存在性检查

    const [resultA, resultB] = await Promise.allSettled([
      a.service.initialize('password-of-A-123', barrier.wait),
      b.service.initialize('password-of-B-456', barrier.wait),
    ]);

    const results = [resultA, resultB];
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AlreadyInitializedError);
    expect(await a.db.vaultKeys.count()).toBe(1);

    const [winner, loser, winnerPassword, loserPassword] =
      resultA.status === 'fulfilled'
        ? [a, b, 'password-of-A-123', 'password-of-B-456']
        : [b, a, 'password-of-B-456', 'password-of-A-123'];
    expect(winner.session.isOpen()).toBe(true);
    expect(loser.session.isOpen()).toBe(false);

    // 库里留下的是胜者的 wrapper,没有被败者覆盖
    winner.session.lock();
    await expect(winner.service.unlockWithMasterPassword(loserPassword)).rejects.toBeInstanceOf(AuthError);
    await winner.service.unlockWithMasterPassword(winnerPassword);
  });

  test('回调期间收到锁定广播:库已经写成功,所以初始化照常完成,会话打开', async () => {
    const vault = createTestVault();

    await vault.service.initialize(PASSWORD, async () => {
      vault.session.lockLocal();
    });

    expect(await vault.service.isInitialized()).toBe(true);
    expect(vault.session.isOpen()).toBe(true);
  });

  // 包装出了问题却照常写库,会得到一个永远解不开的保险箱,所以提交前必须试解
  test.each([
    [1, 'master wrapper'],
    [2, 'recovery wrapper'],
  ])('%s 号 wrap 的结果有问题(%s):试解失败,什么都不写,不调用回调,原始字节清零', async (nth, _name) => {
    const vault = createTestVault();
    const tracked = trackKeyMaterial(vault.crypto);
    const wrap = vault.crypto.wrap.bind(vault.crypto);
    let calls = 0;
    vi.spyOn(vault.crypto, 'wrap').mockImplementation(async (...args) => {
      const wrapped = await wrap(...args);
      if (++calls === nth) wrapped.wrappedKey[0] ^= 1;
      return wrapped;
    });
    const callback = vi.fn(async () => {});

    await expect(vault.service.initialize(PASSWORD, callback)).rejects.toBeInstanceOf(AuthError);

    expect(callback).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual({ keys: [], settings: [], records: [], snapshot: [] });
    expect(vault.session.isOpen()).toBe(false);
    expect(tracked.length).toBeGreaterThanOrEqual(2);
    expect(tracked.every(isZeroed)).toBe(true);
  });

  test('空主密码:TypeError,什么都没写', async () => {
    const vault = createTestVault();
    await expect(vault.service.initialize('', async () => {})).rejects.toBeInstanceOf(TypeError);
    expect(await vault.service.isInitialized()).toBe(false);
  });

  test('库里没有主密码、Recovery Key、Vault Key 的任何形式', async () => {
    const vault = createTestVault();
    const keyMaterial = trackKeyMaterial(vault.crypto);
    // trackKeyMaterial 持有的引用会被清零,所以在清零之前另存一份
    let vaultKeyCopy = new Uint8Array(0);
    const generate = vault.crypto.generateVaultKeyBytes;
    vault.crypto.generateVaultKeyBytes = () => {
      const bytes = generate();
      vaultKeyCopy = bytes.slice();
      return bytes;
    };
    let recoveryKey = '';
    await vault.service.initialize(PASSWORD, async formatted => {
      recoveryKey = formatted;
    });
    expect(keyMaterial.length).toBeGreaterThan(0);
    expect(vaultKeyCopy.some(b => b !== 0)).toBe(true);

    const keys = (await vault.db.vaultKeys.get('singleton'))!;
    const stored = [
      keys.wrapper.master.wrappedKey,
      keys.wrapper.master.iv,
      keys.wrapper.master.kdf.salt,
      keys.wrapper.recovery.wrappedKey,
      keys.wrapper.recovery.iv,
      keys.wrapper.keyId,
    ];
    const encoder = new TextEncoder();
    const needles = [
      vaultKeyCopy,
      encoder.encode(PASSWORD),
      encoder.encode(recoveryKey),
      encoder.encode(recoveryKey.replaceAll('-', '')),
    ];
    for (const bytes of stored) {
      for (const needle of needles) expect(containsSubarray(bytes, needle)).toBe(false);
    }

    // 只有设计里允许存储的字段,没有悄悄多出来的明文字段
    expect(Object.keys(keys).sort()).toEqual([
      'createdAt',
      'id',
      'recoveryRotationRequired',
      'updatedAt',
      'wrapper',
    ]);
    expect(Object.keys(keys.wrapper).sort()).toEqual([
      'formatVersion',
      'keyId',
      'master',
      'recovery',
      'revision',
    ]);
    expect(Object.keys(keys.wrapper.master).sort()).toEqual(['iv', 'kdf', 'wrappedKey']);
    expect(Object.keys(keys.wrapper.recovery).sort()).toEqual(['iv', 'wrappedKey']);
  });

  test('原始 Vault Key 与 Recovery Key 字节用完都已清零', async () => {
    const vault = createTestVault();
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.initialize(PASSWORD, async () => {});

    expect(tracked.length).toBeGreaterThanOrEqual(2); // Vault Key、Recovery Key,加上试解
    expect(tracked.every(isZeroed)).toBe(true);
  });

  test('回调取消时原始密钥字节也已清零', async () => {
    const vault = createTestVault();
    const tracked = trackKeyMaterial(vault.crypto);

    await expect(
      vault.service.initialize(PASSWORD, async () => {
        throw new Error('cancel');
      })
    ).rejects.toThrow('cancel');

    expect(tracked.length).toBeGreaterThanOrEqual(2);
    expect(tracked.every(isZeroed)).toBe(true);
  });

  test('等用户抄写 Recovery Key 期间,原始 Vault Key 已经不在内存里', async () => {
    const vault = createTestVault();
    const tracked = trackKeyMaterial(vault.crypto);
    let zeroedDuringCallback: boolean | undefined;

    await vault.service.initialize(PASSWORD, async () => {
      zeroedDuringCallback = tracked.every(isZeroed);
    });

    expect(tracked.length).toBeGreaterThan(0);
    expect(zeroedDuringCallback).toBe(true);
  });

  test('用生产 KDF 参数(600k)走一遍初始化与解锁', async () => {
    const vault = createTestVault({ kdfPolicy: DEFAULT_KDF_POLICY });
    await vault.service.initialize(PASSWORD, async () => {});

    const keys = (await vault.db.vaultKeys.get('singleton'))!;
    expect(keys.wrapper.master.kdf).toMatchObject({ algorithm: 'PBKDF2-SHA256', iterations: 600_000 });

    vault.session.lock();
    const start = performance.now();
    await vault.service.unlockWithMasterPassword(PASSWORD);
    console.log(`unlock with 600k PBKDF2: ${(performance.now() - start).toFixed(0)}ms`);
    expect(vault.session.isOpen()).toBe(true);
    await vault.service.idle();
    expect((await vault.db.vaultKeys.get('singleton'))!.wrapper.revision).toBe(1); // 不需要升级
  }, 30_000);
});

describe('unlockWithMasterPassword', () => {
  test('正确密码解锁', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    expect(vault.session.isOpen()).toBe(false);

    await vault.service.unlockWithMasterPassword(PASSWORD);

    expect(vault.session.isOpen()).toBe(true);
  });

  test('错误密码抛 AuthError,数据库不变,会话保持关闭', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await expect(vault.service.unlockWithMasterPassword('wrong password')).rejects.toBeInstanceOf(
      AuthError
    );

    expect(vault.session.isOpen()).toBe(false);
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('空密码按错误密码处理(AuthError),不是 TypeError', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await expect(vault.service.unlockWithMasterPassword('')).rejects.toBeInstanceOf(AuthError);
  });

  test('NFKC:分解形式与全角形式的同一密码都能解锁', async () => {
    const vault = createTestVault();
    await vault.service.initialize('caf\u00e9-ＡＢＣ-123456', async () => {});
    vault.session.lock();

    await vault.service.unlockWithMasterPassword('cafe\u0301-ABC-123456');
    expect(vault.session.isOpen()).toBe(true);
  });

  test('未初始化:抛 NotInitializedError', async () => {
    const vault = createTestVault();
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(
      NotInitializedError
    );
    await expect(vault.service.unlockWithRecoveryKey('RN-V1-X')).rejects.toBeInstanceOf(
      NotInitializedError
    );
  });

  test('解锁期间被锁定(比如另一个面板广播了锁定):VaultLockedError,会话保持关闭', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();

    const pending = vault.service.unlockWithMasterPassword(PASSWORD);
    vault.session.lockLocal(); // KDF 在跑的时候收到锁定广播

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('解开的原始 Vault Key 已清零,包括错误路径', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.unlockWithMasterPassword(PASSWORD);
    await expect(vault.service.unlockWithMasterPassword('wrong')).rejects.toBeInstanceOf(AuthError);

    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(isZeroed)).toBe(true);
  });
});

describe('unlockWithRecoveryKey', () => {
  test('解锁期间被锁定:VaultLockedError,会话保持关闭', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();

    const pending = vault.service.unlockWithRecoveryKey(vault.recoveryKey);
    vault.session.lockLocal();

    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('小写、空格分隔也能解锁', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();

    await vault.service.unlockWithRecoveryKey(vault.recoveryKey.toLowerCase().replaceAll('-', ' '));

    expect(vault.session.isOpen()).toBe(true);
  });

  test('格式错误抛 RecoveryKeyFormatError', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    await expect(vault.service.unlockWithRecoveryKey('not a recovery key')).rejects.toBeInstanceOf(
      RecoveryKeyFormatError
    );
    expect(vault.session.isOpen()).toBe(false);
  });

  test('输错一个字符抛 RecoveryKeyChecksumError,不去碰 wrapper', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const char = vault.recoveryKey.charAt(8) === 'A' ? 'B' : 'A';
    const typo = vault.recoveryKey.slice(0, 8) + char + vault.recoveryKey.slice(9);
    const unwrap = vi.spyOn(vault.crypto, 'unwrap');

    await expect(vault.service.unlockWithRecoveryKey(typo)).rejects.toBeInstanceOf(
      RecoveryKeyChecksumError
    );

    expect(unwrap).not.toHaveBeenCalled();
  });

  test('格式与校验和都对、但不是这个保险箱的 Key:AuthError', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const other = await vault.crypto.generateRecoveryKey();

    await expect(vault.service.unlockWithRecoveryKey(other.formatted)).rejects.toBeInstanceOf(AuthError);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('解开的原始字节与解析出的 Recovery Key 字节都已清零', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
    const other = await vault.crypto.generateRecoveryKey();
    await expect(vault.service.unlockWithRecoveryKey(other.formatted)).rejects.toBeInstanceOf(AuthError);

    const parsed = tracked.filter(b => b.length === 32);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    // other.bytes 是测试自己生成的,不在服务清零的范围内
    expect(tracked.filter(b => b !== other.bytes && !isZeroed(b))).toEqual([]);
  });
});

describe('库里的数据损坏', () => {
  async function lockedVault() {
    const vault = await createInitializedVault();
    vault.session.lock();
    return vault;
  }

  test.each([
    ['master.iv 长度不对', (k: any) => (k.wrapper.master.iv = new Uint8Array(8))],
    ['master.wrappedKey 被截断', (k: any) => (k.wrapper.master.wrappedKey = k.wrapper.master.wrappedKey.slice(0, 40))],
    ['keyId 长度不对', (k: any) => (k.wrapper.keyId = new Uint8Array(7))],
    ['formatVersion 不认识', (k: any) => (k.wrapper.formatVersion = 2)],
    ['revision 不是整数', (k: any) => (k.wrapper.revision = Number.NaN)],
    ['缺 master', (k: any) => delete k.wrapper.master],
    ['缺 recovery', (k: any) => delete k.wrapper.recovery],
    ['kdf 算法不是已知值', (k: any) => (k.wrapper.master.kdf.algorithm = 'bcrypt')],
    ['kdf salt 太短', (k: any) => (k.wrapper.master.kdf.salt = new Uint8Array(8))],
    ['kdf 迭代次数为 0', (k: any) => (k.wrapper.master.kdf.iterations = 0)],
  ])('%s:CorruptError,不是 TypeError', async (_name, change) => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, change);
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(CorruptError);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('wrapper 能解开、但 keyId 对不上:CorruptError,解出的字节已清零', async () => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, k => (k.wrapper.keyId = new Uint8Array(8).fill(9)));
    const tracked = trackKeyMaterial(vault.crypto);

    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(CorruptError);

    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(isZeroed)).toBe(true);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('Recovery wrapper 的 iv 长度不对:CorruptError', async () => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, k => (k.wrapper.recovery.iv = new Uint8Array(8)));
    await expect(vault.service.unlockWithRecoveryKey(vault.recoveryKey)).rejects.toBeInstanceOf(
      CorruptError
    );
  });

  test('密文被改了一个字节:AuthError', async () => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, k => (k.wrapper.master.wrappedKey[0] ^= 1));
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(AuthError);

    await tamperKeys(vault.db, k => {
      k.wrapper.master.wrappedKey[0] ^= 1; // 还原
      k.wrapper.recovery.wrappedKey[0] ^= 1;
    });
    await expect(vault.service.unlockWithRecoveryKey(vault.recoveryKey)).rejects.toBeInstanceOf(AuthError);
  });

  test('wrapper 用了 Argon2id:在接入之前抛 UnsupportedKdfError', async () => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, k => {
      k.wrapper.master.kdf = {
        algorithm: 'Argon2id',
        memoryKiB: 65536,
        timeCost: 3,
        parallelism: 1,
        salt: new Uint8Array(32),
      };
    });
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(
      UnsupportedKdfError
    );
  });

  test('错误对象不带密码或密文内容', async () => {
    const vault = await lockedVault();
    const error = await vault.service.unlockWithMasterPassword('my-secret-guess').catch(e => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(JSON.stringify({ name: error.name, message: error.message })).not.toContain('my-secret-guess');
  });
});

describe('verifyMasterPassword', () => {
  test('正确密码通过,错误密码抛 AuthError', async () => {
    const vault = await createInitializedVault();
    await expect(vault.service.verifyMasterPassword(PASSWORD)).resolves.toBeUndefined();
    await expect(vault.service.verifyMasterPassword('wrong')).rejects.toBeInstanceOf(AuthError);
  });

  test('不碰 Session:epoch 不变、不通知订阅者、保持打开', async () => {
    const vault = await createInitializedVault();
    const epoch = vault.session.getEpoch();
    const subscriber = vi.fn();
    vault.session.subscribe(subscriber);

    await vault.service.verifyMasterPassword(PASSWORD);
    await expect(vault.service.verifyMasterPassword('wrong')).rejects.toBeInstanceOf(AuthError);

    expect(vault.session.getEpoch()).toBe(epoch);
    expect(subscriber).not.toHaveBeenCalled();
    expect(vault.session.isOpen()).toBe(true);
  });

  test('会话关闭时验证也不会把它打开', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const epoch = vault.session.getEpoch();

    await vault.service.verifyMasterPassword(PASSWORD);

    expect(vault.session.isOpen()).toBe(false);
    expect(vault.session.getEpoch()).toBe(epoch);
  });

  test('不写库,解出的字节已清零', async () => {
    const vault = await createInitializedVault();
    const before = await snapshotVault(vault.db);
    const tracked = trackKeyMaterial(vault.crypto);

    await vault.service.verifyMasterPassword(PASSWORD);

    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every(isZeroed)).toBe(true);
  });
});

describe('KDF 自动升级', () => {
  /** 用较弱的参数(500)建库,再用要求 1000 的策略去解锁 */
  async function weakVault() {
    const weak = await createInitializedVault({ kdfPolicy: fastKdfPolicy(500) });
    weak.session.lock();
    const strong = createTestVault({ peerOf: weak, kdfPolicy: fastKdfPolicy(1000) });
    return { weak, strong };
  }

  test('解锁成功后在后台把 master wrapper 重包装成当前策略', async () => {
    const { weak, strong } = await weakVault();
    const before = (await weak.db.vaultKeys.get('singleton'))!;
    expect(before.wrapper.master.kdf).toMatchObject({ iterations: 500 });

    await strong.service.unlockWithMasterPassword(PASSWORD);
    expect(strong.session.isOpen()).toBe(true); // 解锁本身不等待升级
    await strong.service.idle();

    const after = (await weak.db.vaultKeys.get('singleton'))!;
    expect(after.wrapper.master.kdf).toMatchObject({ algorithm: 'PBKDF2-SHA256', iterations: 1000 });
    expect(toHex((after.wrapper.master.kdf as { salt: Uint8Array }).salt)).not.toBe(
      toHex((before.wrapper.master.kdf as { salt: Uint8Array }).salt)
    );
    expect(after.wrapper.revision).toBe(before.wrapper.revision + 1);
    expect(toHex(after.wrapper.keyId)).toBe(toHex(before.wrapper.keyId));
    // Recovery wrapper 原样保留
    expect(after.wrapper.recovery).toEqual(before.wrapper.recovery);
    expect(after.recoveryRotationRequired).toBe(before.recoveryRotationRequired);
  });

  test('升级之后:主密码与 Recovery Key 都仍然可用', async () => {
    const { weak, strong } = await weakVault();
    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();

    strong.session.lock();
    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();
    strong.session.lock();
    await strong.service.unlockWithRecoveryKey(weak.recoveryKey);
    expect(strong.session.isOpen()).toBe(true);
  });

  test('升级只发生一次:参数已经达标时不再写库', async () => {
    const { weak, strong } = await weakVault();
    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();
    const revision = (await weak.db.vaultKeys.get('singleton'))!.wrapper.revision;

    strong.session.lock();
    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();

    expect((await weak.db.vaultKeys.get('singleton'))!.wrapper.revision).toBe(revision);
  });

  test('参数本来就达标:解锁不写库', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);

    await vault.service.unlockWithMasterPassword(PASSWORD);
    await vault.service.idle();

    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('用 Recovery Key 解锁不触发升级(没有可升级的 KDF)', async () => {
    const { weak, strong } = await weakVault();
    const before = await snapshotVault(weak.db);

    await strong.service.unlockWithRecoveryKey(weak.recoveryKey);
    await strong.service.idle();

    expect(await snapshotVault(weak.db)).toEqual(before);
  });

  test('提交后广播 wrapper-changed:其他面板被锁定,发起升级的面板保持打开', async () => {
    const { weak, strong } = await weakVault();
    await weak.service.unlockWithMasterPassword(PASSWORD); // 弱策略,不升级
    expect(weak.session.isOpen()).toBe(true);

    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();

    await vi.waitFor(() => expect(weak.session.isOpen()).toBe(false));
    expect(strong.session.isOpen()).toBe(true);
  });

  test('升级时遇到并发修改:静默放弃,不覆盖别人的写入,解锁不受影响', async () => {
    const { weak, strong } = await weakVault();
    const gate = createGate();
    const derive = strong.crypto.deriveMasterWrapKey.bind(strong.crypto);
    let calls = 0;
    vi.spyOn(strong.crypto, 'deriveMasterWrapKey').mockImplementation(async (password, kdf) => {
      if (++calls === 2) await gate.wait(); // 第二次是升级时派生新 KDF,卡在这里
      return derive(password, kdf);
    });

    await strong.service.unlockWithMasterPassword(PASSWORD);
    expect(strong.session.isOpen()).toBe(true);

    // 升级卡在门口时,另一个实例把 revision 改了
    const keys = (await weak.db.vaultKeys.get('singleton'))!;
    keys.wrapper.revision += 1;
    await weak.db.vaultKeys.put(keys);
    const bumped = await snapshotVault(weak.db);

    gate.release();
    await strong.service.idle(); // 不抛错

    expect(await snapshotVault(weak.db)).toEqual(bumped);
    expect(strong.session.isOpen()).toBe(true);
  });

  test('升级的事务中途失败:旧 wrapper 原样保留,主密码仍可用', async () => {
    const { weak, strong } = await weakVault();
    const before = await snapshotVault(weak.db);
    vi.spyOn(strong.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));

    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();

    expect(await snapshotVault(weak.db)).toEqual(before);
    strong.session.lock();
    await strong.service.unlockWithMasterPassword(PASSWORD);
  });

  test('升级失败不会产生未处理的 Promise 拒绝(这里不调 idle,避免它把拒绝接住)', async () => {
    const { weak, strong } = await weakVault();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      vi.spyOn(strong.db.vaultKeys, 'put').mockRejectedValueOnce(new Error('injected'));

      await strong.service.unlockWithMasterPassword(PASSWORD);
      await sleep(150); // 等后台升级跑完并失败

      expect(unhandled).toEqual([]);
      expect((await weak.db.vaultKeys.get('singleton'))!.wrapper.master.kdf).toMatchObject({
        iterations: 500,
      });
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  test('升级过程中产生的原始字节都已清零', async () => {
    const { strong } = await weakVault();
    const tracked = trackKeyMaterial(strong.crypto);

    await strong.service.unlockWithMasterPassword(PASSWORD);
    await strong.service.idle();

    expect(tracked.length).toBeGreaterThanOrEqual(3); // 解锁、再次解开、试解
    expect(tracked.every(isZeroed)).toBe(true);
  });
});
