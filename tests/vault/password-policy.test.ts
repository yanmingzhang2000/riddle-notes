import { afterEach, describe, expect, test, vi } from 'vitest';
import { WeakPasswordError } from '../../src/vault/crypto/errors';
import {
  DEFAULT_PASSWORD_POLICY,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
  type PasswordPolicy,
} from '../../src/vault/services/password-policy';
import {
  PASSWORD,
  createTestVault,
  disposeTestVaults,
  permissivePasswordPolicy,
  snapshotVault,
} from '../helpers/vault';

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeTestVaults();
});

const NEW_PASSWORD = 'a brand new passphrase 2026';

/** 这些在 zxcvbn 里 score < 3,长度都 ≥ 12,所以只会因为 too-weak 被拒绝 */
const WEAK_BUT_LONG = [
  'password12345678',
  'qwertyuiop12',
  'aaaaaaaaaaaa',
  '123456789012',
  'letmein123456',
];

/** 用默认(严格)策略建一个保险箱。tests/helpers 默认的是宽松策略,不能拿来测强度 */
function strictVault() {
  return createTestVault({ passwordPolicy: DEFAULT_PASSWORD_POLICY });
}

async function initializedStrictVault() {
  const vault = strictVault();
  let recoveryKey = '';
  await vault.service.initialize(PASSWORD, async formatted => {
    recoveryKey = formatted;
  });
  return Object.assign(vault, { recoveryKey });
}

function pseudoRandomPassword(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let seed = 12345;
  let out = '';
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += chars[(seed >>> 16) % chars.length];
  }
  return out;
}

