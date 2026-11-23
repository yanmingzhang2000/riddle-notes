/**
 * Vault 的密码学封装。接口见技术方案 §5.1,签名在这里冻结。
 *
 * 只用 Web Crypto,不实现任何密码学原语。
 * 注意:subtle 返回的 ArrayBuffer 在 jsdom 下不是 jsdom 的 ArrayBuffer 实例,
 * 所以这里不用 instanceof 判断,一律用 new Uint8Array(buf) 读取。
 */
import { asBufferSource, wipe } from './bytes';
import { AuthError, CorruptError, UnsupportedKdfError } from './errors';
import { formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from './recovery-key';
import type {
  EncryptedBytes,
  KdfParams,
  SegmentContext,
  WrappedKey,
} from '../types';

export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const VAULT_KEY_LENGTH = 32;
export const KEY_ID_LENGTH = 8;
export const MIN_SALT_LENGTH = 16;
export const SALT_LENGTH = 32;

const WRAPPED_KEY_LENGTH = VAULT_KEY_LENGTH + TAG_LENGTH;
const RECOVERY_WRAP_INFO = 'riddle-notes/vault/recovery-wrap/v1';
const KEY_ID_INFO = 'riddle-notes/vault/key-id/v1';
const AAD_LABEL = 'riddle-notes/vault/record/v1';

/** 当前策略。解锁成功后若 master wrapper 的参数低于它,就静默重包装 */
export const PBKDF2_POLICY_ITERATIONS = 600_000;

export function createDefaultKdf(): KdfParams {
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: PBKDF2_POLICY_ITERATIONS,
    salt: crypto.getRandomValues(new Uint8Array(SALT_LENGTH)),
  };
}

/** 参数是否低于当前策略(需要升级) */
export function kdfNeedsUpgrade(kdf: KdfParams): boolean {
  switch (kdf.algorithm) {
    case 'PBKDF2-SHA256':
      return kdf.iterations < PBKDF2_POLICY_ITERATIONS;
    case 'Argon2id':
      return false;
  }
}

function toBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function requireLength(bytes: Uint8Array | undefined, length: number): asserts bytes is Uint8Array {
  if (!bytes || bytes.length !== length) throw new CorruptError();
}

export class CryptoService {
  // —— KDF ————————————————————————————————————————————

  /** 主密码在这里统一做 NFKC 规范化,避免输入法产生的组合形式差异导致解锁失败 */
  async deriveMasterWrapKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
    if (!kdf.salt || kdf.salt.length < MIN_SALT_LENGTH) throw new CorruptError();

