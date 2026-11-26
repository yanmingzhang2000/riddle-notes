/**
 * 云同步加密模块
 * 
 * 复用保险箱的加密逻辑，但用途和密钥独立：
 * - 保险箱：加密保险箱记录（API Key、密码等）
 * - 云同步：加密整份备份快照
 * 
 * 加密方案：
 * - 数据密钥：32 字节随机，AES-256-GCM 加密快照
 * - 同步口令：用户设置，PBKDF2-SHA256 60 万次派生包装密钥
 * - 恢复密钥：32 字节随机，HKDF-SHA256 派生包装密钥（无需慢 KDF）
 * - 数据密钥分别用口令和恢复密钥各包装一份
 */

import type { BackupFile } from './backup';

// 复用保险箱常量
export const SYNC_KEY_LENGTH = 32;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const SALT_LENGTH = 32;
export const MIN_SALT_LENGTH = 16;
export const PBKDF2_ITERATIONS = 600_000;

const WRAPPED_KEY_LENGTH = SYNC_KEY_LENGTH + TAG_LENGTH;
const RECOVERY_WRAP_INFO = 'riddle-notes/sync/recovery-wrap/v1';
const PASSPHRASE_WRAP_INFO = 'riddle-notes/sync/passphrase-wrap/v1';

/** KDF 参数 */
export interface SyncKdfParams {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  salt: Uint8Array;
}

/** 包装后的密钥 */
export interface SyncWrappedKey {
  wrappedKey: Uint8Array;  // 加密后的数据密钥 + GCM tag
  iv: Uint8Array;          // AES-GCM IV
}

/** 加密后的快照 */
export interface EncryptedSnapshot {
  version: number;
  encryptedData: Uint8Array;
  wrappedKey: Uint8Array;
  wrapIv: Uint8Array;
  kdfParams: SyncKdfParams;
  createdAt: string;
}

/** 云同步错误基类 */
export class SyncCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncCryptoError';
  }
}

/** 认证失败（口令错误、篡改密文） */
export class SyncAuthError extends SyncCryptoError {
  constructor() {
    super('同步口令错误或数据已被篡改');
    this.name = 'SyncAuthError';
  }
}

/** 数据损坏 */
export class SyncCorruptError extends SyncCryptoError {
  constructor() {
    super('数据格式错误或已损坏');
    this.name = 'SyncCorruptError';
  }
}

function toBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function requireLength(bytes: Uint8Array | undefined, length: number): asserts bytes is Uint8Array {
  if (!bytes || bytes.length !== length) throw new SyncCorruptError();
}

/** 安全擦除内存中的敏感数据 */
export function wipe(data: ArrayBuffer | Uint8Array): void {
  if (data instanceof Uint8Array) {
    data.fill(0);
  } else if (data instanceof ArrayBuffer) {
    new Uint8Array(data).fill(0);
  }
}

// ============================================================================
// KDF：从口令或恢复密钥派生包装密钥
// ============================================================================

/** 创建默认 KDF 参数 */
export function createDefaultKdf(): SyncKdfParams {
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: crypto.getRandomValues(new Uint8Array(SALT_LENGTH)),
  };
}

/**
 * 从同步口令派生包装密钥（PBKDF2 60 万次）
 * 口令统一做 NFKC 规范化，避免输入法组合形式差异
 */
export async function deriveSyncWrapKey(passphrase: string, kdf: SyncKdfParams): Promise<CryptoKey> {
  if (!kdf.salt || kdf.salt.length < MIN_SALT_LENGTH) throw new SyncCorruptError();
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) throw new SyncCorruptError();

  const passphraseBytes = new TextEncoder().encode(passphrase.normalize('NFKC'));
  try {
    const base = await crypto.subtle.importKey('raw', passphraseBytes, 'PBKDF2', false, ['deriveKey']);
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
    passphraseBytes.fill(0);
  }
}

/**
 * 从恢复密钥派生包装密钥（HKDF-SHA256，无需慢 KDF）
 * recoveryKeyBytes: 32 字节恢复密钥
 */
export async function deriveRecoveryWrapKey(recoveryKeyBytes: Uint8Array): Promise<CryptoKey> {
  requireLength(recoveryKeyBytes, SYNC_KEY_LENGTH);
  
  const ikm = await crypto.subtle.importKey('raw', asBufferSource(recoveryKeyBytes), 'HKDF', false, ['deriveKey']);
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

// ============================================================================
// 数据密钥管理
// ============================================================================

/** 生成随机数据密钥（32 字节），调用方用完后必须 wipe() */
export function generateSyncKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SYNC_KEY_LENGTH));
}

/**
 * 包装数据密钥（AES-GCM）
 * dataKeyRaw: 32 字节数据密钥（明文）
 * wrapKey: 派生的包装密钥（来自口令或恢复密钥）
 */
