/**
 * src/vault/components 下的五个组件。
 *
 * 安全相关的行为是重点:明文只在点"显示"之后才进入 DOM、Recovery Key 回填校验不能被绕过、
 * 强度评估失败或过期时不能放行、Recovery Key 不提供复制按钮。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import { PasswordStrength, PASSWORD_HINT } from '../../src/vault/components/PasswordStrength';
import { RecoveryKeyConfirm } from '../../src/vault/components/RecoveryKeyConfirm';
import { RecoveryKeyDisplay } from '../../src/vault/components/RecoveryKeyDisplay';
import { COPIED_NOTICE, SECRET_PLACEHOLDER, SecretField } from '../../src/vault/components/SecretField';
import { VaultBadge } from '../../src/vault/components/VaultBadge';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import { DEFAULT_PASSWORD_POLICY } from '../../src/vault/services/password-policy';
import { VAULT_RECORD_TYPES, type PasswordEvaluation } from '../../src/vault/types';
import { PASSWORD, createGate, createTestVault, disposeTestVaults, type TestVault } from '../helpers/vault';

const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
});

/** 在 Provider 里渲染。rerenderUi 会保持同一个 runtime */
function mount(ui: ReactElement, vault: TestVault = createTestVault()) {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  const wrap = (element: ReactElement) => <VaultRuntimeProvider runtime={runtime}>{element}</VaultRuntimeProvider>;
  const result = render(wrap(ui));
  return { ...result, vault, rerenderUi: (next: ReactElement) => result.rerender(wrap(next)) };
}

const VECTOR = 'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG4';
const GROUPS = VECTOR.split('-').slice(2);

