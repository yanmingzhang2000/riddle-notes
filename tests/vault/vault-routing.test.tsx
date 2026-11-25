/**
 * 路由与守卫(技术方案 §6.3)。
 *
 * 用真实的 vaultRoutes 和真实的页面。重点:
 *   - setup / unlock / recover 在守卫外面,不会死循环;
 *   - 加载中、读库失败时不跳去"创建保险箱"(否则老用户会被带去给自己的保险箱设第二个主密码);
 *   - 锁定时整个页面被卸载:编辑页里输入到一半的秘密、详情页已展开的明文、搜索词,都不会留在屏幕上或带到下一个会话;
 *   - 就算锁定和重新解锁发生在同一次渲染之间(状态始终是 unlocked),页面也会被重建。
 */
import { StrictMode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import { vaultRoutes } from '../../src/vault/routes';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  type TestVault,
} from '../helpers/vault';

vi.setConfig({ testTimeout: 20_000 });

const NEW_PASSWORD = 'a brand new passphrase 2026';
const SECRET_MARK = 'typed-secret-plaintext-marker-9';

const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
});

function Probe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}
const loc = () => screen.getByTestId('loc').textContent;

type Entry = string | { pathname: string; state?: unknown };

function mountApp(vault: TestVault, entry: Entry, options: { strict?: boolean } = {}) {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  const tree = (
    <VaultRuntimeProvider runtime={runtime}>
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route path="/prompts" element={<div>notes page</div>} />
          {vaultRoutes}
        </Routes>
      </MemoryRouter>
    </VaultRuntimeProvider>
  );
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { runtime, ...result };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** 页面上任何输入框或文本域的当前值里,有没有这段内容 */
const someFieldHolds = (text: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).some(el =>
    el.value.includes(text)
  );

async function lockedVault() {
  const vault = await createInitializedVault();
  vault.session.lock();
  return vault;
}

async function unlockOnPage() {
  await screen.findByLabelText('主密码');
  type('主密码', PASSWORD);
  click('解锁');
}

// ===========================================================================
describe('路由分流', () => {
  test.each(['/vault', '/vault/some-id', '/vault/settings', '/vault/new'])(
    '还没有创建保险箱:%s 被带去创建页',
    async entry => {
      mountApp(createTestVault(), entry);

      expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
      expect(loc()).toBe('/vault/setup');
    }
  );

  test.each(['/vault', '/vault/settings', '/vault/new'])('已创建但已锁定:%s 被带去解锁页', async entry => {
    mountApp(await lockedVault(), entry);

    expect(await screen.findByLabelText('主密码')).toBeInTheDocument();
    expect(loc()).toBe('/vault/unlock');
  });

  test('已锁定时直接访问 /vault/recover:不被守卫拦走(它在守卫外面)', async () => {
    mountApp(await lockedVault(), '/vault/recover');

    expect(await screen.findByLabelText('恢复密钥')).toBeInTheDocument();
    expect(loc()).toBe('/vault/recover');
  });

  test('已解锁:/vault 是列表,外框有"已解锁"和"立即锁定"', async () => {
    const vault = await createInitializedVault();
    await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    mountApp(vault, '/vault');

    expect(await screen.findByText('银行')).toBeInTheDocument();
    expect(screen.getByText('保险箱已解锁')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即锁定' })).toBeInTheDocument();
    expect(loc()).toBe('/vault');
  });

  test.each([
    ['/vault/new', '新建记录'],
    ['/vault/settings', '保险箱设置'],
  ])('已解锁:%s 是静态路径,不会被当成记录 id', async (entry, title) => {
    mountApp(await createInitializedVault(), entry);

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  });

  test('已解锁:/vault/<id> 是详情,/vault/<id>/edit 是编辑', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    const { unmount } = mountApp(vault, `/vault/${id}`);
    expect(await screen.findByRole('heading', { name: '银行' })).toBeInTheDocument();
    unmount();

    mountApp(vault, `/vault/${id}/edit`);
    expect(await screen.findByRole('heading', { name: '编辑记录' })).toBeInTheDocument();
  });

  test('已解锁:不会被带去创建页或解锁页(没有重定向循环)', async () => {
    mountApp(await createInitializedVault(), '/vault');

    await screen.findByRole('button', { name: '立即锁定' });
    await act(async () => {});

    expect(loc()).toBe('/vault');
  });
});

// ===========================================================================
describe('加载中和出错时不乱跳', () => {
  test('还在读库、不知道是新用户还是老用户:显示"正在检查",不跳去创建页', async () => {
    const vault = await lockedVault();
    const gate = createGate();
    const real = vault.service.isInitialized.bind(vault.service);
    vi.spyOn(vault.service, 'isInitialized').mockImplementation(async () => {
      await gate.wait();
      return real();
    });
    mountApp(vault, '/vault');

    expect(screen.getByText('正在检查…')).toBeInTheDocument();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(loc()).toBe('/vault');
    expect(screen.queryByText('先了解几件事')).toBeNull();

    gate.release();
    await waitFor(() => expect(loc()).toBe('/vault/unlock'));
  });

  test('读库失败:显示错误和重试,不跳去创建页(读不出来不等于还没创建)', async () => {
    const vault = await lockedVault();
    vi.spyOn(vault.service, 'isInitialized').mockRejectedValueOnce(new Error('db unavailable'));
    mountApp(vault, '/vault');

    expect(await screen.findByRole('alert')).toHaveTextContent('读取保险箱失败');
    expect(loc()).toBe('/vault');
    expect(screen.queryByText('先了解几件事')).toBeNull();
    expect(document.body.textContent).not.toContain('db unavailable');

    click('重试');

    await waitFor(() => expect(loc()).toBe('/vault/unlock'));
  });
});

// ===========================================================================
describe('解锁、锁定、回到原来的页面', () => {
  test('被守卫带去解锁页之后,解锁成功回到原来要去的页面', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    vault.session.lock();
    mountApp(vault, `/vault/${id}`);

    await unlockOnPage();

    expect(await screen.findByRole('heading', { name: '银行' })).toBeInTheDocument();
    expect(loc()).toBe(`/vault/${id}`);
  });

  test('点"立即锁定":会话关闭,被带去解锁页;解锁之后回到刚才的页面', async () => {
    const vault = await createInitializedVault();
    mountApp(vault, '/vault/settings');
    await screen.findByRole('heading', { name: '保险箱设置' });

    click('立即锁定');

    await screen.findByLabelText('主密码');
    expect(vault.session.isOpen()).toBe(false);
    expect(loc()).toBe('/vault/unlock');
    type('主密码', PASSWORD);
    click('解锁');
    expect(await screen.findByRole('heading', { name: '保险箱设置' })).toBeInTheDocument();
    expect(loc()).toBe('/vault/settings');
  });

  test('"立即锁定"是广播锁定:另一个打开着的面板也一起锁', async () => {
    const vault = await createInitializedVault();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    mountApp(vault, '/vault');
    await screen.findByRole('button', { name: '立即锁定' });

    click('立即锁定');

    await waitFor(() => expect(peer.session.isOpen()).toBe(false));
  });

  test('另一个面板锁定:本面板被带去解锁页', async () => {
    const vault = await createInitializedVault();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    mountApp(vault, '/vault');
    await screen.findByRole('button', { name: '立即锁定' });

    act(() => peer.session.lock());

    await waitFor(() => expect(loc()).toBe('/vault/unlock'));
    expect(vault.session.isOpen()).toBe(false);
  });

  test('空闲自动锁定同样把用户带去解锁页', async () => {
    const vault = await createInitializedVault();
    mountApp(vault, '/vault');
    await screen.findByRole('button', { name: '立即锁定' });

    act(() => vault.session.lock()); // 自动锁定走的就是 session.lock()

    await waitFor(() => expect(loc()).toBe('/vault/unlock'));
  });
});

