/**
 * 保险箱设置页:自动锁定、修改主密码、重新生成/检查恢复密钥。
 *
 * 用真实的 VaultService 和内存里的 IndexedDB。安全相关的重点:
 * 修改主密码的门控(弱密码、不一致、当前密码错误)、改完之后别的面板被锁定、
 * "检查恢复密钥"只读不改(不碰库、不碰会话)、自动锁定的设置真的生效、
 * 重新生成的提示在完成之后消失、错误文案按类别。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthError, ConflictError } from '../../src/vault/crypto/errors';
import { generateRecoveryKey } from '../../src/vault/crypto/recovery-key';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import VaultSettings from '../../src/vault/pages/VaultSettings';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import { DEFAULT_PASSWORD_POLICY } from '../../src/vault/services/password-policy';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  snapshotVault,
  type TestVault,
} from '../helpers/vault';

vi.setConfig({ testTimeout: 20_000 });

const NEW_PASSWORD = 'a brand new passphrase 2026';
const WEAK_PASSWORD = 'password12345678';
const STRENGTH_TIMEOUT = { timeout: 8000 };
const strict = { passwordPolicy: DEFAULT_PASSWORD_POLICY };

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

function mountSettings(vault: TestVault) {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  const result = render(
    <VaultRuntimeProvider runtime={runtime}>
      <MemoryRouter initialEntries={['/vault/settings']}>
        <Probe />
        <Routes>
          <Route path="/vault/settings" element={<VaultSettings />} />
          <Route path="*" element={<div>other</div>} />
        </Routes>
      </MemoryRouter>
    </VaultRuntimeProvider>
  );
  return { runtime, ...result };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;

function displayedKey(): string {
  const cells = Array.from(document.querySelectorAll('[data-group-index]'));
  expect(cells).toHaveLength(14);
  return `RN-V1-${cells.map(cell => cell.lastElementChild!.textContent).join('-')}`;
}

function fillConfirm(key: string) {
  const groups = key.split('-').slice(2);
  for (const input of screen.getAllByRole('textbox')) {
    const position = Number(input.id.replace('recovery-confirm-', ''));
    fireEvent.change(input, { target: { value: groups[position - 1] } });
  }
}

/** 用恢复密钥找回访问之后的状态:新主密码生效,标记"需要重新生成" */
async function vaultNeedingRotation() {
  const vault = await createInitializedVault(strict);
  vault.session.lock();
  await vault.service.recoverAccess(vault.recoveryKey, NEW_PASSWORD);
  return vault;
}

// ===========================================================================
describe('VaultSettings 页面', () => {
  test('三个分区都在;返回键回到保险箱', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);

    for (const name of ['恢复密钥', '自动锁定', '修改主密码']) {
      expect(await screen.findByRole('region', { name })).toBeInTheDocument();
    }
    click('返回');
    expect(loc()).toBe('/vault');
  });
});

