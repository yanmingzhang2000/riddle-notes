/**
 * Recovery Key 的分组、抽查与比对。纯函数,展示组件和回填校验组件共用,
 * 这样"第 N 组"在两处指的是同一个位置。
 *
 * 格式见技术方案 §2.2:`RN-V1-` + 14 组(13 组数据 + 1 组校验),每组 4 个字符。
 */

const PREFIX_PARTS = 2; // "RN" 和 "V1"

export interface RecoveryKeyParts {
  /** "RN-V1" */
  prefix: string;
  /** 14 个 4 字符的分组 */
  groups: string[];
}

export function splitRecoveryKey(formatted: string): RecoveryKeyParts {
  const parts = formatted.split('-');
  return { prefix: parts.slice(0, PREFIX_PARTS).join('-'), groups: parts.slice(PREFIX_PARTS) };
}

/**
 * 用 crypto 的随机数、拒绝采样取 [0, maxExclusive) 的整数,避免取模偏差。
 * 这里不涉及密钥,只是让抽查的位置不可预测;用 crypto 是因为没有理由用更差的。
 */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
    throw new RangeError('maxExclusive out of range');
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

/** 从 [0, total) 里不放回地抽 count 个下标,升序返回 */
export function pickGroupIndexes(
  total: number,
  count: number,
  randomInt: (maxExclusive: number) => number = secureRandomInt
): number[] {
  if (!Number.isInteger(total) || !Number.isInteger(count) || count < 0 || count > total) {
    throw new RangeError('Cannot pick that many groups');
  }
  const pool = Array.from({ length: total }, (_, index) => index);
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = randomInt(pool.length);
    picked.push(pool[at]);
    pool.splice(at, 1);
  }
  return picked.sort((a, b) => a - b);
}

/** 只转换 a-z。toUpperCase 会把某些非 ASCII 字符(如土耳其语的 ı)也变成 ASCII 字母 */
const asciiUpper = (text: string) => text.replace(/[a-z]/g, char => char.toUpperCase());

/**
 * 规范化用户输入的一个分组:全角转半角(中文输入法常见)、去掉空白和连字符、大小写不敏感。
 * 与 parseRecoveryKey 对整串输入的宽容程度保持一致。
 */
export function normalizeGroupInput(input: string): string {
  return asciiUpper(input.normalize('NFKC')).replace(/[\s-]/g, '');
}

export function groupMatches(input: string, expected: string): boolean {
  return normalizeGroupInput(input) === expected;
}
