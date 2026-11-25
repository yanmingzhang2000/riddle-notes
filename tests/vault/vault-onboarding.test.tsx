/**
 * 创建保险箱、解锁、用恢复密钥找回访问 三组页面。
 *
 * 用真实的 VaultService 和内存里的 IndexedDB 走完整流程,只在制造失败场景时打桩。
 * 重点是安全相关的行为:回填确认之前库里什么都没有、取消和离开不留下半个保险箱、
 * 错误文案符合 §5.3 且不泄露输入、不用 <form>、自动填充属性、弱密码和不一致被拦住。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AlreadyInitializedError, AuthError, WeakPasswordError } from '../../src/vault/crypto/errors';
import { generateRecoveryKey } from '../../src/vault/crypto/recovery-key';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import VaultRecover from '../../src/vault/pages/VaultRecover';
import VaultSetup from '../../src/vault/pages/VaultSetup';
import VaultUnlock from '../../src/vault/pages/VaultUnlock';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import { DEFAULT_PASSWORD_POLICY } from '../../src/vault/services/password-policy';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  snapshotVault,
  tamperKeys,
  type TestVault,
} from '../helpers/vault';

vi.setConfig({ testTimeout: 20_000 });

const NEW_PASSWORD = 'a brand new passphrase 2026';
const WEAK_PASSWORD = 'password12345678'; // 够长,但 zxcvbn 得分太低
const STRENGTH_TIMEOUT = { timeout: 8000 };

const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
  localStorage.clear();
  sessionStorage.clear();
});

/** 严格策略(真实的 zxcvbn):页面测试要看到真实的"合格/不合格" */
const strict = { passwordPolicy: DEFAULT_PASSWORD_POLICY };

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}
const where = () => screen.getByTestId('where').textContent;
/** 没有被带去任何"其他页面"(那些页面都渲染 Where) */
const notNavigated = () => screen.queryByTestId('where') === null;

type Entry = string | { pathname: string; state?: unknown };