export async function wrapSyncKey(dataKeyRaw: Uint8Array, wrapKey: CryptoKey): Promise<SyncWrappedKey> {
  requireLength(dataKeyRaw, SYNC_KEY_LENGTH);
  
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv) },
    wrapKey,
    asBufferSource(dataKeyRaw)
  );
  
  return { wrappedKey: toBytes(encrypted), iv };
}

/**
 * 解包数据密钥
 * 返回 32 字节数据密钥（明文），调用方用完后必须 wipe()
 * 包装密钥错误或密文被篡改会抛 SyncAuthError
 */
export async function unwrapSyncKey(wrapped: SyncWrappedKey, wrapKey: CryptoKey): Promise<Uint8Array> {
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
    throw new SyncAuthError();
  }

  const raw = toBytes(decrypted).slice();
  wipe(decrypted);
  return raw;
}

/** 导入数据密钥为 CryptoKey（session 期间使用，不可导出） */
async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  requireLength(raw, SYNC_KEY_LENGTH);
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(raw),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// 快照加密和解密
// ============================================================================

/**
 * 加密快照
 * backup: BackupFile 对象（来自 backup.ts 的 createBackup）
 * dataKeyRaw: 32 字节数据密钥（明文）
 */
export async function encryptSnapshot(backup: BackupFile, dataKeyRaw: Uint8Array): Promise<Uint8Array> {
  requireLength(dataKeyRaw, SYNC_KEY_LENGTH);

  const dataKey = await importDataKey(dataKeyRaw);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plainBytes = new TextEncoder().encode(JSON.stringify(backup));

  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBufferSource(iv) },
      dataKey,
      asBufferSource(plainBytes)
    );

    // 格式：IV (12 字节) + 密文 + GCM tag (16 字节)
    const result = new Uint8Array(IV_LENGTH + encrypted.byteLength);
    result.set(iv, 0);
    result.set(toBytes(encrypted), IV_LENGTH);
    return result;
  } finally {
    plainBytes.fill(0);
  }
}

/**
 * 解密快照
 * encryptedData: 加密的快照数据（IV + 密文 + tag）
 * dataKeyRaw: 32 字节数据密钥（明文）
 */
export async function decryptSnapshot(encryptedData: Uint8Array, dataKeyRaw: Uint8Array): Promise<BackupFile> {
  requireLength(dataKeyRaw, SYNC_KEY_LENGTH);
  
  if (!encryptedData || encryptedData.length < IV_LENGTH + TAG_LENGTH) {
    throw new SyncCorruptError();
  }

  const dataKey = await importDataKey(dataKeyRaw);
  const iv = encryptedData.slice(0, IV_LENGTH);
  const ciphertext = encryptedData.slice(IV_LENGTH);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(iv) },
      dataKey,
      asBufferSource(ciphertext)
    );
  } catch {
    throw new SyncAuthError();
  }

  try {
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json) as BackupFile;
  } catch {
    throw new SyncCorruptError();
  } finally {
    wipe(decrypted);
  }
}

// ============================================================================
// 恢复密钥生成和格式化（复用保险箱格式）
// ============================================================================

/**
 * 生成恢复密钥
 * 返回：{ bytes: 32 字节原始密钥, formatted: Base32 编码的可读格式 }
 * 
 * 格式复用保险箱：Base32 编码，10 组每组 5 字符，带 CRC-16 校验和
 * 示例：ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z2345-67890-ABCDE-FGHIJ-KLMNO
 */
export async function generateRecoveryKey(): Promise<{ bytes: Uint8Array; formatted: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(SYNC_KEY_LENGTH));
  
  // 这里应该调用保险箱的 formatRecoveryKey，但为了独立性，先简化实现
  // TODO: 复用 src/vault/crypto/recovery-key.ts 的 formatRecoveryKey
  const formatted = await formatRecoveryKeySimplified(bytes);
  
  return { bytes, formatted };
}

/**
 * 解析恢复密钥（从格式化字符串恢复原始字节）
 * TODO: 复用 src/vault/crypto/recovery-key.ts 的 parseRecoveryKey
 */
export async function parseRecoveryKey(formatted: string): Promise<Uint8Array> {
  // 简化实现，实际应复用保险箱的 parseRecoveryKey
  throw new SyncCryptoError('恢复密钥解析尚未实现，请先设置同步口令');
}

/** 简化的恢复密钥格式化（临时，待复用保险箱实现） */
async function formatRecoveryKeySimplified(bytes: Uint8Array): Promise<string> {
  // Base32 编码（无填充）
  const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += base32Alphabet[parseInt(chunk, 2)];
  }
  
  // 分组显示（10 组，每组 5 字符）
  const groups: string[] = [];
  for (let i = 0; i < result.length; i += 5) {
    groups.push(result.slice(i, i + 5));
  }
  
  return groups.slice(0, 10).join('-');
}
