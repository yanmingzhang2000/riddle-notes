import { afterEach, describe, expect, test } from 'vitest';
import * as Errors from '../../src/vault/crypto/errors';
import { createTestVaultDb } from '../helpers/vault';

const classes = Object.entries(Errors).filter(
  (entry): entry is [string, new () => Errors.VaultError] =>
    typeof entry[1] === 'function' && entry[0] !== 'VaultError'
);

/** 构造函数需要参数的错误类,在这里给一个有代表性的实例;其余的无参构造 */
const samples: Record<string, () => Errors.VaultError> = {
  WeakPasswordError: () => new Errors.WeakPasswordError(['too-short', 'too-weak']),
};
const make = (name: string, ErrorClass: new () => Errors.VaultError): Errors.VaultError =>
  samples[name]?.() ?? new ErrorClass();

const dbs: Array<ReturnType<typeof createTestVaultDb>> = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));

describe('错误类', () => {
  test('覆盖了全部具体错误类(新增错误类时这里会提醒补测试)', () => {
    expect(classes.map(([name]) => name).sort()).toEqual([
      'AlreadyInitializedError',
      'AuthError',
      'ConflictError',
      'CorruptError',
      'NotFoundError',
      'NotInitializedError',
      'RecoveryKeyChecksumError',
      'RecoveryKeyFormatError',
      'UnsupportedKdfError',
      'VaultLockedError',
      'WeakPasswordError',
    ]);
  });

  test.each(classes)('%s:是 VaultError,有固定文案和类别', (name, ErrorClass) => {
    const error = make(name, ErrorClass);
    expect(error).toBeInstanceOf(Errors.VaultError);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBeTruthy();
    expect(error.message).toBeTruthy();
    expect(error.name).not.toBe('Error');
  });

  test('每个错误的 kind 互不相同', () => {
    const kinds = classes.map(([name, ErrorClass]) => make(name, ErrorClass).kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  // Dexie 会把 name 与 DOMException 同名的异常(NotFoundError、ConstraintError、AbortError ……)
  // 包装成 DexieError。服务里的错误在事务内抛出,被包装后调用方的 instanceof 就失效了。
  test.each(classes)('%s 在 Dexie 事务里抛出后原样透出,没有被包装', async (name, ErrorClass) => {
    const db = createTestVaultDb();
    dbs.push(db);
    const thrown = make(name, ErrorClass);

    const caught = await db
      .transaction('rw', db.vaultKeys, async () => {
        await db.vaultKeys.get('singleton');
        throw thrown;
      })
      .catch(e => e);

    expect(caught).toBe(thrown);
  });
});
