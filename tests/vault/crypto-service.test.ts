import { beforeAll, describe, expect, test } from 'vitest';
import {
  CryptoService,
  IV_LENGTH,
  KEY_ID_LENGTH,
  PBKDF2_POLICY_ITERATIONS,
  buildAad,
  createDefaultKdf,
  kdfNeedsUpgrade,
} from '../../src/vault/crypto/crypto-service';
import { wipe } from '../../src/vault/crypto/bytes';
import {
  AuthError,
  CorruptError,
  RecoveryKeyChecksumError,
  UnsupportedKdfError,
} from '../../src/vault/crypto/errors';
import type { KdfParams, SegmentContext } from '../../src/vault/types';

const svc = new CryptoService();

// 测试里用很小的迭代次数加快速度;生产参数另有一条专门的用例
function testKdf(iterations = 1000, salt = new Uint8Array(32).fill(7)): KdfParams {
  return { algorithm: 'PBKDF2-SHA256', iterations, salt };
}

const ctx: SegmentContext = {
  recordId: 'rec-1',
  type: 'api_key',
  formatVersion: 1,
  segment: 'secret',
};

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('主密码派生', () => {
  test('相同密码与 salt:一个 wrapper 能被另一次派生解开', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey('hunter2-password', testKdf()));
    const out = await svc.unwrap(wrapped, await svc.deriveMasterWrapKey('hunter2-password', testKdf()));
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('派生出的 key 不可导出', async () => {
    const key = await svc.deriveMasterWrapKey('pw', testKdf());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  test('错误密码抛 AuthError', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey('right', testKdf()));
    const wrong = await svc.deriveMasterWrapKey('wrong', testKdf());
    await expect(svc.unwrap(wrapped, wrong)).rejects.toBeInstanceOf(AuthError);
  });

  test('不同 salt 派生不同的 key', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(
      raw,
      await svc.deriveMasterWrapKey('pw', testKdf(1000, new Uint8Array(32).fill(1)))
    );
    const other = await svc.deriveMasterWrapKey('pw', testKdf(1000, new Uint8Array(32).fill(2)));
    await expect(svc.unwrap(wrapped, other)).rejects.toBeInstanceOf(AuthError);
  });

  test('不同迭代次数派生不同的 key', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey('pw', testKdf(1000)));
    const other = await svc.deriveMasterWrapKey('pw', testKdf(1001));
    await expect(svc.unwrap(wrapped, other)).rejects.toBeInstanceOf(AuthError);
  });

  test('NFKC:预组合与分解形式的同一密码派生出相同的 key', async () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(composed).not.toBe(decomposed);

    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey(composed, testKdf()));
    const out = await svc.unwrap(wrapped, await svc.deriveMasterWrapKey(decomposed, testKdf()));
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('NFKC:全角与半角的同一密码派生出相同的 key', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey('ABC123', testKdf()));
    const out = await svc.unwrap(wrapped, await svc.deriveMasterWrapKey('ＡＢＣ１２３', testKdf()));
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('中文密码可用', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveMasterWrapKey('我的保险箱密码-2026', testKdf()));
    const out = await svc.unwrap(
      wrapped,
      await svc.deriveMasterWrapKey('我的保险箱密码-2026', testKdf())
    );
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('salt 太短抛 CorruptError', async () => {
    await expect(svc.deriveMasterWrapKey('pw', testKdf(1000, new Uint8Array(8)))).rejects.toBeInstanceOf(
      CorruptError
    );
  });

  test.each([0, -1, 1.5, Number.NaN])('迭代次数 %s 抛 CorruptError', async iterations => {
    await expect(svc.deriveMasterWrapKey('pw', testKdf(iterations))).rejects.toBeInstanceOf(
      CorruptError
    );
  });

  test('Argon2id 在 spike 完成前抛 UnsupportedKdfError', async () => {
    const kdf: KdfParams = {
      algorithm: 'Argon2id',
      memoryKiB: 65536,
      timeCost: 3,
      parallelism: 1,
      salt: new Uint8Array(32),
    };
    await expect(svc.deriveMasterWrapKey('pw', kdf)).rejects.toBeInstanceOf(UnsupportedKdfError);
  });

  test('生产参数(600k)可用', async () => {
    const kdf = createDefaultKdf();
    expect(kdf).toMatchObject({ algorithm: 'PBKDF2-SHA256', iterations: PBKDF2_POLICY_ITERATIONS });
    expect(kdf.salt).toHaveLength(32);

    const start = performance.now();
    const raw = svc.generateVaultKeyBytes();
    const key = await svc.deriveMasterWrapKey('a-long-and-strong-passphrase', kdf);
    const elapsed = performance.now() - start;
    console.log(`PBKDF2 600k derive: ${elapsed.toFixed(0)}ms`);

    const out = await svc.unwrap(await svc.wrap(raw, key), key);
    expect(toHex(out)).toBe(toHex(raw));
  }, 30_000);

  test('kdfNeedsUpgrade:低于策略才需要升级', () => {
    expect(kdfNeedsUpgrade(testKdf(PBKDF2_POLICY_ITERATIONS - 1))).toBe(true);
    expect(kdfNeedsUpgrade(testKdf(PBKDF2_POLICY_ITERATIONS))).toBe(false);
    expect(kdfNeedsUpgrade(testKdf(PBKDF2_POLICY_ITERATIONS * 2))).toBe(false);
  });

  test('createDefaultKdf 每次的 salt 不同', () => {
    expect(toHex(createDefaultKdf().salt)).not.toBe(toHex(createDefaultKdf().salt));
  });
});