// ===========================================================================
describe('自动锁定', () => {
  test('四档:1 / 5 / 15 分钟 / 从不,默认选中 5 分钟', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);

    await waitFor(() => expect(radio('5 分钟')).toBeChecked());
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    for (const name of ['1 分钟', '15 分钟', '从不']) expect(radio(name)).not.toBeChecked();
  });

  test('读到之前选项是禁用的(不会在没读出当前值时就改成别的)', async () => {
    const vault = await createInitializedVault(strict);
    const gate = createGate();
    const real = vault.service.getAutoLockTimeout.bind(vault.service);
    vi.spyOn(vault.service, 'getAutoLockTimeout').mockImplementation(async () => {
      await gate.wait();
      return real();
    });
    mountSettings(vault);

    for (const radioButton of screen.getAllByRole('radio')) expect(radioButton).toBeDisabled();
    gate.release();
    await waitFor(() => expect(radio('5 分钟')).toBeEnabled());
  });

  test('选一档:写进库、本面板立刻生效,选中状态跟着变', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());

    fireEvent.click(radio('15 分钟'));

    await waitFor(() => expect(radio('15 分钟')).toBeChecked());
    expect(await vault.service.getAutoLockTimeout()).toBe(900_000);
    expect(vault.session.getAutoLockTimeoutMs()).toBe(900_000);
  });

  test('选"从不":生效,并说明只有关闭侧边栏或手动锁定才会锁', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());
    expect(screen.queryByText(/只有关闭侧边栏或手动锁定/)).toBeNull();

    fireEvent.click(radio('从不'));

    expect(await screen.findByText(/只有关闭侧边栏或手动锁定/)).toBeInTheDocument();
    expect(vault.session.getAutoLockTimeoutMs()).toBe(0);
  });

  test('说明里写明"关闭侧边栏会立即锁定"', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);

    expect(await screen.findByText(/关闭侧边栏会立即锁定/)).toBeInTheDocument();
  });

  test('保存失败:显示错误,选中状态保持原来的(和实际生效的一致)', async () => {
    const vault = await createInitializedVault(strict);
    vi.spyOn(vault.service, 'setAutoLockTimeout').mockRejectedValueOnce(new Error('db unavailable'));
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());

    fireEvent.click(radio('1 分钟'));

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(radio('5 分钟')).toBeChecked();
    expect(radio('1 分钟')).not.toBeChecked();
    expect(vault.session.getAutoLockTimeoutMs()).toBe(300_000);
  });

  test('别的面板改了:本面板的选中状态跟着变,并且本面板不会被锁定', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);

    await act(async () => {
      await peer.service.setAutoLockTimeout(60_000);
    });

    await waitFor(() => expect(radio('1 分钟')).toBeChecked());
    expect(vault.session.isOpen()).toBe(true);
  });

  test('点已经选中的那一档:不重复写库(浏览器对已选中的 radio 不触发 change)', async () => {
    const vault = await createInitializedVault(strict);
    const set = vi.spyOn(vault.service, 'setAutoLockTimeout');
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());

    fireEvent.click(radio('5 分钟'));
    await act(async () => {});

    expect(set).not.toHaveBeenCalled();
  });

  test('卸载之后不再监听别的面板的设置变化(不泄漏监听)', async () => {
    const vault = await createInitializedVault(strict);
    const { unmount } = mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());
    const listeners = () => (vault.session as unknown as { settingsListeners: Set<unknown> }).settingsListeners.size;
    // VaultService 构造时自己注册了一个,组件挂载时又多一个
    const whileMounted = listeners();

    unmount();

    expect(listeners()).toBe(whileMounted - 1);
  });

  test('保存进行中:选项禁用,不会连续提交', async () => {
    const vault = await createInitializedVault(strict);
    const gate = createGate();
    const real = vault.service.setAutoLockTimeout.bind(vault.service);
    const set = vi.spyOn(vault.service, 'setAutoLockTimeout').mockImplementation(async ms => {
      await gate.wait();
      return real(ms);
    });
    mountSettings(vault);
    await waitFor(() => expect(radio('5 分钟')).toBeChecked());

    fireEvent.click(radio('1 分钟'));
    await waitFor(() => expect(radio('15 分钟')).toBeDisabled());
    fireEvent.click(radio('15 分钟'));

    expect(set).toHaveBeenCalledTimes(1);
    gate.release();
    await waitFor(() => expect(radio('1 分钟')).toBeChecked());
  });
});

