/**
 * UI 用到的纯逻辑:Recovery Key 的分组与抽查、下载文件的内容、错误文案。
 * 不渲染任何组件。组件本身的行为见 vault-components.test.tsx。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AlreadyInitializedError,
  AuthError,
  ConflictError,
  CorruptError,
  NotFoundError,
  NotInitializedError,
  RecoveryKeyChecksumError,
  RecoveryKeyFormatError,
  UnsupportedKdfError,
  VaultError,
  VaultLockedError,
  WeakPasswordError,
} from '../../src/vault/crypto/errors';
import { generateRecoveryKey } from '../../src/vault/crypto/recovery-key';
import {
  RECOVERY_KEY_FILE_WARNING,
  buildRecoveryKeyFile,
  downloadRecoveryKeyFile,
  recoveryKeyFileName,
} from '../../src/vault/components/recovery-key-file';
import {
  groupMatches,
  normalizeGroupInput,
  pickGroupIndexes,
  secureRandomInt,
  splitRecoveryKey,
} from '../../src/vault/components/recovery-key-groups';
import { GENERIC_ERROR_MESSAGE, describeVaultError } from '../../src/vault/error-messages';
import { vaultReturnPath } from '../../src/vault/pages/return-path';
import { filterSummaries, groupSummaries } from '../../src/vault/pages/list-model';
import { emptyForm, formFromSecret, parseTags, toRecordInput, validateForm } from '../../src/vault/pages/editor-model';
import { formatDate, formatDateTime } from '../../src/vault/pages/format';
import { VAULT_TYPE_FIELDS, VAULT_TYPE_LABELS } from '../../src/vault/components/record-types';
import { VAULT_RECORD_TYPES, type VaultSecret, type VaultSummary } from '../../src/vault/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const VECTOR = 'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4';

describe('splitRecoveryKey', () => {
  test('测试向量:前缀 RN-V1,14 组,首尾正确', () => {
    const { prefix, groups } = splitRecoveryKey(VECTOR);

    expect(prefix).toBe('RN-V1');
    expect(groups).toHaveLength(14);
    expect(groups[0]).toBe('AAAQ');
    expect(groups[13]).toBe('MMG4');
    expect(groups.every(g => g.length === 4)).toBe(true);
  });

  test('拆开再拼回去,和原串完全一致(对真实生成的 Key)', async () => {
    for (let i = 0; i < 5; i++) {
      const { formatted } = await generateRecoveryKey();
      const { prefix, groups } = splitRecoveryKey(formatted);

      expect(`${prefix}-${groups.join('-')}`).toBe(formatted);
      expect(groups).toHaveLength(14);
    }
  });
});

describe('pickGroupIndexes', () => {
  test('返回 count 个互不相同、升序、在范围内的下标', () => {
    for (let i = 0; i < 200; i++) {
      const picked = pickGroupIndexes(14, 3);

      expect(picked).toHaveLength(3);
      expect(new Set(picked).size).toBe(3);
      expect(picked).toEqual([...picked].sort((a, b) => a - b));
      expect(picked.every(n => Number.isInteger(n) && n >= 0 && n < 14)).toBe(true);
    }
  });

  test('不放回:每次抽的范围依次缩小 14 → 13 → 12', () => {
    const seen: number[] = [];

    pickGroupIndexes(14, 3, max => {
      seen.push(max);
      return 0;
    });

    expect(seen).toEqual([14, 13, 12]);
  });

  test('随机数决定结果:总取第 0 个得到 [0,1,2];总取最后一个得到 [11,12,13]', () => {
    expect(pickGroupIndexes(14, 3, () => 0)).toEqual([0, 1, 2]);
    expect(pickGroupIndexes(14, 3, max => max - 1)).toEqual([11, 12, 13]);
  });

  test('每个位置都有机会被抽到,并且不是每次都一样', () => {
    const seen = new Set<number>();
    const combos = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const picked = pickGroupIndexes(14, 3);
      picked.forEach(n => seen.add(n));
      combos.add(picked.join(','));
    }

    expect(seen.size).toBe(14);
    expect(combos.size).toBeGreaterThan(50);
  });

  test('count 为 0 返回空;count 等于 total 返回全部', () => {
    expect(pickGroupIndexes(5, 0)).toEqual([]);
    expect(pickGroupIndexes(5, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  test.each([
    [3, 4],
    [3, -1],
    [3, 1.5],
    [-1, 0],
    [2.5, 1],
  ])('参数不合法(total=%s, count=%s)抛 RangeError', (total, count) => {
    expect(() => pickGroupIndexes(total, count)).toThrow(RangeError);
  });
});

describe('secureRandomInt', () => {
  test('取值在 [0, max) 内,所有取值都出现过', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const n = secureRandomInt(5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
      seen.add(n);
    }

    expect(seen.size).toBe(5);
  });

  test('max 为 1 时恒为 0', () => {
    for (let i = 0; i < 20; i++) expect(secureRandomInt(1)).toBe(0);
  });

  test('拒绝采样:落在不能均分的尾部的随机数被丢弃重抽,不做取模', () => {
    // max=3 时,2^32 不能被 3 整除,0xFFFFFFFF 落在尾部。直接取模会得到 0,偏向小的数
    const outputs = [0xffffffff, 7];
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((buffer: Uint32Array) => {
      buffer[0] = outputs.shift()!;
      return buffer;
    }) as typeof crypto.getRandomValues);

    const n = secureRandomInt(3);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(n).toBe(7 % 3);
  });

  test.each([0, -1, 1.5, NaN, Infinity, 0x100000001])('max=%s 抛 RangeError', max => {
    expect(() => secureRandomInt(max)).toThrow(RangeError);
  });
});

describe('normalizeGroupInput / groupMatches', () => {
  test('大小写、首尾空白、连字符、全角字符都不影响比对', () => {
    expect(normalizeGroupInput('aaaq')).toBe('AAAQ');
    expect(normalizeGroupInput('  AAAQ \n')).toBe('AAAQ');
    expect(normalizeGroupInput('AA-AQ')).toBe('AAAQ');
    expect(normalizeGroupInput('ＡＡＡＱ')).toBe('AAAQ');
  });

  test('groupMatches:一致、不一致、只输了一半', () => {
    expect(groupMatches('aaaq', 'AAAQ')).toBe(true);
    expect(groupMatches('AAAP', 'AAAQ')).toBe(false);
    expect(groupMatches('AAA', 'AAAQ')).toBe(false);
    expect(groupMatches('', 'AAAQ')).toBe(false);
    expect(groupMatches('AAAQQ', 'AAAQ')).toBe(false);
  });

  test('只转换 a-z:土耳其语的无点 ı 不会被当成 I', () => {
    // 'ı'.toUpperCase() 在标准实现里是 'I',如果用它就会让 "ıııı" 匹配 "IIII"
    expect(groupMatches('ıııı', 'IIII')).toBe(false);
  });
});

describe('Recovery Key 下载文件', () => {
  const NOW = new Date(2026, 10, 19, 23, 59, 0); // 本地时间 2026-11-19 23:59,避开时区造成的日期偏差

  test('文件名带本地日期', () => {
    expect(recoveryKeyFileName(NOW)).toBe('riddle-notes-recovery-key-2026-11-19.txt');
  });

  test('日期取的是本地日期,不是 UTC 日期(用本地与 UTC 取值故意不同的假 Date,与运行机器的时区无关)', () => {
    const fake = {
      getFullYear: () => 2026,
      getMonth: () => 10,
      getDate: () => 19,
      getUTCFullYear: () => 1999,
      getUTCMonth: () => 0,
      getUTCDate: () => 1,
    } as unknown as Date;

    expect(recoveryKeyFileName(fake)).toBe('riddle-notes-recovery-key-2026-11-19.txt');
    expect(buildRecoveryKeyFile(VECTOR, fake)).toContain('2026-11-19');
    expect(buildRecoveryKeyFile(VECTOR, fake)).not.toContain('1999');
  });

  test('月和日补零', () => {
    expect(recoveryKeyFileName(new Date(2026, 0, 5))).toBe('riddle-notes-recovery-key-2026-01-05.txt');
  });

  test('文件头的警示是技术方案规定的那句,并且出现在 Recovery Key 之前', () => {
    const text = buildRecoveryKeyFile(VECTOR, NOW);

    expect(RECOVERY_KEY_FILE_WARNING).toBe('此文件无需主密码即可打开你的保险箱，请勿与加密备份放在同一位置。');
    expect(text).toContain(RECOVERY_KEY_FILE_WARNING);
    expect(text.indexOf(RECOVERY_KEY_FILE_WARNING)).toBeLessThan(text.indexOf(VECTOR));
  });

  test('Recovery Key 独占一行,原样写入,日期是本地日期', () => {
    const lines = buildRecoveryKeyFile(VECTOR, NOW).split('\n');

    expect(lines).toContain(VECTOR);
    expect(lines.some(line => line.includes('2026-11-19'))).toBe(true);
  });

  test('只含这一把 Key:不会把别的东西写进去', () => {
    const text = buildRecoveryKeyFile(VECTOR, NOW);

    expect(text.match(/RN-V1-/g)).toHaveLength(1);
  });

  describe('downloadRecoveryKeyFile', () => {
    function stubDownload() {
      const blobs: Blob[] = [];
      const clicked: Array<{ href: string; download: string }> = [];
      Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          blobs.push(blob);
          return 'blob:test-url';
        }),
        revokeObjectURL: vi.fn(),
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
      return { blobs, clicked, click };
    }

    const readBytes = (blob: Blob) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

    test('点击一个带正确文件名的链接,内容是 UTF-8(带 BOM)的文本,含警示和 Key', async () => {
      const { blobs, clicked } = stubDownload();

      downloadRecoveryKeyFile(VECTOR, NOW);

      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe('riddle-notes-recovery-key-2026-11-19.txt');
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toContain('text/plain');
      const bytes = await readBytes(blobs[0]);
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder('utf-8').decode(bytes.slice(3));
      expect(text).toContain(RECOVERY_KEY_FILE_WARNING);
      expect(text).toContain(VECTOR);
    });

    test('稍后释放对象地址,不是立刻(否则下载可能还没开始)', () => {
      vi.useFakeTimers();
      stubDownload();

      downloadRecoveryKeyFile(VECTOR, NOW);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});

describe('describeVaultError(§5.3)', () => {
  test('三类固定文案', () => {
    expect(describeVaultError(new CorruptError())).toBe('保险箱数据已损坏，可导出原始加密备份');
    expect(describeVaultError(new RecoveryKeyFormatError())).toBe('恢复密钥输入有误，请检查');
    expect(describeVaultError(new RecoveryKeyChecksumError())).toBe('恢复密钥输入有误，请检查');
    expect(describeVaultError(new AuthError())).toBe('密码错误，或数据已损坏。可尝试使用恢复密钥');
  });

  test('认证失败:两种可能(密码错、数据损坏)都要说;输入恢复密钥时不再建议"使用恢复密钥"', () => {
    const master = describeVaultError(new AuthError(), 'master');
    const recovery = describeVaultError(new AuthError(), 'recovery');

    expect(master).toContain('密码错误');
    expect(master).toContain('数据已损坏');
    expect(master).toContain('恢复密钥');
    expect(recovery).toContain('数据已损坏');
    expect(recovery).not.toContain('可尝试使用恢复密钥');
    expect(recovery).not.toBe(master);
  });

  test('默认按主密码处理', () => {
    expect(describeVaultError(new AuthError())).toBe(describeVaultError(new AuthError(), 'master'));
  });

  test('弱密码:按 issues 给出对应的话,多个用分号连接', () => {
    expect(describeVaultError(new WeakPasswordError(['too-short']))).toContain('12');
    expect(describeVaultError(new WeakPasswordError(['too-weak']))).toContain('太容易被猜到');
    const both = describeVaultError(new WeakPasswordError(['too-short', 'too-weak']));
    expect(both).toContain('12');
    expect(both).toContain('太容易被猜到');
    expect(both).toContain('；');
  });

  test('弱密码但没有 issues:仍然给出一句话,不是通用错误', () => {
    const text = describeVaultError(new WeakPasswordError([]));

    expect(text).not.toBe(GENERIC_ERROR_MESSAGE);
    expect(text).toContain('强度');
  });

  test.each([
    ['VaultLockedError', new VaultLockedError(), '已锁定'],
    ['ConflictError', new ConflictError(), '另一个窗口'],
    ['AlreadyInitializedError', new AlreadyInitializedError(), '已经创建'],
    ['NotInitializedError', new NotInitializedError(), '还没有创建'],
    ['NotFoundError', new NotFoundError(), '找不到'],
    ['UnsupportedKdfError', new UnsupportedKdfError(), '不支持'],
  ])('%s 有专门的文案,不落到通用提示', (_name, error, expected) => {
    const text = describeVaultError(error);

    expect(text).toContain(expected);
    expect(text).not.toBe(GENERIC_ERROR_MESSAGE);
  });

  test('不认识的错误:只给通用提示,永远不显示 error.message', () => {
    const secretLike = 'hunter2-should-never-be-shown';

    expect(describeVaultError(new Error(secretLike))).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError(new TypeError(secretLike))).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError(secretLike)).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError({ message: secretLike })).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError(null)).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeVaultError(new DOMException(secretLike, 'QuotaExceededError'))).toBe(GENERIC_ERROR_MESSAGE);
  });

  test('VaultError 的 kind 不认识(版本不一致)时:通用提示,不显示 message', () => {
    const error = new VaultError('from-the-future' as never, secretMessage());

    const text = describeVaultError(error);

    expect(text).toBe(GENERIC_ERROR_MESSAGE);
    expect(text).not.toContain(secretMessage());
  });

  test('所有文案都是中文句子,不含英文的错误类名或 message', () => {
    const errors = [
      new CorruptError(),
      new RecoveryKeyFormatError(),
      new AuthError(),
      new WeakPasswordError(['too-short', 'too-weak']),
      new VaultLockedError(),
      new ConflictError(),
      new AlreadyInitializedError(),
      new NotInitializedError(),
      new NotFoundError(),
      new UnsupportedKdfError(),
    ];
    for (const error of errors) {
      const text = describeVaultError(error);

      expect(text).not.toContain(error.message);
      expect(text).not.toContain(error.name);
      expect(/[\u4e00-\u9fff]/.test(text)).toBe(true);
    }
  });
});

function secretMessage() {
  return 'internal-detail-should-not-leak';
}

describe('vaultReturnPath(解锁之后回到哪里)', () => {
  test.each(['/vault', '/vault/abc-123', '/vault/abc-123/edit', '/vault/settings', '/vault/new'])(
    '%s 是保险箱里的页面:原样返回',
    path => {
      expect(vaultReturnPath({ from: path })).toBe(path);
    }
  );

  test.each([
    ['没有状态', undefined],
    ['状态是 null', null],
    ['状态不是对象', 'x'],
    ['from 不是字符串', { from: 123 }],
    ['from 缺失', {}],
    ['from 是对象', { from: { pathname: '/vault' } }],
  ])('%s:回保险箱首页', (_name, state) => {
    expect(vaultReturnPath(state)).toBe('/vault');
  });

  test.each([
    '/prompts',
    '/settings',
    '/vaultevil',
    '/vault-evil/x',
    'https://evil.example/vault',
    '//evil.example/vault/x',
    'javascript:alert(1)',
    'vault/abc',
    '',
  ])('保险箱之外的路径 %s:回保险箱首页', path => {
    expect(vaultReturnPath({ from: path })).toBe('/vault');
  });

  test.each(['/vault/unlock', '/vault/setup', '/vault/recover', '/vault/unlock/x', '/vault/setup?a=1', '/vault/recover/'])(
    '不回到解锁/设置/恢复页面 %s(会形成循环)',
    path => {
      expect(vaultReturnPath({ from: path })).toBe('/vault');
    }
  );

  test('带查询参数的保险箱路径保留', () => {
    expect(vaultReturnPath({ from: '/vault/abc?tab=1' })).toBe('/vault/abc?tab=1');
  });
});

describe('describeVaultError 的"记录"语境', () => {
  test('读取一条记录时认证失败:不说"密码错误"(用户没有输入任何密码)', () => {
    const text = describeVaultError(new AuthError(), 'record');

    expect(text).toBe('这条记录无法解密，数据可能已损坏');
    expect(text).not.toContain('密码');
    expect(text).not.toContain('恢复密钥');
  });

  test('其他类别在记录语境里和默认语境一致', () => {
    expect(describeVaultError(new CorruptError(), 'record')).toBe(describeVaultError(new CorruptError()));
    expect(describeVaultError(new NotFoundError(), 'record')).toBe('找不到这条记录，可能已被删除');
    expect(describeVaultError(new VaultLockedError(), 'record')).toContain('已锁定');
    expect(describeVaultError(new Error('x'), 'record')).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe('record-types', () => {
  test('每种类型都有显示名和字段规格(新增类型时这里会提醒补齐)', () => {
    for (const type of VAULT_RECORD_TYPES) {
      expect(VAULT_TYPE_LABELS[type]).toBeTruthy();
      expect(VAULT_TYPE_FIELDS[type].secretLabel).toBeTruthy();
    }
  });

  test('只有安全笔记的秘密是多行,并且没有用户名、网址、备注', () => {
    expect(VAULT_TYPE_FIELDS.secure_note).toMatchObject({ multiline: true, notes: false });
    expect(VAULT_TYPE_FIELDS.secure_note.usernameLabel).toBeUndefined();
    expect(VAULT_TYPE_FIELDS.secure_note.urlLabel).toBeUndefined();
    for (const type of ['api_key', 'password', 'database'] as const) {
      expect(VAULT_TYPE_FIELDS[type].multiline).toBe(false);
      expect(VAULT_TYPE_FIELDS[type].notes).toBe(true);
    }
  });
});

describe('format', () => {
  test('formatDate / formatDateTime 用本地时间并补零', () => {
    const ms = new Date(2026, 0, 5, 7, 3).getTime();

    expect(formatDate(ms)).toBe('2026-01-05');
    expect(formatDateTime(ms)).toBe('2026-01-05 07:03');
  });
});

const summary = (overrides: Partial<VaultSummary> & Pick<VaultSummary, 'id'>): VaultSummary => ({
  type: 'password',
  title: overrides.id,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('filterSummaries', () => {
  const all = [
    summary({ id: 'a', title: 'OpenAI', type: 'api_key', tags: ['AI', '工作'] }),
    summary({ id: 'b', title: '银行', tags: ['个人'] }),
    summary({ id: 'c', title: 'Postgres 生产库', type: 'database' }),
    summary({ id: 'x', title: '', unreadable: true }),
  ];

  test('空搜索词(包括只有空白)返回全部,包括解不开的', () => {
    expect(filterSummaries(all, '').map(s => s.id)).toEqual(['a', 'b', 'c', 'x']);
    expect(filterSummaries(all, '   ').map(s => s.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  test('按标题搜索,大小写不敏感', () => {
    expect(filterSummaries(all, 'openai').map(s => s.id)).toEqual(['a']);
    expect(filterSummaries(all, 'POSTGRES').map(s => s.id)).toEqual(['c']);
  });

  test('按标签搜索', () => {
    expect(filterSummaries(all, '个人').map(s => s.id)).toEqual(['b']);
    expect(filterSummaries(all, 'ai').map(s => s.id)).toEqual(['a']);
  });

  test('全角和半角等价', () => {
    expect(filterSummaries(all, 'ＯＰＥＮＡＩ').map(s => s.id)).toEqual(['a']);
  });

  test('有搜索词时不显示解不开的记录;没有匹配返回空', () => {
    expect(filterSummaries(all, 'x').map(s => s.id)).not.toContain('x');
    expect(filterSummaries(all, 'no-such-thing')).toEqual([]);
  });

  test('不修改传入的数组', () => {
    const copy = [...all];

    filterSummaries(all, 'openai');

    expect(all).toEqual(copy);
  });

  test('搜索词里的正则特殊字符按字面处理', () => {
    const items = [summary({ id: 'p', title: 'a.b' }), summary({ id: 'q', title: 'axb' })];

    expect(filterSummaries(items, 'a.b').map(s => s.id)).toEqual(['p']);
    expect(filterSummaries(items, '(').map(s => s.id)).toEqual([]);
  });
});

describe('groupSummaries', () => {
  test('按类型的固定顺序分组,空组不出现', () => {
    const groups = groupSummaries([
      summary({ id: '1', type: 'secure_note' }),
      summary({ id: '2', type: 'api_key' }),
      summary({ id: '3', type: 'secure_note' }),
    ]);

    expect(groups.map(g => g.key)).toEqual(['api_key', 'secure_note']);
    expect(groups[1].items).toHaveLength(2);
  });

  test('组内按标题排序,标题相同按 id', () => {
    const groups = groupSummaries([
      summary({ id: '2', title: 'b' }),
      summary({ id: '3', title: 'a' }),
      summary({ id: '1', title: 'b' }),
    ]);

    expect(groups[0].items.map(s => s.id)).toEqual(['3', '1', '2']);
  });

  test('解不开的放在最后一组', () => {
    const groups = groupSummaries([
      summary({ id: 'bad', title: '', unreadable: true, type: 'api_key' }),
      summary({ id: 'ok', type: 'password' }),
    ]);

    expect(groups.map(g => g.key)).toEqual(['password', 'unreadable']);
    expect(groups[1].items.map(s => s.id)).toEqual(['bad']);
  });

  test('不丢记录:类型字段不认识的(库被改过)也归到"解不开"那一组', () => {
    const items = [
      summary({ id: 'weird', type: 'from-the-future' as never }),
      summary({ id: 'ok', type: 'database' }),
    ];

    const groups = groupSummaries(items);

    expect(groups.flatMap(g => g.items)).toHaveLength(items.length);
    expect(groups.find(g => g.key === 'unreadable')?.items.map(s => s.id)).toEqual(['weird']);
  });

  test('空列表没有任何分组', () => {
    expect(groupSummaries([])).toEqual([]);
  });
});

describe('editor-model', () => {
  test('parseTags:逗号、全角逗号、顿号、换行都是分隔符,去空去重(不区分大小写,保留先出现的写法)', () => {
    expect(parseTags('工作, 云服务，个人、测试\n备份')).toEqual(['工作', '云服务', '个人', '测试', '备份']);
    expect(parseTags('AI, ai, Ai ,ＡＩ')).toEqual(['AI']);
    expect(parseTags(' , ,, ')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });

  test('validateForm:标题和秘密都不能为空,秘密的提示带上这个类型的名字', () => {
    expect(validateForm(emptyForm('api_key'))).toEqual({ title: '请填写标题', secret: '请填写API Key' });
    expect(validateForm(emptyForm('secure_note'))).toEqual({ title: '请填写标题', secret: '请填写内容' });
    expect(validateForm({ ...emptyForm(), title: '   ', secret: 'x' })).toEqual({ title: '请填写标题' });
    expect(validateForm({ ...emptyForm(), title: 't', secret: 'x' })).toEqual({});
  });

  test('秘密不会被 trim:首尾的空格可能是密码的一部分;但只有空格也算有内容', () => {
    expect(validateForm({ ...emptyForm(), title: 't', secret: ' ' })).toEqual({});
    expect(toRecordInput({ ...emptyForm(), title: 't', secret: '  pw  ' }).secret).toBe('  pw  ');
  });

  test('toRecordInput:标题 trim,空的可选字段不写', () => {
    const input = toRecordInput({ ...emptyForm('password'), title: '  银行  ', secret: 'pw' });

    expect(input).toEqual({ type: 'password', title: '银行', secret: 'pw' });
  });

  test('toRecordInput:填了的字段带上,标签解析成数组', () => {
    const input = toRecordInput({
      type: 'password',
      title: 't',
      secret: 's',
      username: ' me ',
      url: ' https://example.com ',
      notes: 'line1\nline2',
      tags: '工作, 个人',
    });

    expect(input).toEqual({
      type: 'password',
      title: 't',
      secret: 's',
      username: 'me',
      url: 'https://example.com',
      notes: 'line1\nline2',
      tags: ['工作', '个人'],
    });
  });

  test('当前类型没有的字段一律丢掉(先填了用户名、又把类型改成安全笔记)', () => {
    const input = toRecordInput({
      type: 'secure_note',
      title: 't',
      secret: 'content',
      username: 'should-not-be-saved',
      url: 'https://should-not-be-saved',
      notes: 'should-not-be-saved',
      tags: '',
    });

    expect(input).toEqual({ type: 'secure_note', title: 't', secret: 'content' });
  });

  test('API Key 没有用户名字段:用户名被丢掉,网址和备注保留', () => {
    const input = toRecordInput({
      ...emptyForm('api_key'),
      title: 't',
      secret: 's',
      username: 'dropped',
      url: 'https://api.example.com',
      notes: 'kept',
    });

    expect(input.username).toBeUndefined();
    expect(input.url).toBe('https://api.example.com');
    expect(input.notes).toBe('kept');
  });

  test('只有空白的备注不写', () => {
    expect(toRecordInput({ ...emptyForm(), title: 't', secret: 's', notes: '  \n ' }).notes).toBeUndefined();
  });

  test('formFromSecret 再 toRecordInput:往返一致', () => {
    const secret: VaultSecret = {
      id: 'x',
      type: 'database',
      title: 'Prod',
      tags: ['a', 'b'],
      secret: 'pw',
      username: 'admin',
      url: 'db.example.com',
      notes: 'note',
      createdAt: 1,
      updatedAt: 2,
    };

    expect(toRecordInput(formFromSecret(secret))).toEqual({
      type: 'database',
      title: 'Prod',
      secret: 'pw',
      username: 'admin',
      url: 'db.example.com',
      notes: 'note',
      tags: ['a', 'b'],
    });
  });

  test('formFromSecret:缺省的可选字段变成空字符串,不是 undefined', () => {
    const form = formFromSecret({ id: 'x', type: 'api_key', title: 't', secret: 's', createdAt: 1, updatedAt: 1 });

    expect(form).toMatchObject({ username: '', url: '', notes: '', tags: '' });
  });
});
