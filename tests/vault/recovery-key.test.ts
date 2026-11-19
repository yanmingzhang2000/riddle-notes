import { describe, expect, test } from 'vitest';
import {
  base32DecodeStrict,
  base32Encode,
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
} from '../../src/vault/crypto/recovery-key';
import {
  RecoveryKeyChecksumError,
  RecoveryKeyFormatError,
} from '../../src/vault/crypto/errors';

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

// 技术方案 §2.2 的测试向量,由 node:crypto 独立计算得出,必须逐字一致
const VECTORS: Array<[string, string]> = [
  [
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4',
  ],
  ['00'.repeat(32), 'RN-V1-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-MZUH'],
  ['ff'.repeat(32), 'RN-V1-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-7777-777Q-V6LB'],
];
const [VEC0_HEX, VEC0] = VECTORS[0];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 把半角字符串转成全角,模拟中文输入法下输入 */
function toFullWidth(text: string): string {
  return [...text]
    .map(c => {
      if (c === '-') return '\uFF0D';
      const code = c.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : c;
    })
    .join('');
}

describe('Recovery Key 格式', () => {
  test.each(VECTORS)('固定测试向量 %s', async (hex, expected) => {
    expect(await formatRecoveryKey(fromHex(hex))).toBe(expected);
    expect(toHex(await parseRecoveryKey(expected))).toBe(hex);
  });

  test.each(VECTORS)('长度 75,15 个连字符:%s', (_hex, text) => {
    expect(text).toHaveLength(75);
    expect(text.match(/-/g)).toHaveLength(15);
  });

  test('生成的 Key 是 13 组数据加 1 组校验', async () => {
    const { bytes, formatted } = await generateRecoveryKey();
    expect(bytes).toHaveLength(32);
    expect(formatted).toMatch(/^RN-V1-([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
    expect(toHex(await parseRecoveryKey(formatted))).toBe(toHex(bytes));
  });

  test('两次生成不同', async () => {
    const a = await generateRecoveryKey();
    const b = await generateRecoveryKey();
    expect(a.formatted).not.toBe(b.formatted);
  });

  test('formatRecoveryKey 拒绝长度不是 32 的输入', async () => {
    await expect(formatRecoveryKey(new Uint8Array(31))).rejects.toBeInstanceOf(
      RecoveryKeyFormatError
    );
  });
});

describe('Recovery Key 输入规范化', () => {
  test('小写', async () => {
    expect(toHex(await parseRecoveryKey(VEC0.toLowerCase()))).toBe(VEC0_HEX);
  });

  test('用空格代替连字符、首尾空白、换行', async () => {
    expect(toHex(await parseRecoveryKey(VEC0.replaceAll('-', ' ')))).toBe(VEC0_HEX);
    expect(toHex(await parseRecoveryKey(`  ${VEC0}\n`))).toBe(VEC0_HEX);
  });

  test('没有连字符', async () => {
    expect(toHex(await parseRecoveryKey(VEC0.replaceAll('-', '')))).toBe(VEC0_HEX);
  });

  test('中文输入法的全角字符(NFKC)', async () => {
    const fullWidth = toFullWidth(VEC0);
    expect(fullWidth).not.toBe(VEC0);
    expect(toHex(await parseRecoveryKey(fullWidth))).toBe(VEC0_HEX);
  });
});

describe('Recovery Key 必须拒绝的输入', () => {
  test.each([
    ['含 0', VEC0.replace('AAAQ', 'AA0Q')],
    ['含 1', VEC0.replace('AAAQ', 'AA1Q')],
    ['含 8', VEC0.replace('AAAQ', 'AA8Q')],
    ['含 9', VEC0.replace('AAAQ', 'AA9Q')],
    ['缺一组', VEC0.replace('-MMG4', '')],
    ['多一组', `${VEC0}-AAAA`],
    ['前缀版本错误', VEC0.replace('RN-V1', 'RN-V2')],
    ['前缀缺失', VEC0.replace('RN-V1-', '')],
    ['空字符串', ''],
    ['校验组含非法字符', VEC0.replace('MMG4', 'MMG1')],
  ])('格式错误:%s', async (_name, input) => {
    await expect(parseRecoveryKey(input)).rejects.toBeInstanceOf(RecoveryKeyFormatError);
  });

  test('校验和不符抛 RecoveryKeyChecksumError,与格式错误区分', async () => {
    await expect(parseRecoveryKey(VEC0.replace('MMG4', 'MMG5'))).rejects.toBeInstanceOf(
      RecoveryKeyChecksumError
    );
  });

  test('数据里输错一个字符会被校验和发现', async () => {
    await expect(parseRecoveryKey(VEC0.replace('AAAQ', 'AAAR'))).rejects.toBeInstanceOf(
      RecoveryKeyChecksumError
    );
  });

  test('填充位非 0:即使校验和合法也必须拒绝', async () => {
    // DYPQ → DYPR 只改了末字符的填充位。宽松解码会得到同一个 Key,
    // 所以原校验组 MMG4 对它仍然"合法",只有严格的填充位检查能拒绝它。
    const forged = VEC0.replace('DYPQ', 'DYPR');
    expect(forged).not.toBe(VEC0);

    const strictBytes = base32DecodeStrict('AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPQ');
    expect(toHex(strictBytes)).toBe(VEC0_HEX);
    expect(() =>
      base32DecodeStrict('AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPR')
    ).toThrow(RecoveryKeyFormatError);

    await expect(parseRecoveryKey(forged)).rejects.toBeInstanceOf(RecoveryKeyFormatError);
  });

  test('全 0xff 的向量:末字符是 Q 而不是 7', async () => {
    const forged = VECTORS[2][1].replace('777Q', '7777');
    await expect(parseRecoveryKey(forged)).rejects.toBeInstanceOf(RecoveryKeyFormatError);
  });

  test("'ß' 不会因为大写成 'SS' 而被接受", async () => {
    // 'ß'.toUpperCase() === 'SS',而 SS 在字母表里。如果用 toUpperCase,
    // 把合法 Key 里的 SS 换成 ß 仍能解析成功,两个不同的输入解出同一个 Key。
    // 先找一个数据部分本来就含 SS 的合法 Key。
    let clean = '';
    let bytes = new Uint8Array(0);
    for (let i = 0; i < 5000 && !clean.slice(4, 56).includes('SS'); i++) {
      bytes = crypto.getRandomValues(new Uint8Array(32));
      clean = (await formatRecoveryKey(bytes)).replaceAll('-', '');
    }
    expect(clean.slice(4, 56)).toContain('SS');
    expect(toHex(await parseRecoveryKey(clean))).toBe(toHex(bytes));

    const withSharpS = clean.replace('SS', 'ß');
    await expect(parseRecoveryKey(withSharpS)).rejects.toBeInstanceOf(RecoveryKeyFormatError);
  });
});

describe('Base32', () => {
  test('编码字母表只含 A-Z 与 2-7', () => {
    const text = base32Encode(Uint8Array.from({ length: 32 }, (_, i) => i * 8));
    expect(text).toHaveLength(52);
    for (const c of text) expect(ALPHABET).toContain(c);
  });

  test('严格解码拒绝长度不是 52 的输入', () => {
    expect(() => base32DecodeStrict('A'.repeat(51))).toThrow(RecoveryKeyFormatError);
    expect(() => base32DecodeStrict('A'.repeat(53))).toThrow(RecoveryKeyFormatError);
  });

  test('随机 Key 往返一致', async () => {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      expect(toHex(base32DecodeStrict(base32Encode(bytes)))).toBe(toHex(bytes));
    }
  });
});