// ===========================================================================
describe('修改主密码', () => {
  async function reachForm() {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);
    await screen.findByLabelText('当前主密码');
    return vault;
  }

  async function fillValid(current = PASSWORD, next = NEW_PASSWORD) {
    type('当前主密码', current);
    type('新主密码', next);
    type('再输入一次新主密码', next);
    await waitFor(() => expect(screen.getByRole('button', { name: '修改主密码' })).toBeEnabled(), STRENGTH_TIMEOUT);
  }

  test('输入框属性:都是 password,当前密码 autocomplete=off,新密码 new-password;没有 <form>', async () => {
    await reachForm();

    expect(screen.getByLabelText('当前主密码')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('当前主密码')).toHaveAttribute('autocomplete', 'off');
    for (const label of ['新主密码', '再输入一次新主密码']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password');
      expect(screen.getByLabelText(label)).toHaveAttribute('autocomplete', 'new-password');
    }
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: '修改主密码' })).toBeDisabled();
  });

  test('成功:旧密码失效、新密码可用、输入框清空、提示其他侧边栏已被锁定', async () => {
    const vault = await reachForm();
    await fillValid();

    click('修改主密码');

    const notice = await screen.findByText(/主密码已修改/);
    expect(notice).toHaveTextContent('其他打开着的侧边栏已被锁定');
    expect(notice).toHaveTextContent('新主密码重新解锁');
    expect(screen.getByLabelText('当前主密码')).toHaveValue('');
    expect(screen.getByLabelText('新主密码')).toHaveValue('');
    expect(screen.getByLabelText('再输入一次新主密码')).toHaveValue('');
    vault.session.lock();
    await expect(vault.service.unlockWithMasterPassword(PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithMasterPassword(NEW_PASSWORD);
  });

  test('成功之后别的面板被锁定(服务层广播),本面板保持解锁', async () => {
    const vault = await reachForm();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    await fillValid();

    click('修改主密码');

    await waitFor(() => expect(peer.session.isOpen()).toBe(false));
    expect(vault.session.isOpen()).toBe(true);
  });

  test('当前主密码不对:认证失败文案,库不变,输入保留以便改正', async () => {
    const vault = await reachForm();
    const before = await snapshotVault(vault.db);
    await fillValid('not the current password');

    click('修改主密码');

    expect(await screen.findByRole('alert')).toHaveTextContent('密码错误，或数据已损坏');
    expect(await snapshotVault(vault.db)).toEqual(before);
    expect(screen.getByLabelText('新主密码')).toHaveValue(NEW_PASSWORD);
    expect(document.body.textContent).not.toContain('not the current password');
    // 失败之后还能改:输入框没有卡在禁用状态,改正当前密码之后可以直接再提交
    expect(screen.getByLabelText('当前主密码')).toBeEnabled();
    type('当前主密码', PASSWORD);
    await waitFor(() => expect(screen.getByRole('button', { name: '修改主密码' })).toBeEnabled());
    click('修改主密码');
    expect(await screen.findByText(/主密码已修改/)).toBeInTheDocument();
  });

  test('弱密码:不能提交,服务层没有被调用', async () => {
    const vault = await reachForm();
    const change = vi.spyOn(vault.service, 'changeMasterPassword');
    type('当前主密码', PASSWORD);
    type('新主密码', WEAK_PASSWORD);
    type('再输入一次新主密码', WEAK_PASSWORD);
    await screen.findByText(/太容易被猜到/, {}, STRENGTH_TIMEOUT);

    expect(screen.getByRole('button', { name: '修改主密码' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('再输入一次新主密码'), { key: 'Enter' });
    await act(async () => {});

    expect(change).not.toHaveBeenCalled();
  });

  test('两次输入不一致:提示,不能提交', async () => {
    const vault = await reachForm();
    const change = vi.spyOn(vault.service, 'changeMasterPassword');
    type('当前主密码', PASSWORD);
    type('新主密码', NEW_PASSWORD);
    type('再输入一次新主密码', `${NEW_PASSWORD}!`);
    await screen.findByText('强度合格。', {}, STRENGTH_TIMEOUT);

    expect(screen.getByText('两次输入不一致')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '修改主密码' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('当前主密码'), { key: 'Enter' });
    await act(async () => {});
    expect(change).not.toHaveBeenCalled();
  });

  test('没有填当前主密码:不能提交', async () => {
    const vault = await reachForm();
    const change = vi.spyOn(vault.service, 'changeMasterPassword');
    type('新主密码', NEW_PASSWORD);
    type('再输入一次新主密码', NEW_PASSWORD);
    await screen.findByText('强度合格。', {}, STRENGTH_TIMEOUT);

    expect(screen.getByRole('button', { name: '修改主密码' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('新主密码'), { key: 'Enter' });
    await act(async () => {});
    expect(change).not.toHaveBeenCalled();
  });

  test('回车等同于点按钮', async () => {
    const vault = await reachForm();
    await fillValid();

    fireEvent.keyDown(screen.getByLabelText('再输入一次新主密码'), { key: 'Enter' });

    expect(await screen.findByText(/主密码已修改/)).toBeInTheDocument();
  });

  test('提交进行中:输入框和按钮禁用,重复触发只调用一次', async () => {
    const vault = await reachForm();
    const gate = createGate();
    const real = vault.service.changeMasterPassword.bind(vault.service);
    const change = vi.spyOn(vault.service, 'changeMasterPassword').mockImplementation(async (current, next) => {
      await gate.wait();
      return real(current, next);
    });
    await fillValid();

    click('修改主密码');
    await screen.findByRole('button', { name: '正在修改…' });
    fireEvent.keyDown(screen.getByLabelText('再输入一次新主密码'), { key: 'Enter' });
    await act(async () => {});

    expect(screen.getByLabelText('当前主密码')).toBeDisabled();
    expect(change).toHaveBeenCalledTimes(1);
    gate.release();
    await screen.findByText(/主密码已修改/);
  });

  test('另一个窗口刚改过(并发冲突):提示重新操作,输入保留', async () => {
    const vault = await reachForm();
    vi.spyOn(vault.service, 'changeMasterPassword').mockRejectedValueOnce(new ConflictError());
    await fillValid();

    click('修改主密码');

    expect(await screen.findByRole('alert')).toHaveTextContent('刚刚在另一个窗口被修改');
    expect(screen.getByLabelText('当前主密码')).toHaveValue(PASSWORD);
  });

  test('改动输入后,上一次的"已修改"提示消失', async () => {
    const vault = await reachForm();
    await fillValid();
    click('修改主密码');
    await screen.findByText(/主密码已修改/);

    type('当前主密码', 'x');

    expect(screen.queryByText(/主密码已修改/)).toBeNull();
  });
});

// ===========================================================================
describe('恢复密钥', () => {
  test('不需要重新生成时:没有那条提示', async () => {
    const vault = await createInitializedVault(strict);
    mountSettings(vault);
    await screen.findByLabelText('要检查的恢复密钥');
    await act(async () => {});

    expect(screen.queryByText('还没有重新生成恢复密钥')).toBeNull();
  });

  test('用恢复密钥找回访问之后:显示不能忽略的提示', async () => {
    const vault = await vaultNeedingRotation();
    mountSettings(vault);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('还没有重新生成恢复密钥');
    expect(alert).toHaveTextContent('旧的随即作废');
  });

  test('重新生成需要主密码;完成之后提示消失,旧的恢复密钥作废,新的可用', async () => {
    const vault = await vaultNeedingRotation();
    mountSettings(vault);
    await screen.findByText('还没有重新生成恢复密钥');
    click('重新生成恢复密钥');

    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');
    const newKey = displayedKey();
    click('我已保存，下一步');
    fillConfirm(newKey);
    click('继续');
    await screen.findByText('新的恢复密钥已经生效。');
    click('完成');

    await waitFor(() => expect(screen.queryByText('还没有重新生成恢复密钥')).toBeNull());
    expect(await vault.service.isRecoveryRotationRequired()).toBe(false);
    vault.session.lock();
    await expect(vault.service.unlockWithRecoveryKey(vault.recoveryKey)).rejects.toBeInstanceOf(AuthError);
    await vault.service.unlockWithRecoveryKey(newKey);
  });

  test('重新生成中途取消:提示仍然在,旧的恢复密钥仍然有效', async () => {
    const vault = await vaultNeedingRotation();
    mountSettings(vault);
    await screen.findByText('还没有重新生成恢复密钥');
    click('重新生成恢复密钥');
    type('主密码', NEW_PASSWORD);
    click('生成新的恢复密钥');
    await screen.findByText('确认保存之后，旧的恢复密钥会立刻失效。');

    click('取消');

    await screen.findByText('已取消。旧的恢复密钥仍然有效。');
    expect(screen.getByText('还没有重新生成恢复密钥')).toBeInTheDocument();
    expect(await vault.service.isRecoveryRotationRequired()).toBe(true);
    vault.session.lock();
    await vault.service.unlockWithRecoveryKey(vault.recoveryKey);
  });

  test('重新生成的取消按钮(在输入主密码这一步)收起这个流程,什么都没改', async () => {
    const vault = await createInitializedVault(strict);
    const before = await snapshotVault(vault.db);
    mountSettings(vault);
    await screen.findByRole('button', { name: '重新生成恢复密钥' });
    click('重新生成恢复密钥');
    expect(screen.getByLabelText('主密码')).toBeInTheDocument();

    click('取消');

    expect(screen.queryByLabelText('主密码')).toBeNull();
    expect(screen.getByRole('button', { name: '重新生成恢复密钥' })).toBeInTheDocument();
    expect(await snapshotVault(vault.db)).toEqual(before);
  });

  describe('检查恢复密钥', () => {
    test('有效的恢复密钥:提示有效,输入框清空,库和会话都没有变化', async () => {
      const vault = await createInitializedVault(strict);
      const before = await snapshotVault(vault.db);
      const epoch = vault.session.getEpoch();
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');

      type('要检查的恢复密钥', vault.recoveryKey);
      click('检查这把恢复密钥');

      expect(await screen.findByText('这把恢复密钥有效，可以用它打开这个保险箱。')).toBeInTheDocument();
      expect(screen.getByLabelText('要检查的恢复密钥')).toHaveValue('');
      expect(await snapshotVault(vault.db)).toEqual(before);
      expect(vault.session.getEpoch()).toBe(epoch);
      expect(vault.session.isOpen()).toBe(true);
    });

    test('检查的是真正生效的那一把:格式对但不是这个保险箱的 → 失败;重新生成之后旧的 → 失败', async () => {
      const vault = await createInitializedVault(strict);
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');
      const { formatted: other } = await generateRecoveryKey();

      type('要检查的恢复密钥', other);
      click('检查这把恢复密钥');

      expect(await screen.findByRole('alert')).toHaveTextContent('恢复密钥不正确，或数据已损坏');
    });

    test.each([
      ['格式不对', 'not a recovery key'],
      ['校验和不对', 'RN-V1-AAAQ-EAYE-AUDA-OCAJ-BIFQ-YDIO-B4IB-CEQT-CQKR-MFYY-DENB-WHA5-DYPQ-MMG5'],
    ])('%s:提示输入有误', async (_name, bad) => {
      const vault = await createInitializedVault(strict);
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');

      type('要检查的恢复密钥', bad);
      click('检查这把恢复密钥');

      expect(await screen.findByRole('alert')).toHaveTextContent('恢复密钥输入有误，请检查');
    });

    test('失败时输入保留(方便改正);再次修改输入时,上一次的结果消失', async () => {
      const vault = await createInitializedVault(strict);
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');
      type('要检查的恢复密钥', 'not a recovery key');
      click('检查这把恢复密钥');
      await screen.findByRole('alert');

      expect(screen.getByLabelText('要检查的恢复密钥')).toHaveValue('not a recovery key');
      type('要检查的恢复密钥', 'not a recovery key!');

      expect(screen.queryByRole('alert')).toBeNull();
    });

    test('输入为空:按钮禁用,回车也不会调用服务层', async () => {
      const vault = await createInitializedVault(strict);
      const verify = vi.spyOn(vault.service, 'verifyRecoveryKey');
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');

      expect(screen.getByRole('button', { name: '检查这把恢复密钥' })).toBeDisabled();
      fireEvent.keyDown(screen.getByLabelText('要检查的恢复密钥'), { key: 'Enter' });
      type('要检查的恢复密钥', '   ');
      fireEvent.keyDown(screen.getByLabelText('要检查的恢复密钥'), { key: 'Enter' });
      await act(async () => {});

      expect(verify).not.toHaveBeenCalled();
    });

    test('输入框:autocomplete=off,没有 <form>;回车等同于点按钮', async () => {
      const vault = await createInitializedVault(strict);
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');

      expect(screen.getByLabelText('要检查的恢复密钥')).toHaveAttribute('autocomplete', 'off');
      expect(document.querySelector('form')).toBeNull();
      type('要检查的恢复密钥', vault.recoveryKey);
      fireEvent.keyDown(screen.getByLabelText('要检查的恢复密钥'), { key: 'Enter' });

      expect(await screen.findByText(/这把恢复密钥有效/)).toBeInTheDocument();
    });

    test('检查进行中:输入框和按钮禁用,不会重复调用', async () => {
      const vault = await createInitializedVault(strict);
      const gate = createGate();
      const real = vault.service.verifyRecoveryKey.bind(vault.service);
      const verify = vi.spyOn(vault.service, 'verifyRecoveryKey').mockImplementation(async input => {
        await gate.wait();
        return real(input);
      });
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');
      type('要检查的恢复密钥', vault.recoveryKey);

      click('检查这把恢复密钥');
      await screen.findByRole('button', { name: '正在检查…' });
      fireEvent.keyDown(screen.getByLabelText('要检查的恢复密钥'), { key: 'Enter' });
      await act(async () => {});

      expect(screen.getByLabelText('要检查的恢复密钥')).toBeDisabled();
      expect(verify).toHaveBeenCalledTimes(1);
      gate.release();
      await screen.findByText(/这把恢复密钥有效/);
    });

    test('检查失败时不把内部错误显示出来', async () => {
      const vault = await createInitializedVault(strict);
      vi.spyOn(vault.service, 'verifyRecoveryKey').mockRejectedValueOnce(new Error('internal detail xyz'));
      mountSettings(vault);
      await screen.findByLabelText('要检查的恢复密钥');
      type('要检查的恢复密钥', vault.recoveryKey);

      click('检查这把恢复密钥');

      expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试');
      expect(document.body.textContent).not.toContain('internal detail xyz');
    });
  });
});