function mountApp(vault: TestVault, entry: Entry) {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  const result = render(
    <VaultRuntimeProvider runtime={runtime}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/vault/setup" element={<VaultSetup />} />
          <Route path="/vault/unlock" element={<VaultUnlock />} />
          <Route path="/vault/recover" element={<VaultRecover />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </VaultRuntimeProvider>
  );
  return { runtime, ...result };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** 从"显示恢复密钥"那一屏读出 Recovery Key */
function displayedKey(): string {
  const cells = Array.from(document.querySelectorAll('[data-group-index]'));
  expect(cells).toHaveLength(14);
  return `RN-V1-${cells.map(cell => cell.lastElementChild!.textContent).join('-')}`;
}

/** 在"回填确认"那一屏按要求的位置填入正确的组 */
function fillConfirm(key: string) {
  const groups = key.split('-').slice(2);
  for (const input of screen.getAllByRole('textbox')) {
    const position = Number(input.id.replace('recovery-confirm-', ''));
    fireEvent.change(input, { target: { value: groups[position - 1] } });
  }
}

// ===========================================================================
describe('VaultSetup 创建保险箱', () => {
  /** 走到第 2 步并填好合格的主密码 */
  async function reachPasswordStep(vault: TestVault) {
    mountApp(vault, '/vault/setup');
    await screen.findByText('先了解几件事');
    click('我知道了，开始设置');
    type('主密码', PASSWORD);
    type('再输入一次', PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled(), STRENGTH_TIMEOUT);
  }

  test('第 1 步:说明主密码无法找回、恢复密钥只显示一次、两者都丢失的后果', async () => {
    mountApp(createTestVault(strict), '/vault/setup');

    expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
    expect(screen.getByText(/忘记之后无法找回/)).toBeInTheDocument();
    expect(screen.getByText(/只显示一次/)).toBeInTheDocument();
    expect(screen.getByText(/永久无法找回/)).toBeInTheDocument();
    expect(screen.queryByLabelText('主密码')).toBeNull();
  });

  test('第 2 步的输入框:type=password,autocomplete=new-password,页面里没有 <form>', async () => {
    const { container } = mountApp(createTestVault(strict), '/vault/setup');
    await screen.findByText('先了解几件事');
    expect(container.querySelector('form')).toBeNull();

    click('我知道了，开始设置');

    for (const label of ['主密码', '再输入一次']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveAttribute('autocomplete', 'new-password');
    }
    expect(container.querySelector('form')).toBeNull();
  });

  test('"下一步"一开始是禁用的', async () => {
    mountApp(createTestVault(strict), '/vault/setup');
    await screen.findByText('先了解几件事');
    click('我知道了，开始设置');

    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  test('两次输入不一致:提示并且不能继续,即使密码本身合格', async () => {
    const vault = createTestVault(strict);
    const initialize = vi.spyOn(vault.service, 'initialize');
    mountApp(vault, '/vault/setup');
    await screen.findByText('先了解几件事');
    click('我知道了，开始设置');

    type('主密码', PASSWORD);
    type('再输入一次', `${PASSWORD}x`);
    await screen.findByText('强度合格。', {}, STRENGTH_TIMEOUT);

    expect(screen.getByText('两次输入不一致')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('再输入一次'), { key: 'Enter' });
    await act(async () => {});
    expect(initialize).not.toHaveBeenCalled();
  });

  test('弱密码:不能继续,按钮和回车都不行,服务层的 initialize 根本没被调用', async () => {
    const vault = createTestVault(strict);
    const initialize = vi.spyOn(vault.service, 'initialize');
    mountApp(vault, '/vault/setup');
    await screen.findByText('先了解几件事');
    click('我知道了，开始设置');

    type('主密码', WEAK_PASSWORD);
    type('再输入一次', WEAK_PASSWORD);
    await screen.findByText(/太容易被猜到/, {}, STRENGTH_TIMEOUT);

    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('再输入一次'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    await act(async () => {});
    expect(initialize).not.toHaveBeenCalled();
    expect(await vault.service.isInitialized()).toBe(false);
  });

  test('正在生成恢复密钥时再触发(对已禁用的输入框派发回车):不会重复调用,也不会闪出假错误', async () => {
    const vault = createTestVault(strict);
    const gate = createGate();
    const real = vault.service.initialize.bind(vault.service);
    const initialize = vi.spyOn(vault.service, 'initialize').mockImplementation(async (password, callback) => {
      await gate.wait(); // KDF 还在跑
      return real(password, callback);
    });
    await reachPasswordStep(vault);

    click('下一步');
    await screen.findByRole('button', { name: '正在生成恢复密钥…' });
    expect(screen.getByLabelText('再输入一次')).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('再输入一次'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    await act(async () => {});

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    gate.release();
    await screen.findByText('保存你的恢复密钥');
  });

  test('完整流程:确认之前库里什么都没有,确认之后才创建,Recovery Key 和主密码都能解锁', async () => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);

    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    const key = displayedKey();
    expect(key).toMatch(/^RN-V1-([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
    expect(await vault.service.isInitialized()).toBe(false); // 第 3 步:还没有写库
    expect(vault.session.isOpen()).toBe(false);

    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');
    expect(await vault.service.isInitialized()).toBe(false); // 第 4 步:还没有写库

    fillConfirm(key);
    click('继续');
    await waitFor(() => expect(where()).toBe('/vault'));
    expect(await vault.service.isInitialized()).toBe(true);
    expect(vault.session.isOpen()).toBe(true);

    vault.session.lock();
    await vault.service.unlockWithMasterPassword(PASSWORD);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(key); // 用户看到的就是真正生效的那一把
  });

  test('第 4 步不再显示恢复密钥(否则"回填"只是照抄)', async () => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    const key = displayedKey();
    const groups = key.split('-').slice(2);

    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');

    expect(document.querySelector('[data-group-index]')).toBeNull();
    expect(screen.queryByRole('group', { name: '恢复密钥' })).toBeNull();
    expect(document.body.textContent).not.toContain(key);
    // 页面上只可能出现 3 组要抽查的位置的标签,不出现任何一组的内容
    for (const group of groups) expect(document.body.innerHTML).not.toContain(`>${group}<`);
  });

  test('第 4 步回填不对:"继续"保持禁用,库里仍然没有保险箱', async () => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');

    for (const input of screen.getAllByRole('textbox')) fireEvent.change(input, { target: { value: 'ZZZZ' } });
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' });
    await act(async () => {});

    expect(screen.getByRole('button', { name: '继续' })).toBeDisabled();
    expect(await vault.service.isInitialized()).toBe(false);
    expect(notNavigated()).toBe(true);
  });

  test('从第 4 步返回第 3 步:恢复密钥没有变', async () => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    const key = displayedKey();
    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');

    click('返回查看恢复密钥');

    await screen.findByText('保存你的恢复密钥');
    expect(displayedKey()).toBe(key);
  });

  test.each([
    ['第 3 步', 0],
    ['第 4 步', 1],
  ])('在%s点"取消创建":回到第 2 步,没有创建保险箱,恢复密钥从页面上消失,再来会是一把新的', async (_name, extraSteps) => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    const firstKey = displayedKey();
    if (extraSteps === 1) {
      click('我已保存，下一步');
      await screen.findByText('确认你保存了恢复密钥');
    }

    click('取消创建');

    expect(await screen.findByText('已取消，没有创建保险箱。')).toBeInTheDocument();
    expect(await vault.service.isInitialized()).toBe(false);
    expect(vault.session.isOpen()).toBe(false);
    expect(document.body.textContent).not.toContain(firstKey);
    expect(document.querySelector('[data-group-index]')).toBeNull();

    // 主密码还留在输入框里,可以直接再来。强度指示器是重新挂载的,要等它重新评估完,按钮才会恢复可用
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled(), STRENGTH_TIMEOUT);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    expect(displayedKey()).not.toBe(firstKey);
  });

  test('离开页面(卸载):服务层的 initialize 被取消,什么都没写', async () => {
    const vault = createTestVault(strict);
    const real = vault.service.initialize.bind(vault.service);
    let call!: Promise<void>;
    vi.spyOn(vault.service, 'initialize').mockImplementation((password, callback) => {
      call = real(password, callback);
      call.catch(() => {});
      return call;
    });
    mountApp(vault, '/vault/setup');
    await screen.findByText('先了解几件事');
    click('我知道了，开始设置');
    type('主密码', PASSWORD);
    type('再输入一次', PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled(), STRENGTH_TIMEOUT);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');

    cleanup(); // 用户离开

    await expect(call).rejects.toBeTruthy();
    expect(await vault.service.isInitialized()).toBe(false);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('确认之后创建失败(服务层抛错):回到第 2 步,显示错误,恢复密钥不再显示', async () => {
    const vault = createTestVault(strict);
    vi.spyOn(vault.service, 'initialize').mockImplementation(async (_password, callback) => {
      await callback('RN-V1-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-MZUH');
      throw new AlreadyInitializedError();
    });
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');
    fillConfirm('RN-V1-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-MZUH');
    click('继续');

    expect(await screen.findByRole('alert')).toHaveTextContent('保险箱已经创建，请直接解锁');
    expect(document.querySelector('[data-group-index]')).toBeNull();
    expect(document.body.textContent).not.toContain('MZUH');
  });

  test('创建时发现别的窗口已经创建了:重新读取状态(而不是继续停在创建页)', async () => {
    const vault = createTestVault(strict);
    vi.spyOn(vault.service, 'initialize').mockRejectedValue(new AlreadyInitializedError());
    const isInitialized = vi.spyOn(vault.service, 'isInitialized');
    await reachPasswordStep(vault);
    const callsBefore = isInitialized.mock.calls.length;

    click('下一步');
    await screen.findByRole('alert');

    await waitFor(() => expect(isInitialized.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  test('服务层拒绝了主密码(例如策略比界面更严):显示按类别选的文案,不回显密码', async () => {
    const vault = createTestVault(strict);
    vi.spyOn(vault.service, 'initialize').mockRejectedValue(new WeakPasswordError(['too-weak']));
    const isInitialized = vi.spyOn(vault.service, 'isInitialized');
    await reachPasswordStep(vault);
    const callsBefore = isInitialized.mock.calls.length;

    click('下一步');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('太容易被猜到');
    expect(document.body.textContent).not.toContain(PASSWORD);
    // 这类失败不需要重新读状态:重读会让页面闪成"正在检查…"把错误提示挤掉
    await act(async () => {});
    expect(isInitialized.mock.calls.length).toBe(callsBefore);
    expect(screen.queryByText('正在检查…')).toBeNull();
  });

  test('已经创建过、已锁定:跳转到解锁页', async () => {
    const vault = await createInitializedVault(strict);
    vault.session.lock();

    mountApp(vault, '/vault/setup');

    expect(await screen.findByRole('heading', { name: '解锁保险箱' })).toBeInTheDocument();
  });

  test('已经创建过、已解锁:直接进保险箱', async () => {
    const vault = await createInitializedVault(strict);

    mountApp(vault, '/vault/setup');

    await waitFor(() => expect(where()).toBe('/vault'));
  });

  test('读库失败:提示并提供重试,不当成"需要创建"', async () => {
    const vault = createTestVault(strict);
    const isInitialized = vi
      .spyOn(vault.service, 'isInitialized')
      .mockRejectedValueOnce(new Error('db unavailable'));
    mountApp(vault, '/vault/setup');

    expect(await screen.findByRole('alert')).toHaveTextContent('读取保险箱状态失败');
    expect(screen.queryByText('先了解几件事')).toBeNull();
    click('重试');

    expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
    expect(isInitialized).toHaveBeenCalledTimes(2);
  });

  test('创建成功之后,主密码和恢复密钥没有留在页面、localStorage 或 sessionStorage 里', async () => {
    const vault = createTestVault(strict);
    await reachPasswordStep(vault);
    click('下一步');
    await screen.findByText('保存你的恢复密钥');
    const key = displayedKey();
    click('我已保存，下一步');
    await screen.findByText('确认你保存了恢复密钥');
    fillConfirm(key);
    click('继续');
    await waitFor(() => expect(where()).toBe('/vault'));

    const everywhere = [
      document.body.innerHTML,
      JSON.stringify({ ...localStorage }),
      JSON.stringify({ ...sessionStorage }),
    ].join('\n');
    expect(everywhere).not.toContain(PASSWORD);
    expect(everywhere).not.toContain(key);
  });
});

// ===========================================================================
describe('VaultUnlock 解锁', () => {
  async function lockedVault() {
    const vault = await createInitializedVault(strict);
    vault.session.lock();
    return vault;
  }

  test('输入框:type=password,autocomplete=off,没有 <form>,有"使用恢复密钥"的入口', async () => {
    const { container } = mountApp(await lockedVault(), '/vault/unlock');

    const input = await screen.findByLabelText('主密码');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByRole('link', { name: '使用恢复密钥' })).toHaveAttribute('href', '/vault/recover');
  });

  test('空密码:"解锁"是禁用的,回车也不会调用服务层', async () => {
    const vault = await lockedVault();
    const unlock = vi.spyOn(vault.service, 'unlockWithMasterPassword');
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');

    expect(screen.getByRole('button', { name: '解锁' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    await act(async () => {});

    expect(unlock).not.toHaveBeenCalled();
  });

  test('正确的主密码:会话打开,进入保险箱,密码输入框不再存在', async () => {
    const vault = await lockedVault();
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');

    type('主密码', PASSWORD);
    click('解锁');

    await waitFor(() => expect(where()).toBe('/vault'));
    expect(vault.session.isOpen()).toBe(true);
    expect(screen.queryByLabelText('主密码')).toBeNull();
  });

  test('回车等同于点"解锁"', async () => {
    const vault = await lockedVault();
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');

    type('主密码', PASSWORD);
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });

    await waitFor(() => expect(vault.session.isOpen()).toBe(true));
  });

  test('错误的主密码:§5.3 的认证失败文案,仍然锁着,不回显密码,可以再试', async () => {
    const vault = await lockedVault();
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');

    type('主密码', 'definitely the wrong password');
    click('解锁');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('密码错误，或数据已损坏。可尝试使用恢复密钥');
    expect(vault.session.isOpen()).toBe(false);
    expect(document.body.textContent).not.toContain('definitely the wrong password');
    expect(screen.getByLabelText('主密码')).toBeEnabled();
    expect(notNavigated()).toBe(true);

    type('主密码', PASSWORD);
    click('解锁');
    await waitFor(() => expect(vault.session.isOpen()).toBe(true));
  });

  test('库的结构损坏:§5.3 的结构损坏文案(可导出原始加密备份)', async () => {
    const vault = await lockedVault();
    await tamperKeys(vault.db, keys => {
      (keys as unknown as { wrapper: unknown }).wrapper = undefined;
    });
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');

    type('主密码', PASSWORD);
    click('解锁');

    expect(await screen.findByRole('alert')).toHaveTextContent('保险箱数据已损坏，可导出原始加密备份');
  });

  test('解锁进行中:重复点击和回车只会触发一次,按钮显示进行中', async () => {
    const vault = await lockedVault();
    const gate = createGate();
    const real = vault.service.unlockWithMasterPassword.bind(vault.service);
    const unlock = vi.spyOn(vault.service, 'unlockWithMasterPassword').mockImplementation(async password => {
      await gate.wait();
      return real(password);
    });
    mountApp(vault, '/vault/unlock');
    await screen.findByLabelText('主密码');
    type('主密码', PASSWORD);

    click('解锁');
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    await screen.findByRole('button', { name: '正在解锁…' });

    expect(screen.getByRole('button', { name: '正在解锁…' })).toBeDisabled();
    expect(screen.getByLabelText('主密码')).toBeDisabled();
    expect(unlock).toHaveBeenCalledTimes(1);
    gate.release();
    await waitFor(() => expect(vault.session.isOpen()).toBe(true));
  });

  test('从保险箱里某个页面被踢过来:解锁之后回到那个页面', async () => {
    const vault = await lockedVault();
    mountApp(vault, { pathname: '/vault/unlock', state: { from: '/vault/some-record-id' } });
    await screen.findByLabelText('主密码');

    type('主密码', PASSWORD);
    click('解锁');

    await waitFor(() => expect(where()).toBe('/vault/some-record-id'));
  });

  test.each(['https://evil.example/', '//evil.example/vault/x', '/prompts', '/vault/unlock', '/vaultevil'])(
    '返回路径 %s 不被接受:解锁之后去保险箱首页',
    async from => {
      const vault = await lockedVault();
      mountApp(vault, { pathname: '/vault/unlock', state: { from } });
      await screen.findByLabelText('主密码');

      type('主密码', PASSWORD);
      click('解锁');

      await waitFor(() => expect(where()).toBe('/vault'));
    }
  );

  test('还没有创建保险箱:跳转到创建页', async () => {
    mountApp(createTestVault(strict), '/vault/unlock');

    expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
  });

  test('会话已经打开:直接进保险箱', async () => {
    mountApp(await createInitializedVault(strict), '/vault/unlock');

    await waitFor(() => expect(where()).toBe('/vault'));
  });

  test('读库失败:提示并提供重试,不显示密码输入框', async () => {
    const vault = await lockedVault();
    vi.spyOn(vault.service, 'isInitialized').mockRejectedValueOnce(new Error('db unavailable'));
    mountApp(vault, '/vault/unlock');

    expect(await screen.findByRole('alert')).toHaveTextContent('读取保险箱失败');
    expect(screen.queryByLabelText('主密码')).toBeNull();
    click('重试');

    expect(await screen.findByLabelText('主密码')).toBeInTheDocument();
  });
});

// ===========================================================================
describe('VaultRecover 用恢复密钥找回访问', () => {
  async function lockedVault() {
    const vault = await createInitializedVault(strict);
    vault.session.lock();
    return vault;
  }

  /** 在第一屏填好并提交,停在第二屏 */
  async function recoverAccess(vault: TestVault & { recoveryKey: string }) {
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    type('恢复密钥', vault.recoveryKey);
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled(), STRENGTH_TIMEOUT);
    click('找回访问');
    await screen.findByRole('heading', { name: '重新生成恢复密钥' });
  }

  test('第一屏的输入框属性:恢复密钥 autocomplete=off,密码 new-password,没有 <form>', async () => {
    const { container } = mountApp(await lockedVault(), '/vault/recover');

    expect(await screen.findByLabelText('恢复密钥')).toHaveAttribute('autocomplete', 'off');
    for (const label of ['新的主密码', '再输入一次']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password');
      expect(screen.getByLabelText(label)).toHaveAttribute('autocomplete', 'new-password');
    }
    expect(container.querySelector('form')).toBeNull();
  });

  test('缺任何一项或弱密码或不一致:"找回访问"保持禁用,服务层没有被调用', async () => {
    const vault = await lockedVault();
    const recover = vi.spyOn(vault.service, 'recoverAccess');
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    const button = () => screen.getByRole('button', { name: '找回访问' });
    expect(button()).toBeDisabled();

    // 没有恢复密钥
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await screen.findByText('强度合格。', {}, STRENGTH_TIMEOUT);
    expect(button()).toBeDisabled();

    // 有恢复密钥,但两次输入不一致
    type('恢复密钥', vault.recoveryKey);
    type('再输入一次', `${NEW_PASSWORD}!`);
    expect(screen.getByText('两次输入不一致')).toBeInTheDocument();
    expect(button()).toBeDisabled();

    // 一致,但是弱密码
    type('新的主密码', WEAK_PASSWORD);
    type('再输入一次', WEAK_PASSWORD);
    await screen.findByText(/太容易被猜到/, {}, STRENGTH_TIMEOUT);
    expect(button()).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('恢复密钥'), { key: 'Enter' });
    await act(async () => {});

    expect(recover).not.toHaveBeenCalled();
  });

  test.each([
    ['格式不对', 'this is not a recovery key'],
    ['校验和不对(输错一个字符)', 'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG5'],
  ])('恢复密钥%s:§5.3 的输入有误文案,库不变,仍然锁着', async (_name, badKey) => {
    const vault = await lockedVault();
    const before = await snapshotVault(vault.db);
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    type('恢复密钥', badKey);
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled(), STRENGTH_TIMEOUT);

    click('找回访问');

    expect(await screen.findByRole('alert')).toHaveTextContent('恢复密钥输入有误，请检查');
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(vault.session.isOpen()).toBe(false);
  });

  test('格式正确但不是这个保险箱的恢复密钥:认证失败文案(恢复密钥的措辞),库不变', async () => {
    const vault = await lockedVault();
    const before = await snapshotVault(vault.db);
    const { formatted: otherKey } = await generateRecoveryKey();
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    type('恢复密钥', otherKey);
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled(), STRENGTH_TIMEOUT);

    click('找回访问');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('恢复密钥不正确，或数据已损坏');
    expect(alert).not.toHaveTextContent('可尝试使用恢复密钥'); // 本来就在输入恢复密钥,不再建议"使用恢复密钥"
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(document.body.textContent).not.toContain(otherKey);
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);
  });

  test('第一步成功:新主密码立即生效,会话打开,停在第二屏(没有被自动带去保险箱)', async () => {
    const vault = await lockedVault();

    await recoverAccess(vault);

    expect(vault.session.isOpen()).toBe(true);
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
    expect(screen.getByText('已找回访问，新的主密码已经生效。')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    // 第一屏的输入已经不在页面上
    expect(screen.queryByLabelText('恢复密钥')).toBeNull();
    expect(document.body.textContent).not.toContain(vault.recoveryKey);
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);

    vault.session.lock();
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
  });

  test('第二屏"稍后再说":进入保险箱,旧的恢复密钥仍然有效,仍然标记需要重新生成', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);

    click('稍后再说');

    await waitFor(() => expect(where()).toBe('/vault'));
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test('第二屏完整重新生成:新 Key 生效,旧 Key 作废,标记清除', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);

    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
    const newKey = displayedKey();
    expect(newKey).not.toBe(vault.recoveryKey);
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true); // 显示 Key 时还没有写库
    click('我已保存，下一步');
    fillConfirm(newKey);
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true); // 回填通过之前仍然没有写库
    click('继续');

    expect(await screen.findByText('新的恢复密钥已经生效。')).toBeInTheDocument();
    click('完成');
    await waitFor(() => expect(where()).toBe('/vault'));
    expect(await vault.service.isRecoveryRotationRequired()).toBe(false);
    vault.session.lock();
    await expect(vault.service.unlockWithRecoveryKey(vault.recoveryKey)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithRecoveryKey(newKey);
  });

  test('第二屏的主密码输入框:type=password,autocomplete=off,没有 <form>;空主密码时按钮禁用,回车不会提交', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);
    const rotate = vi.spyOn(vault.service, 'rotateRecoveryKey');
    const input = screen.getByLabelText('主密码');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: '生成新的恢复密钥' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});

    expect(rotate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('第二屏生成新 Key 进行中:再触发(对已禁用的输入框派发回车)不会重复调用,也不会闪出假错误', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);
    const gate = createGate();
    const real = vault.service.rotateRecoveryKey.bind(vault.service);
    const rotate = vi.spyOn(vault.service, 'rotateRecoveryKey').mockImplementation(async (password, callback) => {
      await gate.wait();
      return real(password, callback);
    });
    type('主密码', NEW_PASSWORD);

    click('生成新的恢复密钥');
    await screen.findByRole('button', { name: '正在生成…' });
    expect(screen.getByLabelText('主密码')).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('主密码'), { key: 'Enter' });
    await act(async () => {});

    expect(rotate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    gate.release();
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
  });

  test('第一屏失败之后可以改正并重试(不会卡在"正在找回…")', async () => {
    const vault = await lockedVault();
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    type('恢复密钥', 'not a recovery key');
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled(), STRENGTH_TIMEOUT);
    click('找回访问');
    await screen.findByRole('alert');

    expect(screen.getByLabelText('恢复密钥')).toBeEnabled();
    expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled();
    type('恢复密钥', vault.recoveryKey);
    click('找回访问');

    await screen.findByRole('heading', { name: '重新生成恢复密钥' });
    expect(vault.session.isOpen()).toBe(true);
  });

  test('第二屏主密码不对:认证失败文案,不显示新的 Key,库不变', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);
    const before = await snapshotVault(vault.db);

    type('主密码', 'not the master password');
    click('生成新的恢复密钥');

    expect(await screen.findByRole('alert')).toHaveTextContent('密码错误，或数据已损坏');
    expect(document.querySelector('[data-group-index]')).toBeNull();
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  test('第二屏在显示新 Key 之后取消:旧 Key 仍然有效,库不变,新 Key 不留在页面上', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);
    const before = await snapshotVault(vault.db);
    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
    const newKey = displayedKey();

    click('取消');

    expect(await screen.findByText('已取消。旧的恢复密钥仍然有效。')).toBeInTheDocument();
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(document.body.textContent).not.toContain(newKey);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test('第二屏在回填确认那一步:不显示 Key;回填不对不能继续', async () => {
    const vault = await lockedVault();
    await recoverAccess(vault);
    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
    const newKey = displayedKey();
    click('我已保存，下一步');

    expect(document.querySelector('[data-group-index]')).toBeNull();
    expect(document.body.textContent).not.toContain(newKey);
    expect(screen.getByRole('button', { name: '继续' })).toBeDisabled();
  });

  test('还没有创建保险箱:跳转到创建页;会话已打开:直接进保险箱', async () => {
    const { unmount } = mountApp(createTestVault(strict), '/vault/recover');
    expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
    unmount();

    mountApp(await createInitializedVault(strict), '/vault/recover');
    await waitFor(() => expect(where()).toBe('/vault'));
  });

  test('读库失败:提示并提供重试', async () => {
    const vault = await lockedVault();
    vi.spyOn(vault.service, 'isInitialized').mockRejectedValueOnce(new Error('db unavailable'));
    mountApp(vault, '/vault/recover');

    expect(await screen.findByRole('alert')).toHaveTextContent('读取保险箱失败');
    click('重试');

    expect(await screen.findByLabelText('恢复密钥')).toBeInTheDocument();
  });

  test('提交进行中:输入框和按钮都禁用,不会重复提交', async () => {
    const vault = await lockedVault();
    const gate = createGate();
    const real = vault.service.recoverAccess.bind(vault.service);
    const recover = vi.spyOn(vault.service, 'recoverAccess').mockImplementation(async (key, password) => {
      await gate.wait();
      return real(key, password);
    });
    mountApp(vault, '/vault/recover');
    await screen.findByLabelText('恢复密钥');
    type('恢复密钥', vault.recoveryKey);
    type('新的主密码', NEW_PASSWORD);
    type('再输入一次', NEW_PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '找回访问' })).toBeEnabled(), STRENGTH_TIMEOUT);

    click('找回访问');
    fireEvent.keyDown(screen.getByLabelText('再输入一次'), { key: 'Enter' });
    await screen.findByRole('button', { name: '正在找回…' });

    expect(screen.getByLabelText('恢复密钥')).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在找回…' })).toBeDisabled();
    expect(recover).toHaveBeenCalledTimes(1);
    gate.release();
    await screen.findByRole('heading', { name: '重新生成恢复密钥' });
  });
});