// ===========================================================================
describe('锁定时页面被卸载:明文不残留', () => {
  test('编辑页里输入到一半的秘密:锁定之后不在页面上;重新解锁回到的是一个空表单', async () => {
    const vault = await createInitializedVault();
    mountApp(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '写到一半');
    type('密码', SECRET_MARK);
    expect(someFieldHolds(SECRET_MARK)).toBe(true);

    act(() => vault.session.lock());

    await screen.findByLabelText('主密码');
    expect(someFieldHolds(SECRET_MARK)).toBe(false);
    expect(document.body.textContent).not.toContain(SECRET_MARK);
    expect(screen.queryByLabelText('标题')).toBeNull();

    type('主密码', PASSWORD);
    click('解锁');
    await screen.findByLabelText('标题');
    expect(loc()).toBe('/vault/new');
    expect(screen.getByLabelText('标题')).toHaveValue('');
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });

  test('编辑已有记录时锁定:表单里的明文同样消失,重新解锁后重新从库里读,不是旧的 state', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: '银行', secret: 'stored-secret-value' });
    mountApp(vault, `/vault/${id}/edit`);
    await screen.findByDisplayValue('银行');
    type('密码', SECRET_MARK); // 改了一半
    expect(someFieldHolds(SECRET_MARK)).toBe(true);

    act(() => vault.session.lock());
    await screen.findByLabelText('主密码');
    expect(someFieldHolds(SECRET_MARK)).toBe(false);
    expect(someFieldHolds('stored-secret-value')).toBe(false);

    type('主密码', PASSWORD);
    click('解锁');
    await screen.findByDisplayValue('银行');
    expect(screen.getByLabelText('密码')).toHaveValue('stored-secret-value'); // 没保存的修改没有被带过来
  });

  test('详情页已点"显示"的明文:锁定之后不在页面上;重新解锁回到详情页,默认又是隐藏的', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: '银行', secret: SECRET_MARK });
    mountApp(vault, `/vault/${id}`);
    await screen.findByRole('heading', { name: '银行' });
    click('显示密码');
    expect(screen.getByText(SECRET_MARK)).toBeInTheDocument();

    act(() => vault.session.lock());

    await screen.findByLabelText('主密码');
    expect(document.body.textContent).not.toContain(SECRET_MARK);
    type('主密码', PASSWORD);
    click('解锁');
    await screen.findByRole('heading', { name: '银行' });
    expect(document.body.textContent).not.toContain(SECRET_MARK);
    expect(screen.getByRole('button', { name: '显示密码' })).toBeInTheDocument();
  });

  test('列表的搜索词:锁定、重新解锁之后是空的', async () => {
    const vault = await createInitializedVault();
    await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    mountApp(vault, '/vault');
    await screen.findByText('银行');
    type('搜索保险箱', 'looks-like-a-secret');

    act(() => vault.session.lock());
    await screen.findByLabelText('主密码');
    type('主密码', PASSWORD);
    click('解锁');

    await screen.findByText('银行');
    expect(screen.getByLabelText('搜索保险箱')).toHaveValue('');
  });

  test('锁定和重新解锁发生在同一次渲染之间(状态始终是 unlocked):页面照样被重建,输入到一半的内容不会留下', async () => {
    const vault = await createInitializedVault();
    mountApp(vault, '/vault/new');
    await screen.findByLabelText('类型');
    type('标题', '写到一半');
    type('密码', SECRET_MARK);
    const { key, keyId } = vault.session.requireKey();
    const epochBefore = vault.session.getEpoch();

    // 同步地锁定、再用同一把 key 重新打开:React 只会渲染一次,中间没有"locked"那一帧
    act(() => {
      vault.session.lockLocal();
      vault.session.open(key, keyId);
    });

    expect(vault.session.getEpoch()).toBeGreaterThan(epochBefore);
    expect(vault.session.isOpen()).toBe(true);
    expect(loc()).toBe('/vault/new'); // 没有经过解锁页
    expect(someFieldHolds(SECRET_MARK)).toBe(false);
    expect(screen.getByLabelText('标题')).toHaveValue('');
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });
});

