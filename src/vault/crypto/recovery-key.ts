/**
 * Recovery Key 的格式、编码和解析。规范见技术方案 §2.2,这是冻结项。
 *
 *   RN-V1-AAAQ-EAYE-…-DYPQ-MMG4     共 75 字符,15 个连字符
 *
 * 32 字节 → 52 个 Base32 字符(260 bit,末字符低 4 位是填充位,必须为 0)
 * 校验 = SHA-256(32 字节)的前 20 bit → 4 个 Base32 字符
 * 校验和只用来区分"输错字符"和"Key 不对",不提供安全性。
 *
 * 校验和用 Web Crypto 的 SHA-256,所以 format / parse / generate 都是异步的。
 */
import { asBufferSource } from './bytes';
import { RecoveryKeyChecksumError, RecoveryKeyFormatError } from './errors';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PREFIX = 'RN-V1-';
const KEY_BYTES = 32;
const DATA_CHARS = 52;
const CHECK_CHARS = 4;
const GROUP_SIZE = 4;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * 严格解码。字符数必须恰好是 52,且末字符的 4 个填充位必须为 0,
 * 否则两个不同的字符串会解出同一个 Key。
 */
export function base32DecodeStrict(text: string): Uint8Array {
  if (text.length !== DATA_CHARS) throw new RecoveryKeyFormatError();

  const out = new Uint8Array(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new RecoveryKeyFormatError();
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  if (index !== KEY_BYTES || value !== 0) throw new RecoveryKeyFormatError();
  return out;
}

async function checksumOf(key: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', asBufferSource(key)));
  const v = (digest[0] << 12) | (digest[1] << 4) | (digest[2] >>> 4);
  let out = '';
  for (let shift = 15; shift >= 0; shift -= 5) out += ALPHABET[(v >>> shift) & 31];
  return out;
}

export async function formatRecoveryKey(key: Uint8Array): Promise<string> {
  if (key.length !== KEY_BYTES) throw new RecoveryKeyFormatError();
  const body = base32Encode(key) + (await checksumOf(key));
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP_SIZE) groups.push(body.slice(i, i + GROUP_SIZE));
  return PREFIX + groups.join('-');
}

export async function generateRecoveryKey(): Promise<{ bytes: Uint8Array; formatted: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return { bytes, formatted: await formatRecoveryKey(bytes) };
}

/** 只转换 ASCII 小写,避免 'ß'.toUpperCase() === 'SS' 这类映射让不同的输入解出同一个 Key */
function asciiUpper(text: string): string {
  return text.replace(/[a-z]/g, c => c.toUpperCase());
}

/**
 * 规范化并解析用户输入。NFKC 会把全角字母转成半角,中文输入法下常见。
 * 格式错误抛 RecoveryKeyFormatError,校验和不符抛 RecoveryKeyChecksumError。
 */
export async function parseRecoveryKey(input: string): Promise<Uint8Array> {
  const clean = asciiUpper(input.normalize('NFKC')).replace(/[\s-]/g, '');
  if (!clean.startsWith('RNV1') || clean.length !== 4 + DATA_CHARS + CHECK_CHARS) {
    throw new RecoveryKeyFormatError();
  }
  const data = clean.slice(4, 4 + DATA_CHARS);
  const check = clean.slice(4 + DATA_CHARS);
  for (const char of check) {
    if (!ALPHABET.includes(char)) throw new RecoveryKeyFormatError();
  }

  const bytes = base32DecodeStrict(data);
  if (check !== (await checksumOf(bytes))) {
    bytes.fill(0);
    throw new RecoveryKeyChecksumError();
  }
  return bytes;
}
