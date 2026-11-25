/**
 * 组合根(src/vault/runtime.ts)和 VaultRuntimeProvider。
 *
 * 重点是"让自动锁定真的生效"这件事:空闲检查、按键计为活动、页面销毁时本地锁定,
 * 以及这些监听能被干净地停掉、反复启停(React StrictMode 会在开发模式下这样做)。
 */
import { StrictMode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';
import { VaultService } from '../../src/vault/services/vault-service';
import { VaultSession } from '../../src/vault/services/vault-session';
import { VaultStore } from '../../src/vault/services/vault-store';
import { createVaultRuntime, getDefaultVaultRuntime, type VaultRuntime } from '../../src/vault/runtime';
import {
  VaultRuntimeProvider,
  useVaultRuntime,
} from '../../src/vault/hooks/VaultRuntimeProvider';
import {
  PASSWORD,
  createInitializedVault,
  createTestVault,
  disposeTestVaults,
  sleep,
} from '../helpers/vault';

const stops: Array<() => void> = [];
const runtimes: VaultRuntime[] = [];

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const stop of stops.splice(0)) stop();
  for (const runtime of runtimes.splice(0)) runtime.store.dispose();
  await disposeTestVaults();
});

/** 用测试保险箱的 session / service 组一个 runtime,自动在 afterEach 里清理 */
function runtimeFor(vault: { session: VaultSession; service: VaultService }): VaultRuntime {
  const runtime = createVaultRuntime({ session: vault.session, service: vault.service });
  runtimes.push(runtime);
  return runtime;
}

function startTracked(runtime: VaultRuntime): () => void {
  const stop = runtime.start();
  stops.push(stop);
  return stop;
}

const press = (type: 'keydown' | 'pointerdown' | 'scroll' | 'mousemove' = 'keydown') =>
  window.dispatchEvent(new Event(type));

describe('createVaultRuntime', () => {
  test('传入的 session / service / store 原样使用', async () => {
    const vault = await createInitializedVault();
    const store = new VaultStore(vault.session, vault.service);

    const runtime = createVaultRuntime({ session: vault.session, service: vault.service, store });
    runtimes.push(runtime);

    expect(runtime.session).toBe(vault.session);
    expect(runtime.service).toBe(vault.service);
    expect(runtime.store).toBe(store);
  });

  test('只传 session 时,自己建的 service 和 store 接在同一个 session 上', async () => {
    const vault = await createInitializedVault();
    const runtime = createVaultRuntime({ session: vault.session });
    runtimes.push(runtime);
    // 自建的 service 用的是真实的 vaultDb 单例,不是测试库,所以这里只验证"接在同一个 session 上",不读写记录:
    // 会话打开时 listSummaries 在空库上返回 [],够用来观察 store 有没有被锁定清空
    await runtime.store.loadSummaries();
    expect(runtime.store.getState().summaries).toEqual([]);

    vault.session.lock();

    // store 订阅的是这个 session:锁定时被清空
    expect(runtime.store.getState().summaries).toBeNull();
  });

  test('什么都不传:建出真实的 Session / Service / Store', () => {
    const runtime = createVaultRuntime();
    runtimes.push(runtime);

    expect(runtime.session).toBeInstanceOf(VaultSession);
    expect(runtime.service).toBeInstanceOf(VaultService);
    expect(runtime.store).toBeInstanceOf(VaultStore);
    runtime.session.dispose();
  });

  test('getDefaultVaultRuntime 总是返回同一个实例', () => {
    const first = getDefaultVaultRuntime();
    runtimes.push(first);

    expect(getDefaultVaultRuntime()).toBe(first);
    first.session.dispose();
  });
});

describe('start / stop', () => {
  test('start 开启空闲检查', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const startIdle = vi.spyOn(vault.session, 'startIdleWatch');

    startTracked(runtime);

    expect(startIdle).toHaveBeenCalledTimes(1);
  });

  test('重复 start 是幂等的:不重复开空闲检查,返回同一个停止函数', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const startIdle = vi.spyOn(vault.session, 'startIdleWatch');
    const touch = vi.spyOn(vault.session, 'touch');

    const first = startTracked(runtime);
    const second = startTracked(runtime);
    press();

    expect(second).toBe(first);
    expect(startIdle).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledTimes(1); // 监听只挂了一份,一次按键只算一次
  });

  test('按键和点击算活动,滚动和鼠标移动不算', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');
    startTracked(runtime);

    press('scroll');
    press('mousemove');
    expect(touch).not.toHaveBeenCalled();

    press('keydown');
    press('pointerdown');
    expect(touch).toHaveBeenCalledTimes(2);
  });

  test('pagehide:本地锁定,但不广播,另一个面板不受影响', async () => {
    const vault = await createInitializedVault();
    const peer = createTestVault({ peerOf: vault });
    await peer.service.unlockWithMasterPassword(PASSWORD);
    const runtime = runtimeFor(vault);
    startTracked(runtime);

    window.dispatchEvent(new Event('pagehide'));

    expect(vault.session.isOpen()).toBe(false);
    await sleep(100); // 给广播留出到达的时间,再断言它没有到达
    expect(peer.session.isOpen()).toBe(true);
  });

  test('pagehide 时 store 里的明文一并清空', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const id = await runtime.service.createRecord({ type: 'password', title: 'T', secret: 'plain-secret' });
    await runtime.store.loadSecret(id);
    startTracked(runtime);

    window.dispatchEvent(new Event('pagehide'));

    expect(runtime.store.getState().secret).toBeNull();
  });

  test('stop 之后:按键不再计为活动,pagehide 不再锁定', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');
    const stop = startTracked(runtime);

    stop();
    press();
    window.dispatchEvent(new Event('pagehide'));

    expect(touch).not.toHaveBeenCalled();
    expect(vault.session.isOpen()).toBe(true);
    // 空闲检查是否真的停了,看"自动锁定端到端"里的用例(那里用假时钟看行为)
  });

  test('stop 可以重复调用', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const stop = startTracked(runtime);

    stop();

    expect(() => stop()).not.toThrow();
  });

  test('stop 之后可以重新 start,监听恢复', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');
    startTracked(runtime)();

    startTracked(runtime);
    press();

    expect(touch).toHaveBeenCalledTimes(1);
  });

  test('过期的停止函数不会把后来重新启动的监听停掉', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');
    const staleStop = startTracked(runtime);
    staleStop();
    const currentStop = startTracked(runtime); // 重新启动

    staleStop(); // 再调用一次旧的
    press();

    expect(touch).toHaveBeenCalledTimes(1);
    // 内部状态没被旧的停止函数清掉:再 start 仍然认为"已经在运行",返回的是当前这个停止函数
    expect(startTracked(runtime)).toBe(currentStop);
    window.dispatchEvent(new Event('pagehide'));
    expect(vault.session.isOpen()).toBe(false); // pagehide 的监听也还在
  });
});