// ---------------------------------------------------------------------------
describe('VaultBadge', () => {
  test.each([
    ['api_key', 'API Key'],
    ['password', '账号密码'],
    ['database', '数据库'],
    ['secure_note', '安全笔记'],
  ] as const)('%s 显示 %s', (type, label) => {
    render(<VaultBadge type={type} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(label).closest('[data-type]')).toHaveAttribute('data-type', type);
  });

  test('覆盖了所有记录类型(新增类型时这里会提醒补文案)', () => {
    for (const type of VAULT_RECORD_TYPES) {
      const { unmount } = render(<VaultBadge type={type} />);
      expect(screen.queryByText('未知类型')).toBeNull();
      unmount();
    }
  });

  test('库里的类型字段被改成不认识的值时,不崩溃,显示"未知类型"', () => {
    render(<VaultBadge type={'from-the-future' as never} />);

    expect(screen.getByText('未知类型')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('PasswordStrength', () => {
  const evaluation = (overrides: Partial<PasswordEvaluation> = {}): PasswordEvaluation => ({
    score: 4,
    length: 20,
    ok: true,
    issues: [],
    ...overrides,
  });

  /** 严格策略(真实的 zxcvbn),不打桩 */
  const strictVault = () => createTestVault({ passwordPolicy: DEFAULT_PASSWORD_POLICY });

  const lastReported = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as PasswordEvaluation | null | undefined;

  test('空密码:只提示最少长度,没有强度条,通知父组件"没有评估"', () => {
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password="" onEvaluated={onEvaluated} debounceMs={0} />);

    expect(screen.getByText('至少 12 个字符。')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(lastReported(onEvaluated)).toBeNull();
  });

  test('中文用户的提示一直显示(zxcvbn 对中文和拼音会高估)', async () => {
    const vault = createTestVault();
    vi.spyOn(vault.service, 'evaluatePassword').mockResolvedValue(evaluation());
    const { rerenderUi } = mount(<PasswordStrength password="" debounceMs={0} />, vault);
    expect(screen.getByText(PASSWORD_HINT)).toBeInTheDocument();
    expect(PASSWORD_HINT).toContain('长随机口令或随机词组');

    rerenderUi(<PasswordStrength password="something-long-enough" debounceMs={0} />);
    await screen.findByRole('meter');

    expect(screen.getByText(PASSWORD_HINT)).toBeInTheDocument();
  });

  test('真实策略:合格的主密码显示"强度合格",并通知父组件 ok', async () => {
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password={PASSWORD} onEvaluated={onEvaluated} debounceMs={0} />, strictVault());

    expect(await screen.findByText('强度合格。')).toBeInTheDocument();
    expect(lastReported(onEvaluated)?.ok).toBe(true);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(lastReported(onEvaluated)?.score));
  });

  test('真实策略:差 1 个字符,提示还差多少,父组件拿到 ok=false', async () => {
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password="k8#Vq2!mZp9" onEvaluated={onEvaluated} debounceMs={0} />, strictVault());

    expect(await screen.findByText('还差 1 个字符，至少需要 12 个')).toBeInTheDocument();
    expect(lastReported(onEvaluated)?.ok).toBe(false);
    expect(screen.queryByText('强度合格。')).toBeNull();
  });

  test('真实策略:够长但太弱,只提示"太容易被猜到",不提示长度', async () => {
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password="password12345678" onEvaluated={onEvaluated} debounceMs={0} />, strictVault());

    expect(await screen.findByText(/太容易被猜到/)).toBeInTheDocument();
    expect(screen.queryByText(/还差/)).toBeNull();
    expect(lastReported(onEvaluated)?.ok).toBe(false);
  });

  test('评估期间:显示"正在评估",并且告诉父组件没有可用的评估(不能沿用上一次的 ok)', async () => {
    const vault = createTestVault();
    const gate = createGate();
    vi.spyOn(vault.service, 'evaluatePassword').mockImplementation(async () => {
      await gate.wait();
      return evaluation();
    });
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password="x-long-enough-password" onEvaluated={onEvaluated} debounceMs={0} />, vault);

    expect(screen.getByText('正在评估强度…')).toBeInTheDocument();
    expect(lastReported(onEvaluated)).toBeNull();
    gate.release();
    await screen.findByText('强度合格。');
    expect(lastReported(onEvaluated)?.ok).toBe(true);
  });

  test('改了密码之后,上一个密码的 ok 立刻作废(不会在新密码评估完成前一直是 ok)', async () => {
    const vault = createTestVault();
    const gate = createGate();
    let calls = 0;
    vi.spyOn(vault.service, 'evaluatePassword').mockImplementation(async () => {
      if (++calls === 1) return evaluation();
      await gate.wait();
      return evaluation({ ok: false, score: 1, issues: ['too-weak'] });
    });
    const onEvaluated = vi.fn();
    const { rerenderUi } = mount(<PasswordStrength password="first-good-password" onEvaluated={onEvaluated} debounceMs={0} />, vault);
    await screen.findByText('强度合格。');
    expect(lastReported(onEvaluated)?.ok).toBe(true);

    rerenderUi(<PasswordStrength password="second" onEvaluated={onEvaluated} debounceMs={0} />);

    expect(lastReported(onEvaluated)).toBeNull();
    expect(screen.queryByText('强度合格。')).toBeNull();
    gate.release();
    await waitFor(() => expect(lastReported(onEvaluated)?.ok).toBe(false));
  });

  test('评估失败(估算器加载不了):按不合格处理,显示提示,绝不放行', async () => {
    const vault = createTestVault();
    vi.spyOn(vault.service, 'evaluatePassword').mockRejectedValue(new Error('chunk load failed'));
    const onEvaluated = vi.fn();

    mount(<PasswordStrength password="a-long-enough-password" onEvaluated={onEvaluated} debounceMs={0} />, vault);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法评估强度');
    expect(lastReported(onEvaluated)).toBeNull();
    expect(onEvaluated.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(document.body.textContent).not.toContain('chunk load failed'); // 不把内部错误给用户看
  });

  test('过期的评估结果被丢弃:旧密码的 ok 在新密码之后才返回,不会被报告', async () => {
    const vault = createTestVault();
    const slowGate = createGate();
    vi.spyOn(vault.service, 'evaluatePassword').mockImplementation(async password => {
      if (password === 'old-password-that-is-fine') {
        await slowGate.wait();
        return evaluation(); // 旧密码评估为合格,但太晚了
      }
      return evaluation({ ok: false, score: 0, length: 3, issues: ['too-short', 'too-weak'] });
    });
    const onEvaluated = vi.fn();
    const { rerenderUi } = mount(<PasswordStrength password="old-password-that-is-fine" onEvaluated={onEvaluated} debounceMs={0} />, vault);
    await waitFor(() => expect(vault.service.evaluatePassword).toHaveBeenCalledTimes(1));

    rerenderUi(<PasswordStrength password="new" onEvaluated={onEvaluated} debounceMs={0} />);
    await waitFor(() => expect(lastReported(onEvaluated)?.ok).toBe(false));
    await act(async () => {
      slowGate.release();
    });

    expect(lastReported(onEvaluated)?.ok).toBe(false);
    expect(onEvaluated.mock.calls.some(([value]) => value?.ok === true)).toBe(false);
    expect(screen.queryByText('强度合格。')).toBeNull();
  });

  test('密码清空:回到初始状态,并通知父组件没有评估', async () => {
    const vault = createTestVault();
    vi.spyOn(vault.service, 'evaluatePassword').mockResolvedValue(evaluation());
    const onEvaluated = vi.fn();
    const { rerenderUi } = mount(<PasswordStrength password="a-good-enough-password" onEvaluated={onEvaluated} debounceMs={0} />, vault);
    await screen.findByText('强度合格。');

    rerenderUi(<PasswordStrength password="" onEvaluated={onEvaluated} debounceMs={0} />);

    expect(lastReported(onEvaluated)).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('至少 12 个字符。')).toBeInTheDocument();
  });

  test('防抖:连续输入只评估最后一次', async () => {
    vi.useFakeTimers();
    const vault = createTestVault();
    const spy = vi.spyOn(vault.service, 'evaluatePassword').mockResolvedValue(evaluation());
    const { rerenderUi } = mount(<PasswordStrength password="a" debounceMs={300} />, vault);

    rerenderUi(<PasswordStrength password="ab" debounceMs={300} />);
    rerenderUi(<PasswordStrength password="abc" debounceMs={300} />);
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('abc');
  });

  test('父组件每次渲染都传新的回调函数,不会因此重复评估', async () => {
    const vault = createTestVault();
    const spy = vi.spyOn(vault.service, 'evaluatePassword').mockResolvedValue(evaluation());
    const { rerenderUi } = mount(<PasswordStrength password="stable-password-123" onEvaluated={() => {}} debounceMs={0} />, vault);
    await screen.findByText('强度合格。');

    rerenderUi(<PasswordStrength password="stable-password-123" onEvaluated={() => {}} debounceMs={0} />);
    rerenderUi(<PasswordStrength password="stable-password-123" onEvaluated={() => {}} debounceMs={0} />);

    // 重渲染不能让界面闪回"正在评估",也不能让强度条消失
    expect(screen.getByText('强度合格。')).toBeInTheDocument();
    expect(screen.queryByText('正在评估强度…')).toBeNull();
    // 再等一个宏任务,让任何错误地重新排队的评估有机会触发
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('卸载后,在途的评估结果不再回调父组件', async () => {
    const vault = createTestVault();
    const gate = createGate();
    vi.spyOn(vault.service, 'evaluatePassword').mockImplementation(async () => {
      await gate.wait();
      return evaluation();
    });
    const onEvaluated = vi.fn();
    const { unmount } = mount(<PasswordStrength password="some-long-password" onEvaluated={onEvaluated} debounceMs={0} />, vault);
    await waitFor(() => expect(vault.service.evaluatePassword).toHaveBeenCalled());
    const callsBefore = onEvaluated.mock.calls.length;

    unmount();
    await act(async () => {
      gate.release();
    });

    expect(onEvaluated.mock.calls.length).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
describe('RecoveryKeyDisplay', () => {
  function stubDownload() {
    const clicked: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    return clicked;
  }

  test('显示前缀和 14 组,每组旁边有序号(回填校验会说"第 N 组")', () => {
    render(<RecoveryKeyDisplay recoveryKey={VECTOR} />);

    const group = screen.getByRole('group', { name: '恢复密钥' });
    expect(group).toHaveTextContent('RN-V1');
    const cells = group.querySelectorAll('[data-group-index]');
    expect(cells).toHaveLength(14);
    cells.forEach((cell, i) => {
      expect(cell).toHaveAttribute('data-group-index', String(i + 1));
      expect(cell).toHaveTextContent(`${i + 1}${GROUPS[i]}`);
    });
  });

  test('说明这是唯一一次显示,以及丢失的后果', () => {
    render(<RecoveryKeyDisplay recoveryKey={VECTOR} />);

    expect(screen.getByText('这把恢复密钥只会显示这一次。')).toBeInTheDocument();
    expect(screen.getByText(/永久无法找回/)).toBeInTheDocument();
  });

  test('没有"复制"按钮:这把密钥不需要主密码,不能一键进剪贴板', () => {
    render(<RecoveryKeyDisplay recoveryKey={VECTOR} />);

    expect(screen.queryByRole('button', { name: /复制|copy/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1); // 只有下载
  });

  test('点下载:触发 .txt 下载,并提示保存到哪里', () => {
    const clicked = stubDownload();
    render(<RecoveryKeyDisplay recoveryKey={VECTOR} />);

    fireEvent.click(screen.getByRole('button', { name: /下载/ }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^riddle-notes-recovery-key-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(screen.getByRole('status')).toHaveTextContent('不要和加密备份放在一起');
  });

  test('下载失败:提示改为手抄,不显示"已下载"', () => {
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        throw new Error('blocked');
      }),
      revokeObjectURL: vi.fn(),
    });
    render(<RecoveryKeyDisplay recoveryKey={VECTOR} />);

    fireEvent.click(screen.getByRole('button', { name: /下载/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('抄写');
    expect(screen.queryByText(/已下载/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('RecoveryKeyConfirm', () => {
  /** 第 2、7、12 组:EAYE、B4IB、WHA5 */
  const pick = () => [1, 6, 11];
  const input = (n: number) => screen.getByLabelText(`第 ${n} 组`) as HTMLInputElement;
  const type = (n: number, value: string) => fireEvent.change(input(n), { target: { value } });
  const continueButton = () => screen.getByRole('button', { name: '继续' });

  function renderConfirm(props: Partial<ComponentProps<typeof RecoveryKeyConfirm>> = {}) {
    const onConfirmed = vi.fn();
    const result = render(<RecoveryKeyConfirm recoveryKey={VECTOR} onConfirmed={onConfirmed} pickIndexes={pick} {...props} />);
    return { onConfirmed, ...result };
  }

  test('按抽到的位置显示三个输入框,"继续"一开始是禁用的,挂载时不会自动通过', () => {
    const { onConfirmed } = renderConfirm();

    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    input(2);
    input(7);
    input(12);
    expect(continueButton()).toBeDisabled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  test('只填对两组:仍然禁用;三组都对:启用', () => {
    renderConfirm();

    type(2, 'EAYE');
    type(7, 'B4IB');
    expect(continueButton()).toBeDisabled();
    type(12, 'WHA5');

    expect(continueButton()).toBeEnabled();
  });

  test('大小写、空白、全角字符都能通过', () => {
    renderConfirm();

    type(2, ' eaye ');
    type(7, 'ｂ４ｉｂ');
    type(12, 'wha5');

    expect(continueButton()).toBeEnabled();
  });

  test('填错一组:禁用;改对之后启用', () => {
    renderConfirm();
    type(2, 'EAYE');
    type(7, 'B4IB');

    type(12, 'WHA6');
    expect(continueButton()).toBeDisabled();
    type(12, 'WHA5');

    expect(continueButton()).toBeEnabled();
  });

  test('输入里多了任何东西都不行:前后多字符、把整串 Recovery Key 粘进来', () => {
    renderConfirm();
    type(2, 'EAYE');
    type(7, 'B4IB');

    for (const extra of ['XWHA5', 'WHA5X', 'WHA5WHA5', VECTOR, 'DENB-WHA5']) {
      type(12, extra);
      expect(continueButton()).toBeDisabled();
    }
    type(12, 'WHA5');
    expect(continueButton()).toBeEnabled();
  });

  test('把整串 Recovery Key 粘进三个框:一个都不通过', () => {
    renderConfirm();

    type(2, VECTOR);
    type(7, VECTOR);
    type(12, VECTOR);

    expect(continueButton()).toBeDisabled();
  });

  test('把别的组填进来也不行(位置对应)', () => {
    renderConfirm();

    type(2, 'B4IB');
    type(7, 'EAYE');
    type(12, 'WHA5');

    expect(continueButton()).toBeDisabled();
  });

  test('点"继续"调用 onConfirmed 一次', () => {
    const { onConfirmed } = renderConfirm();
    type(2, 'EAYE');
    type(7, 'B4IB');
    type(12, 'WHA5');

    fireEvent.click(continueButton());

    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  test('没填对时点"继续"(按钮是禁用的)和按回车,都不能绕过', () => {
    const { onConfirmed } = renderConfirm();
    type(2, 'EAYE');
    type(7, 'B4IB'); // 第 12 组没填

    fireEvent.click(continueButton());
    fireEvent.keyDown(input(12), { key: 'Enter' });
    fireEvent.keyDown(input(2), { key: 'Enter' });

    expect(onConfirmed).not.toHaveBeenCalled();
  });

  test('三组都对时按回车等同于点"继续"', () => {
    const { onConfirmed } = renderConfirm();
    type(2, 'EAYE');
    type(7, 'B4IB');
    type(12, 'WHA5');

    fireEvent.keyDown(input(12), { key: 'Enter' });

    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  test('输满 4 个字符还不对才提示,输到一半不打扰', () => {
    renderConfirm();

    type(2, 'EA');
    expect(screen.queryByText(/不一致/)).toBeNull();
    expect(input(2)).toHaveAttribute('aria-invalid', 'false');

    type(2, 'EAYX');
    expect(screen.getByText('与第 2 组不一致，请再检查一遍')).toBeInTheDocument();
    expect(input(2)).toHaveAttribute('aria-invalid', 'true');

    type(2, 'EAYE');
    expect(screen.queryByText(/不一致/)).toBeNull();
  });

  test('在一个框里输入不会影响另外两个', () => {
    renderConfirm();

    type(7, 'B4IB');

    expect(input(2).value).toBe('');
    expect(input(12).value).toBe('');
  });

  test('这个组件不显示 Recovery Key:要抽查的几组不在页面里(文本和属性都没有)', () => {
    const { container } = renderConfirm();

    for (const group of ['EAYE', 'B4IB', 'WHA5']) {
      expect(container.innerHTML).not.toContain(group);
    }
    expect(container.textContent).not.toContain('RN-V1');
  });

  test('输入框关闭自动填充、拼写检查和自动大写纠正(别让浏览器记住 Recovery Key)', () => {
    renderConfirm();

    for (const n of [2, 7, 12]) {
      expect(input(n)).toHaveAttribute('autocomplete', 'off');
      expect(input(n)).toHaveAttribute('spellcheck', 'false');
    }
  });

  test('抽查位置在挂载时确定,重新渲染不会变(不能靠刷新换到自己记得的位置)', () => {
    const picks = vi.fn((total: number, count: number) => [0, 5, 13].slice(0, count));
    const { rerender } = render(<RecoveryKeyConfirm recoveryKey={VECTOR} onConfirmed={() => {}} pickIndexes={picks} />);
    const labelsBefore = screen.getAllByRole('textbox').map(el => el.id);

    rerender(<RecoveryKeyConfirm recoveryKey={VECTOR} onConfirmed={() => {}} pickIndexes={picks} />);
    rerender(<RecoveryKeyConfirm recoveryKey={VECTOR} onConfirmed={() => {}} pickIndexes={picks} />);

    expect(picks).toHaveBeenCalledTimes(1);
    expect(picks).toHaveBeenCalledWith(14, 3);
    expect(screen.getAllByRole('textbox').map(el => el.id)).toEqual(labelsBefore);
  });

  test('不传 pickIndexes 时用随机抽取:3 个不同的位置,在 1–14 之内', () => {
    render(<RecoveryKeyConfirm recoveryKey={VECTOR} onConfirmed={() => {}} />);

    const numbers = screen.getAllByRole('textbox').map(el => Number(el.id.replace('recovery-confirm-', '')));
    expect(numbers).toHaveLength(3);
    expect(new Set(numbers).size).toBe(3);
    expect(numbers.every(n => n >= 1 && n <= 14)).toBe(true);
  });

  test('"返回查看"只有传了 onBack 才出现,点击调用它', () => {
    const { unmount } = renderConfirm();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    unmount();

    const onBack = vi.fn();
    renderConfirm({ onBack });
    fireEvent.click(screen.getByRole('button', { name: /返回/ }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('SecretField', () => {
  const SECRET = 'sk-live-ABCDEF123456-plaintext-marker';

  function stubClipboard(writeText: (text: string) => Promise<void> = async () => {}) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
    return spy;
  }

  test('默认隐藏:显示固定占位,明文不在页面里(文本和属性都没有)', () => {
    const { container } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  test('占位长度固定,看不出秘密有多长', () => {
    const short = render(<SecretField label="密钥" value="a" resetKey="r1" />);
    const shortText = short.container.textContent;
    short.unmount();
    const long = render(<SecretField label="密钥" value={'x'.repeat(500)} resetKey="r1" />);

    expect(long.container.textContent).toBe(shortText);
  });

  test('不是 <input>:明文不会进入输入框的 value', () => {
    const { container } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));

    expect(container.querySelector('input, textarea')).toBeNull();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  test('点"显示"才出现明文;点"隐藏"之后明文立刻从页面消失', () => {
    const { container } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.queryByText(SECRET_PLACEHOLDER)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '隐藏密钥' }));
    expect(container.innerHTML).not.toContain(SECRET);
    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
  });

  test('换一条记录(resetKey 变了):立刻回到隐藏,同一次渲染里就看不到新记录的明文', () => {
    const { rerender, container } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));
    expect(screen.getByText(SECRET)).toBeInTheDocument();

    rerender(<SecretField label="密钥" value="another-secret-value" resetKey="r2" />);

    expect(container.innerHTML).not.toContain('another-secret-value');
    expect(container.innerHTML).not.toContain(SECRET);
    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
  });

  test('同一条记录重新渲染(值不变):保持显示状态', () => {
    const { rerender } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));

    rerender(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  test('切换后再切回原来那条:不会自动变回显示', () => {
    const { rerender } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));

    rerender(<SecretField label="密钥" value="other" resetKey="r2" />);
    rerender(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText(SECRET_PLACEHOLDER)).toBeInTheDocument();
  });

  test('隐藏状态下复制:写入的是真实的秘密,并且不会因此显示出来', async () => {
    const writeText = stubClipboard();
    const { container } = render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制密钥' }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(container.innerHTML).not.toContain(SECRET);
  });

  test('复制成功:提示"请注意及时清除剪贴板",几秒后自动消失', async () => {
    vi.useFakeTimers();
    stubClipboard();
    render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制密钥' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent(COPIED_NOTICE);
    expect(COPIED_NOTICE).toBe('已复制，请注意及时清除剪贴板');

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole('status')).toBeNull();
  });

  test('复制失败(剪贴板被拒绝):提示失败,不显示"已复制"', async () => {
    stubClipboard(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制密钥' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('复制失败');
    expect(screen.queryByText(COPIED_NOTICE)).toBeNull();
  });

  test('浏览器没有 clipboard 对象:同样提示失败,不抛错', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<SecretField label="密钥" value={SECRET} resetKey="r1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制密钥' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('复制失败');
  });

  test('按钮的名字带上字段名,一个页面里有多个 SecretField 时能区分', () => {
    render(
      <>
        <SecretField label="密码" value="a" resetKey="r1" />
        <SecretField label="API Key" value="b" resetKey="r1" />
      </>
    );

    expect(screen.getByRole('button', { name: '显示密码' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示API Key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制密码' })).toBeInTheDocument();
  });

  test('多行内容(安全笔记)显示时保留换行', () => {
    render(<SecretField label="内容" value={'line one\nline two'} resetKey="r1" />);
    fireEvent.click(screen.getByRole('button', { name: '显示内容' }));

    const shown = screen.getByText(/line one/);
    expect(shown.textContent).toBe('line one\nline two');
    expect(shown.className).toContain('whitespace-pre-wrap');
  });
});
