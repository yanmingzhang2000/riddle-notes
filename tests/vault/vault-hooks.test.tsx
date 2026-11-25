/**
 * useVaultStatus / useVaultSession / useVaultStore。
 *
 * 最重要的是 useVaultStore 那一组:锁定的那一刻,屏幕上的明文必须立刻消失,
 * 而不是等下一次请求或下一次点击。
 */
import { type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { VaultService } from '../../src/vault/services/vault-service';
import type { VaultSession } from '../../src/vault/services/vault-session';
import { createVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import { VaultRuntimeProvider } from '../../src/vault/hooks/VaultRuntimeProvider';
import { useVaultSession } from '../../src/vault/hooks/useVaultSession';
import { useVaultStatus } from '../../src/vault/hooks/useVaultStatus';
import { useVaultStore } from '../../src/vault/hooks/useVaultStore';
import {
  PASSWORD,
  createGate,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
} from '../helpers/vault';

const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
});

function runtimeFor(vault: { session: VaultSession; service: VaultService }): VaultRuntime {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  return runtime;
}

function wrapperFor(runtime: VaultRuntime) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <VaultRuntimeProvider runtime={runtime}>{children}</VaultRuntimeProvider>;
  };
}

describe('useVaultStatus', () => {
  test('没初始化过的库:loading → uninitialized', async () => {
    const vault = createTestVault();
    const runtime = runtimeFor(vault);

    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });

    expect(result.current.status).toBe('loading'); // 读库是异步的,第一帧还不知道
    await waitFor(() => expect(result.current.status).toBe('uninitialized'));
  });

  test('已初始化但会话没打开:loading → locked', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const runtime = runtimeFor(vault);

    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('locked'));
  });

  test('会话已经打开:第一帧就是 unlocked,不去读库', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const isInitialized = vi.spyOn(vault.service, 'isInitialized');

    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });

    expect(result.current.status).toBe('unlocked');
    await act(async () => {}); // 让可能发出的异步读库有机会执行
    expect(isInitialized).not.toHaveBeenCalled();
  });

  test('完整流程:uninitialized → unlocked → locked → unlocked', async () => {
    const vault = createTestVault();
    const runtime = runtimeFor(vault);
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    await waitFor(() => expect(result.current.status).toBe('uninitialized'));

    await act(async () => {
      await vault.service.initialize(PASSWORD, async () => {});
    });
    expect(result.current.status).toBe('unlocked');

    act(() => vault.session.lock());
    expect(result.current.status).toBe('locked'); // 之前已经确认过"已初始化",不会闪回 loading

    await act(async () => {
      await vault.service.unlockWithMasterPassword(PASSWORD);
    });
    expect(result.current.status).toBe('unlocked');
  });

  test('另一个面板广播锁定:本面板变成 locked', async () => {
    const vault = await createInitializedVault();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    const runtime = runtimeFor(vault);
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    expect(result.current.status).toBe('unlocked');

    act(() => peer.session.lock());

    await waitFor(() => expect(result.current.status).toBe('locked'));
  });

  test('锁定之后重新确认一次库的状态', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const isInitialized = vi.spyOn(vault.service, 'isInitialized');
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    expect(isInitialized).not.toHaveBeenCalled(); // 打开状态下不读库

    act(() => vault.session.lock());

    await waitFor(() => expect(isInitialized).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('locked'));
  });

  test('锁定时发现库已经被清空:变成 uninitialized,而不是让用户去输一个无处可验的密码', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    await vault.db.vaultKeys.clear(); // 例如数据在别处被清掉

    act(() => vault.session.lock());

    await waitFor(() => expect(result.current.status).toBe('uninitialized'));
  });

  test('读库失败:是 error,不是 uninitialized(否则老用户会被带去"设置主密码")', async () => {
    const vault = createTestVault();
    const runtime = runtimeFor(vault);
    vi.spyOn(vault.service, 'isInitialized').mockRejectedValue(new Error('db unavailable'));

    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });

    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  test('error 之后 refresh:回到 loading,再读一次', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const runtime = runtimeFor(vault);
    const isInitialized = vi
      .spyOn(vault.service, 'isInitialized')
      .mockRejectedValueOnce(new Error('db unavailable'));
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.refresh());

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('locked'));
    expect(isInitialized).toHaveBeenCalledTimes(2);
  });

  test('refresh 的引用在多次渲染之间不变(可以放进 effect 依赖)', async () => {
    const vault = createTestVault();
    const runtime = runtimeFor(vault);
    const { result, rerender } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    const first = result.current.refresh;

    await waitFor(() => expect(result.current.status).toBe('uninitialized'));
    rerender();

    expect(result.current.refresh).toBe(first);
  });

  test('读库的结果在会话已经打开之后才返回:不能让它覆盖"已初始化"', async () => {
    const vault = await createInitializedVault();
    vault.session.lock();
    const runtime = runtimeFor(vault);
    // 第一次读库卡住,并且最终(错误地)返回 false;之后的读库一直卡住,方便观察中间状态
    const firstGate = createGate();
    const neverGate = createGate();
    let calls = 0;
    vi.spyOn(vault.service, 'isInitialized').mockImplementation(async () => {
      if (++calls === 1) {
        await firstGate.wait();
        return false;
      }
      await neverGate.wait();
      return true;
    });
    const { result } = renderHook(() => useVaultStatus(), { wrapper: wrapperFor(runtime) });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await vault.service.unlockWithMasterPassword(PASSWORD); // 读库还没返回,会话先打开了
    });
    expect(result.current.status).toBe('unlocked');
    await act(async () => {
      firstGate.release(); // 过期的"false"现在才返回
    });
    act(() => vault.session.lock());

    // 第二次读库还没返回,看到的是此前的结论。如果过期的 false 写进来了,这里会是 uninitialized
    expect(result.current.status).toBe('locked');
    neverGate.release();
  });
});