// ===========================================================================
describe('恢复密钥提醒(保险箱里每个页面都显示)', () => {
  /** 用恢复密钥找回访问之后:新主密码生效,标记"需要重新生成" */
  async function vaultNeedingRotation() {
    const vault = await createInitializedVault();
    vault.session.lock();
    await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
    return vault;
  }

  test('不需要重新生成时:没有提醒', async () => {
    mountApp(await createInitializedVault(), '/vault');
    await screen.findByRole('button', { name: '立即锁定' });
    await act(async () => {});

    expect(screen.queryByRole('complementary', { name: '恢复密钥提醒' })).toBeNull();
  });

  test.each(['/vault', '/vault/new'])('需要重新生成时:%s 显示提醒,带去设置页的链接', async entry => {
    mountApp(await vaultNeedingRotation(), entry);

    const banner = await screen.findByRole('complementary', { name: '恢复密钥提醒' });
    expect(banner).toHaveTextContent('旧的恢复密钥仍然有效');
    fireEvent.click(screen.getByRole('link', { name: '去重新生成' }));

    expect(await screen.findByRole('heading', { name: '保险箱设置' })).toBeInTheDocument();
    expect(loc()).toBe('/vault/settings');
  });

  test('在设置页不重复显示这条(设置页自己有更详细的提示)', async () => {
    mountApp(await vaultNeedingRotation(), '/vault/settings');

    expect(await screen.findByText('还没有重新生成恢复密钥')).toBeInTheDocument(); // 设置页自己的
    expect(screen.queryByRole('complementary', { name: '恢复密钥提醒' })).toBeNull();
  });

  test('在设置页完成重新生成、离开设置页之后:提醒消失', async () => {
    const vault = await vaultNeedingRotation();
    mountApp(vault, '/vault');
    await screen.findByRole('complementary', { name: '恢复密钥提醒' });
    fireEvent.click(screen.getByRole('link', { name: '去重新生成' }));
    await screen.findByRole('heading', { name: '保险箱设置' });

    click('重新生成恢复密钥');
    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
    const cells = Array.from(document.querySelectorAll('[data-group-index]'));
    const key = `RN-V1-${cells.map(cell => cell.lastElementChild!.textContent).join('-')}`;
    click('我已保存，下一步');
    for (const input of screen.getAllByRole('textbox')) {
      const position = Number(input.id.replace('recovery-confirm-', ''));
      fireEvent.change(input, { target: { value: key.split('-').slice(2)[position - 1] } });
    }
    click('继续');
    await screen.findByText('新的恢复密钥已经生效。');
    click('完成');
    click('返回');

    await screen.findByRole('button', { name: '立即锁定' });
    await waitFor(() => expect(loc()).toBe('/vault'));
    await act(async () => {});
    expect(screen.queryByRole('complementary', { name: '恢复密钥提醒' })).toBeNull();
    expect(await vault.service.isRecoveryRotationRequired()).toBe(false);
  });

  test('读不出这个标记:不显示提醒,也不影响页面其他部分', async () => {
    const vault = await createInitializedVault();
    await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    vi.spyOn(vault.service, 'isRecoveryRotationRequired').mockRejectedValue(new Error('db unavailable'));
    mountApp(vault, '/vault');

    expect(await screen.findByText('银行')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '恢复密钥提醒' })).toBeNull();
  });
});

// ===========================================================================
describe('React StrictMode', () => {
  test('开发模式下 effect 会多跑一遍:完整走一次"被带去解锁页 → 解锁 → 回到原页面 → 锁定"', async () => {
    const vault = await createInitializedVault();
    const id = await vault.service.createRecord({ type: 'password', title: '银行', secret: 'x' });
    vault.session.lock();
    mountApp(vault, `/vault/${id}`, { strict: true });

    await unlockOnPage();
    expect(await screen.findByRole('heading', { name: '银行' })).toBeInTheDocument();
    expect(loc()).toBe(`/vault/${id}`);
    click('立即锁定');

    await screen.findByLabelText('主密码');
    expect(vault.session.isOpen()).toBe(false);
  });
});