describe('默认策略 evaluate', () => {
  test('门槛写在常量里:长度 12、得分 3', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MIN_PASSWORD_SCORE).toBe(3);
  });

  test('边界:11 个随机字符因长度不足被拒绝,12 个通过', async () => {
    const eleven = await DEFAULT_PASSWORD_POLICY.evaluate('k8#Vq2!mZp9');
    expect(eleven.length).toBe(11);
    expect(eleven.ok).toBe(false);
    expect(eleven.issues).toEqual(['too-short']);

    const twelve = await DEFAULT_PASSWORD_POLICY.evaluate('k8#Vq2!mZp9@');
    expect(twelve.length).toBe(12);
    expect(twelve.ok).toBe(true);
    expect(twelve.issues).toEqual([]);
  });

  test.each(WEAK_BUT_LONG)('够长但太弱:%s', async password => {
    const result = await DEFAULT_PASSWORD_POLICY.evaluate(password);
    expect(result.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(result.score).toBeLessThan(MIN_PASSWORD_SCORE);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(['too-weak']);
  });

  test.each([PASSWORD, NEW_PASSWORD, 'k8#Vq2!mZp9@xL4w'])('合格:%s', async password => {
    const result = await DEFAULT_PASSWORD_POLICY.evaluate(password);
    expect(result.score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('空串:两个原因都有', async () => {
    const result = await DEFAULT_PASSWORD_POLICY.evaluate('');
    expect(result.length).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(['too-short', 'too-weak']);
  });

  test('长度按 NFKC 之后的码点计,与 KDF 看到的密码一致', async () => {
    // e + 组合重音 → NFKC 后是一个字符 é
    expect((await DEFAULT_PASSWORD_POLICY.evaluate('cafe\u0301')).length).toBe(4);
    // 一个 emoji 是 2 个 UTF-16 单元、1 个码点
    expect((await DEFAULT_PASSWORD_POLICY.evaluate('😀😀😀')).length).toBe(3);
  });

  test('全角字母规范化后再评估:不能靠它们凑长度或躲过检测', async () => {
    // 12 个全角字母 → NFKC 后是 ABCDEFGHIJKL,长度 12 但是连续字母序列
    const result = await DEFAULT_PASSWORD_POLICY.evaluate('ＡＢＣＤＥＦＧＨＩＪＫＬ');
    expect(result.length).toBe(12);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(['too-weak']);
  });

  test('超长输入:length 是全长,耗时可控', async () => {
    await DEFAULT_PASSWORD_POLICY.evaluate('warm up'); // 先把估算器加载掉,只量评估本身
    const long = pseudoRandomPassword(5000);

    const start = performance.now();
    const result = await DEFAULT_PASSWORD_POLICY.evaluate(long);
    const elapsed = performance.now() - start;

    expect(result.length).toBe(5000);
    expect(elapsed).toBeLessThan(3000);
  });

  test('评估结果里没有密码内容,也没有反馈文案', async () => {
    const secret = 'sk-very-secret-passphrase-9731';
    const result = await DEFAULT_PASSWORD_POLICY.evaluate(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(Object.keys(result).sort()).toEqual(['issues', 'length', 'ok', 'score']);
  });
});

describe('WeakPasswordError', () => {
  test('只带类别:消息固定,序列化后不含密码', async () => {
    const password = 'password12345678';
    const vault = strictVault();
    const error = await vault.service
      .initialize(password, async () => {})
      .catch(e => e as WeakPasswordError);

    expect(error).toBeInstanceOf(WeakPasswordError);
    expect(error.kind).toBe('weak-password');
    expect(error.issues).toEqual(['too-weak']);
    expect(error.message).not.toContain(password);
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(password);
  });

  test('issues 是拷贝:改原数组不影响错误', () => {
    const source: Array<'too-short' | 'too-weak'> = ['too-short'];
    const error = new WeakPasswordError(source);
    source.push('too-weak');
    expect(error.issues).toEqual(['too-short']);
  });
});

describe('服务层强制:initialize', () => {
  test.each(WEAK_BUT_LONG)('拒绝 %s:没有写库、没有跑 KDF、会话保持关闭、回调没被调用', async password => {
    const vault = strictVault();
    const deriveSpy = vi.spyOn(vault.crypto, 'deriveMasterWrapKey');
    const callback = vi.fn(async () => {});
    const before = await snapshotVault(vault.db);

    await expect(vault.service.initialize(password, callback)).rejects.toBeInstanceOf(WeakPasswordError);

    expect(callback).not.toHaveBeenCalled();
    expect(deriveSpy).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(await vault.service.isInitialized()).toBe(false);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('过短的密码:issues 里有 too-short', async () => {
    const vault = strictVault();
    const error = await vault.service.initialize('Xk9#mQ2$', async () => {}).catch(e => e);
    expect(error).toBeInstanceOf(WeakPasswordError);
    expect(error.issues).toContain('too-short');
  });

  test('被拒绝之后可以用合格的密码重新初始化', async () => {
    const vault = strictVault();
    await expect(vault.service.initialize('password12345678', async () => {})).rejects.toBeInstanceOf(
      WeakPasswordError
    );
    await vault.service.initialize(PASSWORD, async () => {});
    expect(await vault.service.isInitialized()).toBe(true);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('空串仍然是 TypeError(调用方的 bug),不是 WeakPasswordError', async () => {
    const vault = strictVault();
    await expect(vault.service.initialize('', async () => {})).rejects.toBeInstanceOf(TypeError);
  });
});

describe('服务层强制:changeMasterPassword', () => {
  test('弱的新密码被拒绝:库不变、不跑 KDF、旧密码照常可用', async () => {
    const vault = await initializedStrictVault();
    const before = await snapshotVault(vault.db);
    const deriveSpy = vi.spyOn(vault.crypto, 'deriveMasterWrapKey');

    await expect(vault.service.changeMasterPassword(PASSWORD, 'password12345678')).rejects.toBeInstanceOf(
      WeakPasswordError
    );

    expect(deriveSpy).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual(before);

    vault.session.lock();
    await vault.service.unlockWithMasterPassword(PASSWORD);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('弱密码先于旧密码校验被拒绝:旧密码错也先报弱密码(这样不白付一次验证旧密码的 KDF)', async () => {
    const vault = await initializedStrictVault();
    const deriveSpy = vi.spyOn(vault.crypto, 'deriveMasterWrapKey');

    await expect(vault.service.changeMasterPassword('wrong old password', 'qwertyuiop12')).rejects.toBeInstanceOf(
      WeakPasswordError
    );
    expect(deriveSpy).not.toHaveBeenCalled();
  });

  test('合格的新密码通过,新旧密码各自的行为正确', async () => {
    const vault = await initializedStrictVault();
    await vault.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    vault.session.lock();
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('空串仍然是 TypeError', async () => {
    const vault = await initializedStrictVault();
    await expect(vault.service.changeMasterPassword(PASSWORD, '')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('服务层强制:recoverAccess', () => {
  test('弱的新密码被拒绝:库不变、不标记轮换、会话不打开、Recovery Key 没被消耗', async () => {
    const vault = await initializedStrictVault();
    vault.session.lock();
    const before = await snapshotVault(vault.db);
    const parseSpy = vi.spyOn(vault.crypto, 'parseRecoveryKey');

    await expect(vault.service.recoverAccess(vault.recoveryKey, 'password12345678')).rejects.toBeInstanceOf(
      WeakPasswordError
    );

    expect(parseSpy).not.toHaveBeenCalled();
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(false);
    expect(vault.session.isOpen()).toBe(false);

    // 之后用同一个 Recovery Key 与同一个旧主密码仍然都可用
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
    vault.session.lock();
    await vault.service.unlockWithMasterPassword(PASSWORD);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('合格的新密码通过:新主密码生效,标记需要轮换', async () => {
    const vault = await initializedStrictVault();
    vault.session.lock();

    await expect(vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD)).resolves.toEqual({
      accessRestored: true,
      rotationRequired: true,
    });
    expect((await vault.db.vaultKeys.get('singleton'))!.recoveryRotationRequired).toBe(true);

    vault.session.lock();
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
    expect(vault.session.isOpen()).toBe(true);
  });

  test('空串仍然是 TypeError', async () => {
    const vault = await initializedStrictVault();
    vault.session.lock();
    await expect(vault.service.recoverAccess(vault.recoveryKey, '')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('策略的注入与一致性', () => {
  test('evaluatePassword 用的是同一份策略:UI 的指示器与服务层强制执行不会不一致', async () => {
    const calls: string[] = [];
    const spyPolicy: PasswordPolicy = {
      async evaluate(password) {
        calls.push(password);
        return permissivePasswordPolicy.evaluate(password);
      },
    };
    const vault = createTestVault({ passwordPolicy: spyPolicy });

    await vault.service.evaluatePassword('from the indicator');
    await vault.service.initialize('from initialize', async () => {});

    expect(calls).toEqual(['from the indicator', 'from initialize']);
  });

  test('策略自己抛错(例如估算器加载失败):不放行,什么都没写', async () => {
    const failing: PasswordPolicy = {
      evaluate: async () => {
        throw new Error('estimator unavailable');
      },
    };
    const vault = createTestVault({ passwordPolicy: failing });
    const callback = vi.fn(async () => {});

    await expect(vault.service.initialize(PASSWORD, callback)).rejects.toThrow('estimator unavailable');

    expect(callback).not.toHaveBeenCalled();
    expect(await vault.service.isInitialized()).toBe(false);
  });

  test('不传 passwordPolicy 时默认是严格策略,不是宽松策略', async () => {
    // 直接构造 VaultService、不经过 tests/helpers 的宽松默认,证明生产默认是严格的
    const { VaultService } = await import('../../src/vault/services/vault-service');
    const helper = createTestVault();
    const service = new VaultService({ db: helper.db, session: helper.session, crypto: helper.crypto });

    await expect(service.initialize('password12345678', async () => {})).rejects.toBeInstanceOf(WeakPasswordError);
  });
});