describe('useVaultSession', () => {
  test('返回 session、epoch、isOpen,锁定后都更新', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const { result } = renderHook(() => useVaultSession(), { wrapper: wrapperFor(runtime) });
    const before = result.current;
    expect(before.session).toBe(vault.session);
    expect(before.isOpen).toBe(true);
    expect(before.epoch).toBe(vault.session.getEpoch());

    act(() => vault.session.lock());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.epoch).toBe(before.epoch + 1);
  });

  test('重新解锁后 epoch 再次变化', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const { result } = renderHook(() => useVaultSession(), { wrapper: wrapperFor(runtime) });
    act(() => vault.session.lock());
    const locked = result.current.epoch;

    await act(async () => {
      await vault.service.unlockWithMasterPassword(PASSWORD);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.epoch).toBeGreaterThan(locked);
  });
});

describe('useVaultStore', () => {
  const SECRET = 'plain-secret-marker-xyz';

  async function seeded() {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const id = await runtime.service.createRecord({ type: 'password', title: 'Bank', secret: SECRET });
    return { vault, runtime, id };
  }

  test('初始为空,加载后组件拿到数据', async () => {
    const { runtime, id } = await seeded();
    const { result } = renderHook(() => useVaultStore(), { wrapper: wrapperFor(runtime) });
    expect(result.current.summaries).toBeNull();
    expect(result.current.secret).toBeNull();

    await act(async () => {
      await runtime.store.loadSummaries();
      await runtime.store.loadSecret(id);
    });

    expect(result.current.summaries?.map(s => s.title)).toEqual(['Bank']);
    expect(result.current.secret?.secret).toBe(SECRET);
    expect(result.current.store).toBe(runtime.store);
  });

  test('锁定的同一个 act 里,hook 读到的明文就已经是 null', async () => {
    const { vault, runtime, id } = await seeded();
    const { result } = renderHook(() => useVaultStore(), { wrapper: wrapperFor(runtime) });
    await act(async () => {
      await runtime.store.loadSummaries();
      await runtime.store.loadSecret(id);
    });
    expect(result.current.secret?.secret).toBe(SECRET);

    act(() => vault.session.lock());

    expect(result.current.secret).toBeNull();
    expect(result.current.summaries).toBeNull();
  });

  test('屏幕上的明文随锁定一起消失(不是只有数据变了)', async () => {
    const { vault, runtime, id } = await seeded();
    function Detail() {
      const { secret } = useVaultStore();
      return <div>{secret ? <span data-testid="shown">{secret.secret}</span> : <span>empty</span>}</div>;
    }
    render(
      <VaultRuntimeProvider runtime={runtime}>
        <Detail />
      </VaultRuntimeProvider>
    );
    await act(async () => {
      await runtime.store.loadSecret(id);
    });
    expect(screen.getByTestId('shown').textContent).toBe(SECRET);

    act(() => vault.session.lock());

    expect(screen.queryByTestId('shown')).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  test('另一个面板广播锁定,本面板屏幕上的明文也消失', async () => {
    const { vault, runtime, id } = await seeded();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    function Detail() {
      const { secret } = useVaultStore();
      return <div>{secret?.secret ?? 'empty'}</div>;
    }
    render(
      <VaultRuntimeProvider runtime={runtime}>
        <Detail />
      </VaultRuntimeProvider>
    );
    await act(async () => {
      await runtime.store.loadSecret(id);
    });
    expect(document.body.textContent).toContain(SECRET);

    act(() => peer.session.lock());

    await waitFor(() => expect(document.body.textContent).not.toContain(SECRET));
  });
});