describe('Recovery 包装密钥(HKDF)', () => {
  test('派生的 key 能用于 wrap/unwrap(usages 写成 wrapKey/unwrapKey 会在这里抛 InvalidAccessError)', async () => {
    const recovery = crypto.getRandomValues(new Uint8Array(32));
    const key = await svc.deriveRecoveryWrapKey(recovery);
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt']);

    const raw = svc.generateVaultKeyBytes();
    const out = await svc.unwrap(await svc.wrap(raw, key), key);
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('相同 Recovery Key 派生出相同的 key', async () => {
    const recovery = crypto.getRandomValues(new Uint8Array(32));
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveRecoveryWrapKey(recovery));
    const out = await svc.unwrap(wrapped, await svc.deriveRecoveryWrapKey(recovery));
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('不同的 Recovery Key 抛 AuthError', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(
      raw,
      await svc.deriveRecoveryWrapKey(crypto.getRandomValues(new Uint8Array(32)))
    );
    const other = await svc.deriveRecoveryWrapKey(crypto.getRandomValues(new Uint8Array(32)));
    await expect(svc.unwrap(wrapped, other)).rejects.toBeInstanceOf(AuthError);
  });

  test('派生的 key 不可导出', async () => {
    const key = await svc.deriveRecoveryWrapKey(crypto.getRandomValues(new Uint8Array(32)));
    expect(key.extractable).toBe(false);
  });

  test('Recovery Key 长度不是 32 抛 CorruptError', async () => {
    await expect(svc.deriveRecoveryWrapKey(new Uint8Array(16))).rejects.toBeInstanceOf(CorruptError);
  });

  test('从字符串到解开 wrapper 的完整往返', async () => {
    const { bytes, formatted } = await svc.generateRecoveryKey();
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, await svc.deriveRecoveryWrapKey(bytes));

    const parsed = await svc.parseRecoveryKey(formatted.toLowerCase().replaceAll('-', ' '));
    const out = await svc.unwrap(wrapped, await svc.deriveRecoveryWrapKey(parsed));
    expect(toHex(out)).toBe(toHex(raw));
  });

  test('输错一个字符:在派生之前就被校验和发现,不会走到 AuthError', async () => {
    const { formatted } = await svc.generateRecoveryKey();
    const first = formatted.charAt(6) === 'A' ? 'B' : 'A';
    const typo = formatted.slice(0, 6) + first + formatted.slice(7);
    await expect(svc.parseRecoveryKey(typo)).rejects.toBeInstanceOf(RecoveryKeyChecksumError);
  });
});

describe('Vault Key', () => {
  test('生成 32 字节,每次不同', () => {
    const a = svc.generateVaultKeyBytes();
    const b = svc.generateVaultKeyBytes();
    expect(a).toHaveLength(32);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  test('Session key 不可导出', async () => {
    const key = await svc.importSessionKey(svc.generateVaultKeyBytes());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  test('Session key 可以加解密记录', async () => {
    const key = await svc.importSessionKey(svc.generateVaultKeyBytes());
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    expect(await svc.decryptSegment(seg, key, ctx)).toEqual({ secret: 'x' });
  });

  test('importSessionKey 长度不对抛 CorruptError', async () => {
    await expect(svc.importSessionKey(new Uint8Array(16))).rejects.toBeInstanceOf(CorruptError);
  });

  test('keyId:8 字节、同一个 key 稳定、不同 key 不同', async () => {
    const a = svc.generateVaultKeyBytes();
    const b = svc.generateVaultKeyBytes();
    const idA1 = await svc.computeKeyId(a);
    const idA2 = await svc.computeKeyId(a);
    const idB = await svc.computeKeyId(b);
    expect(idA1).toHaveLength(KEY_ID_LENGTH);
    expect(toHex(idA1)).toBe(toHex(idA2));
    expect(toHex(idA1)).not.toBe(toHex(idB));
  });

  test('keyId 不等于 key 本身的任何前缀', async () => {
    const raw = svc.generateVaultKeyBytes();
    const id = await svc.computeKeyId(raw);
    expect(toHex(id)).not.toBe(toHex(raw.slice(0, KEY_ID_LENGTH)));
  });
});

describe('wrap / unwrap', () => {
  let wrapKey: CryptoKey;
  beforeAll(async () => {
    wrapKey = await svc.deriveMasterWrapKey('pw', testKdf());
  });

  test('IV 12 字节,密文 48 字节(32 + 16 标签),每次不同', async () => {
    const raw = svc.generateVaultKeyBytes();
    const a = await svc.wrap(raw, wrapKey);
    const b = await svc.wrap(raw, wrapKey);
    expect(a.iv).toHaveLength(IV_LENGTH);
    expect(a.wrappedKey).toHaveLength(48);
    expect(toHex(a.iv)).not.toBe(toHex(b.iv));
    expect(toHex(a.wrappedKey)).not.toBe(toHex(b.wrappedKey));
  });

  test('unwrap 返回独立的拷贝,清零它不影响再次 unwrap', async () => {
    const raw = svc.generateVaultKeyBytes();
    const wrapped = await svc.wrap(raw, wrapKey);
    const first = await svc.unwrap(wrapped, wrapKey);
    wipe(first);
    expect(first.every(b => b === 0)).toBe(true);
    expect(toHex(await svc.unwrap(wrapped, wrapKey))).toBe(toHex(raw));
  });

  test('篡改 wrappedKey 抛 AuthError', async () => {
    const wrapped = await svc.wrap(svc.generateVaultKeyBytes(), wrapKey);
    wrapped.wrappedKey[0] ^= 1;
    await expect(svc.unwrap(wrapped, wrapKey)).rejects.toBeInstanceOf(AuthError);
  });

  test('IV 长度不是 12 抛 CorruptError', async () => {
    const wrapped = await svc.wrap(svc.generateVaultKeyBytes(), wrapKey);
    await expect(
      svc.unwrap({ ...wrapped, iv: new Uint8Array(16) }, wrapKey)
    ).rejects.toBeInstanceOf(CorruptError);
    await expect(
      svc.unwrap({ ...wrapped, iv: new Uint8Array(0) }, wrapKey)
    ).rejects.toBeInstanceOf(CorruptError);
  });

  test('wrappedKey 长度不是 48 抛 CorruptError', async () => {
    const wrapped = await svc.wrap(svc.generateVaultKeyBytes(), wrapKey);
    await expect(
      svc.unwrap({ ...wrapped, wrappedKey: wrapped.wrappedKey.slice(0, 47) }, wrapKey)
    ).rejects.toBeInstanceOf(CorruptError);
  });

  test('缺字段抛 CorruptError,不抛 TypeError', async () => {
    await expect(svc.unwrap({} as never, wrapKey)).rejects.toBeInstanceOf(CorruptError);
    await expect(svc.unwrap(undefined as never, wrapKey)).rejects.toBeInstanceOf(CorruptError);
  });

  test('wrap 长度不是 32 的输入抛 CorruptError', async () => {
    await expect(svc.wrap(new Uint8Array(31), wrapKey)).rejects.toBeInstanceOf(CorruptError);
  });
});

describe('记录加密', () => {
  let key: CryptoKey;
  beforeAll(async () => {
    key = await svc.importSessionKey(svc.generateVaultKeyBytes());
  });

  test('往返,含中文和 emoji', async () => {
    const plain = { secret: 'sk-测试-🔑', username: '管理员', notes: '多行\n备注' };
    const seg = await svc.encryptSegment(plain, key, ctx);
    expect(await svc.decryptSegment(seg, key, ctx)).toEqual(plain);
  });

  test('IV 12 字节,每次加密都不同', async () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const seg = await svc.encryptSegment({ secret: 'same' }, key, ctx);
      expect(seg.iv).toHaveLength(IV_LENGTH);
      ivs.add(toHex(seg.iv));
    }
    expect(ivs.size).toBe(50);
  });

  test('相同明文两次加密的密文不同', async () => {
    const a = await svc.encryptSegment({ secret: 'same' }, key, ctx);
    const b = await svc.encryptSegment({ secret: 'same' }, key, ctx);
    expect(toHex(a.data)).not.toBe(toHex(b.data));
  });

  test('密文里没有明文字节', async () => {
    const secret = 'sk-very-secret-key-1234567890';
    const seg = await svc.encryptSegment({ secret }, key, ctx);
    const needle = Buffer.from(secret);
    expect(Buffer.from(seg.data).includes(needle)).toBe(false);
    expect(Buffer.from(seg.iv).includes(needle)).toBe(false);
  });

  test('篡改密文任意位置的一个字节都解密失败', async () => {
    const seg = await svc.encryptSegment({ secret: 'x'.repeat(40) }, key, ctx);
    for (let i = 0; i < seg.data.length; i++) {
      const tampered = { iv: seg.iv, data: seg.data.slice() };
      tampered.data[i] ^= 1;
      await expect(svc.decryptSegment(tampered, key, ctx)).rejects.toBeInstanceOf(AuthError);
    }
  });

  test('篡改 IV 解密失败', async () => {
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    const tampered = { iv: seg.iv.slice(), data: seg.data };
    tampered.iv[0] ^= 1;
    await expect(svc.decryptSegment(tampered, key, ctx)).rejects.toBeInstanceOf(AuthError);
  });

  test('用另一个 key 解密失败', async () => {
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    const other = await svc.importSessionKey(svc.generateVaultKeyBytes());
    await expect(svc.decryptSegment(seg, other, ctx)).rejects.toBeInstanceOf(AuthError);
  });

  describe('AAD 不符时解密必须失败', () => {
    test.each<[string, Partial<SegmentContext>]>([
      ['篡改 type', { type: 'password' }],
      ['换成另一条记录', { recordId: 'rec-2' }],
      ['summary 与 secret 互换', { segment: 'summary' }],
    ])('%s', async (_name, change) => {
      const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
      await expect(svc.decryptSegment(seg, key, { ...ctx, ...change })).rejects.toBeInstanceOf(
        AuthError
      );
    });

    test('formatVersion 不同', async () => {
      const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
      const wrongCtx = { ...ctx, formatVersion: 2 } as unknown as SegmentContext;
      await expect(svc.decryptSegment(seg, key, wrongCtx)).rejects.toBeInstanceOf(AuthError);
    });

    test('把 A 记录的 secret 密文放到 B 记录上', async () => {
      const a = { ...ctx, recordId: 'A' };
      const b = { ...ctx, recordId: 'B' };
      const segA = await svc.encryptSegment({ secret: 'a-secret' }, key, a);
      await expect(svc.decryptSegment(segA, key, b)).rejects.toBeInstanceOf(AuthError);
    });
  });

  test('IV 长度不是 12 抛 CorruptError', async () => {
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    for (const len of [0, 11, 13, 16]) {
      await expect(
        svc.decryptSegment({ ...seg, iv: new Uint8Array(len) }, key, ctx)
      ).rejects.toBeInstanceOf(CorruptError);
    }
  });

  test('密文短于认证标签抛 CorruptError', async () => {
    const seg = await svc.encryptSegment({ secret: 'x' }, key, ctx);
    await expect(
      svc.decryptSegment({ ...seg, data: new Uint8Array(15) }, key, ctx)
    ).rejects.toBeInstanceOf(CorruptError);
  });

  test('缺字段抛 CorruptError,不抛 TypeError', async () => {
    await expect(svc.decryptSegment({} as never, key, ctx)).rejects.toBeInstanceOf(CorruptError);
    await expect(svc.decryptSegment(undefined as never, key, ctx)).rejects.toBeInstanceOf(
      CorruptError
    );
  });

  test('解出来不是合法 JSON 抛 CorruptError', async () => {
    // 用同一个 key 和 AAD 加密一段非 JSON 的字节,模拟"认证通过但内容损坏"
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: buildAad(ctx) as BufferSource },
        key,
        new TextEncoder().encode('not json {')
      )
    );
    await expect(svc.decryptSegment({ iv, data }, key, ctx)).rejects.toBeInstanceOf(CorruptError);
  });

  test('recordId 含分隔符 | 抛 CorruptError,避免 AAD 歧义', async () => {
    await expect(
      svc.encryptSegment({ secret: 'x' }, key, { ...ctx, recordId: 'a|b' })
    ).rejects.toBeInstanceOf(CorruptError);
    await expect(
      svc.encryptSegment({ secret: 'x' }, key, { ...ctx, recordId: '' })
    ).rejects.toBeInstanceOf(CorruptError);
  });

  test('buildAad 的内容与方案 §3.2 一致', () => {
    expect(new TextDecoder().decode(buildAad(ctx))).toBe(
      'riddle-notes/vault/record/v1|rec-1|api_key|1|secret'
    );
  });
});

describe('错误不携带敏感内容', () => {
  test('错误对象只有类别和固定文案', async () => {
    const key = await svc.importSessionKey(svc.generateVaultKeyBytes());
    const secret = 'sk-do-not-leak-me';
    const seg = await svc.encryptSegment({ secret }, key, ctx);
    const wrongKey = await svc.importSessionKey(svc.generateVaultKeyBytes());

    const error = await svc.decryptSegment(seg, wrongKey, ctx).catch(e => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(JSON.stringify({ name: error.name, message: error.message, kind: error.kind })).not.toContain(
      secret
    );
    expect(error.message).toBe('Authentication failed');
  });
});

describe('wipe', () => {
  test('只清 Uint8Array 自己的视图范围,不影响底层 buffer 里的其他部分', () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    wipe(backing.subarray(2, 4));
    expect(Array.from(backing)).toEqual([1, 2, 0, 0, 5, 6]);
  });

  test('ArrayBuffer 整个清零', () => {
    const buf = new Uint8Array([9, 9, 9]).buffer;
    wipe(buf);
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 0, 0]);
  });
});