describe('自动锁定端到端', () => {
  test('空闲超过设置的时间后自动锁定,期间的按键让计时重新开始', async () => {
    // Session 在构造时取 Date.now,所以必须先装假时钟再建保险箱
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(60_000);
    const runtime = runtimeFor(vault);
    startTracked(runtime);

    vi.advanceTimersByTime(50_000);
    expect(vault.session.isOpen()).toBe(true);

    press('keydown'); // 第 50 秒有活动,计时重新开始
    vi.advanceTimersByTime(50_000); // 第 100 秒,距上次活动 50 秒
    expect(vault.session.isOpen()).toBe(true);

    vi.advanceTimersByTime(20_000); // 第 120 秒,距上次活动 70 秒
    expect(vault.session.isOpen()).toBe(false);
  });

  test('stop 之后空闲检查真的停了:超过设置的时间也不会再锁定', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(60_000);
    const runtime = runtimeFor(vault);
    const stop = startTracked(runtime);

    stop();
    vi.advanceTimersByTime(120_000);

    expect(vault.session.isOpen()).toBe(true);
  });

  test('过期的停止函数不会把后来重新启动的空闲检查停掉', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(60_000);
    const runtime = runtimeFor(vault);
    const staleStop = startTracked(runtime);
    staleStop();
    startTracked(runtime); // 重新启动

    staleStop(); // 再调用一次旧的
    vi.advanceTimersByTime(120_000);

    expect(vault.session.isOpen()).toBe(false); // 新的空闲检查仍在运行
  });

  test('没有 start 的话,同样的空闲不会锁定(证明上一条确实是 runtime 在起作用)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(60_000);
    runtimeFor(vault); // 建了,但没有 start

    vi.advanceTimersByTime(120_000);

    expect(vault.session.isOpen()).toBe(true);
  });

  test('自动锁定后 store 里的明文也被清空', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const vault = await createInitializedVault();
    await vault.service.setAutoLockTimeout(60_000);
    const runtime = runtimeFor(vault);
    const id = await runtime.service.createRecord({ type: 'password', title: 'T', secret: 'plain-secret' });
    await runtime.store.loadSecret(id);
    startTracked(runtime);

    vi.advanceTimersByTime(70_000);

    expect(vault.session.isOpen()).toBe(false);
    expect(runtime.store.getState().secret).toBeNull();
  });
});

describe('VaultRuntimeProvider', () => {
  test('挂载时 start,卸载时调用停止函数', async () => {
    const vault = await createInitializedVault();
    const real = runtimeFor(vault);
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const runtime: VaultRuntime = { ...real, start };

    const { unmount } = render(
      <VaultRuntimeProvider runtime={runtime}>
        <div />
      </VaultRuntimeProvider>
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('子孙组件能拿到传入的 runtime', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);

    const { result } = renderHook(() => useVaultRuntime(), {
      wrapper: ({ children }) => <VaultRuntimeProvider runtime={runtime}>{children}</VaultRuntimeProvider>,
    });

    expect(result.current).toBe(runtime);
  });

  test('StrictMode(mount → cleanup → mount)之后,监听只有一份', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');

    render(
      <StrictMode>
        <VaultRuntimeProvider runtime={runtime}>
          <div />
        </VaultRuntimeProvider>
      </StrictMode>
    );
    press();

    expect(touch).toHaveBeenCalledTimes(1);
  });

  test('卸载后监听被清掉', async () => {
    const vault = await createInitializedVault();
    const runtime = runtimeFor(vault);
    const touch = vi.spyOn(vault.session, 'touch');
    const { unmount } = render(
      <VaultRuntimeProvider runtime={runtime}>
        <div />
      </VaultRuntimeProvider>
    );

    unmount();
    press();
    window.dispatchEvent(new Event('pagehide'));

    expect(touch).not.toHaveBeenCalled();
    expect(vault.session.isOpen()).toBe(true);
  });

  test('在 Provider 之外调用 useVaultRuntime 会明确报错', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React 会把渲染错误打到控制台

    expect(() => renderHook(() => useVaultRuntime())).toThrow('VaultRuntimeProvider');
  });
});