    switch (kdf.algorithm) {
      case 'PBKDF2-SHA256': {
        if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) throw new CorruptError();
        const passwordBytes = new TextEncoder().encode(password.normalize('NFKC'));
        try {
          const base = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, [
            'deriveKey',
          ]);
          return await crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: asBufferSource(kdf.salt),
              iterations: kdf.iterations,
              hash: 'SHA-256',
            },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
        } finally {
          passwordBytes.fill(0);
        }
      }
      case 'Argon2id':
        // 等 Task 1.0 spike 的结论再接入,联合类型已经为它留好了分支
        throw new UnsupportedKdfError();
      default:
        // 库里的 algorithm 不是已知值:数据损坏,不能让它落到 undefined 上
        throw new CorruptError();
    }
  }

  /**
   * Recovery Key 有 256 bit 熵,不需要慢 KDF,用 HKDF-SHA256。
   * usages 必须是 encrypt/decrypt,因为 wrap/unwrap 直接调 subtle.encrypt/decrypt;
   * 写成 wrapKey/unwrapKey 会抛 InvalidAccessError。
   */
  async deriveRecoveryWrapKey(keyBytes: Uint8Array): Promise<CryptoKey> {
    requireLength(keyBytes, VAULT_KEY_LENGTH);
    const ikm = await crypto.subtle.importKey('raw', asBufferSource(keyBytes), 'HKDF', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(RECOVERY_WRAP_INFO),
      },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // —— Vault Key ————————————————————————————————————————

  /** 32 字节随机 Vault Key。调用方包装完后必须 fill(0) */
  generateVaultKeyBytes(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(VAULT_KEY_LENGTH));
  }

  /** Session 持有的 key 一律不可导出 */
  async importSessionKey(raw: Uint8Array): Promise<CryptoKey> {
    requireLength(raw, VAULT_KEY_LENGTH);
    return crypto.subtle.importKey(
      'raw',
      asBufferSource(raw),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /** HKDF(vaultKey) 的前 8 字节。不同 Vault Key 的 keyId 不同,用来发现库被替换 */
  async computeKeyId(raw: Uint8Array): Promise<Uint8Array> {
    requireLength(raw, VAULT_KEY_LENGTH);
    const ikm = await crypto.subtle.importKey('raw', asBufferSource(raw), 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(KEY_ID_INFO),
      },
      ikm,
      KEY_ID_LENGTH * 8
    );
    return toBytes(bits);
  }

  // —— 包装:以原始字节进出 ——————————————————————————————————

  async wrap(vaultKeyRaw: Uint8Array, wrapKey: CryptoKey): Promise<WrappedKey> {
    requireLength(vaultKeyRaw, VAULT_KEY_LENGTH);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBufferSource(iv) },
      wrapKey,
      asBufferSource(vaultKeyRaw)
    );
    return { wrappedKey: toBytes(encrypted), iv };
  }

  /** 返回原始字节,调用方用完必须 fill(0)。结构不对抛 CorruptError,认证失败抛 AuthError */
  async unwrap(wrapped: WrappedKey, wrapKey: CryptoKey): Promise<Uint8Array> {
    requireLength(wrapped?.iv, IV_LENGTH);
    requireLength(wrapped?.wrappedKey, WRAPPED_KEY_LENGTH);

    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: asBufferSource(wrapped.iv) },
        wrapKey,
        asBufferSource(wrapped.wrappedKey)
      );
    } catch {
      throw new AuthError();
    }
    const raw = toBytes(decrypted).slice();
    wipe(decrypted);
    return raw;
  }

  // —— 记录:每段独立 IV,AAD 绑定上下文 ————————————————————————

  /** IV 由这里生成,调用方无法传入 */
  async encryptSegment(
    plain: object,
    key: CryptoKey,
    ctx: SegmentContext
  ): Promise<EncryptedBytes> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plainBytes = new TextEncoder().encode(JSON.stringify(plain));
    try {
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(iv),
          additionalData: asBufferSource(buildAad(ctx)),
        },
        key,
        asBufferSource(plainBytes)
      );
      return { iv, data: toBytes(encrypted) };
    } finally {
      plainBytes.fill(0);
    }
  }

  async decryptSegment<T>(
    segment: EncryptedBytes,
    key: CryptoKey,
    ctx: SegmentContext
  ): Promise<T> {
    requireLength(segment?.iv, IV_LENGTH);
    if (!segment.data || segment.data.length < TAG_LENGTH) throw new CorruptError();

    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(segment.iv),
          additionalData: asBufferSource(buildAad(ctx)),
        },
        key,
        asBufferSource(segment.data)
      );
    } catch {
      throw new AuthError();
    }

    try {
      return JSON.parse(new TextDecoder().decode(decrypted)) as T;
    } catch {
      throw new CorruptError();
    } finally {
      wipe(decrypted);
    }
  }

  // —— Recovery Key,规范见 §2.2 ————————————————————————————

  generateRecoveryKey(): Promise<{ bytes: Uint8Array; formatted: string }> {
    return generateRecoveryKey();
  }

  formatRecoveryKey(bytes: Uint8Array): Promise<string> {
    return formatRecoveryKey(bytes);
  }

  /** 抛 RecoveryKeyFormatError | RecoveryKeyChecksumError */
  parseRecoveryKey(input: string): Promise<Uint8Array> {
    return parseRecoveryKey(input);
  }
}

/**
 * AAD = UTF-8( "riddle-notes/vault/record/v1" | recordId | type | formatVersion | segment )
 * 篡改明文 type、把 A 记录的密文放到 B 记录上、互换 summary 与 secret,解密都会失败。
 */
export function buildAad(ctx: SegmentContext): Uint8Array {
  if (!ctx.recordId || ctx.recordId.includes('|')) throw new CorruptError();
  const text = [AAD_LABEL, ctx.recordId, ctx.type, String(ctx.formatVersion), ctx.segment].join('|');
  return new TextEncoder().encode(text);
}
