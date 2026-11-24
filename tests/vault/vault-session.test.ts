import { act, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { asBufferSource } from '../../src/vault/crypto/bytes';
import { CryptoService } from '../../src/vault/crypto/crypto-service';
import { VaultLockedError } from '../../src/vault/crypto/errors';
import {
  IDLE_CHECK_INTERVAL_MS,
  VaultSession,
  trackActivity,
  type VaultSessionOptions,
} from '../../src/vault/services/vault-session';

const svc = new CryptoService();
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function makeKey() {
  const raw = svc.generateVaultKeyBytes();
  return { key: await svc.importSessionKey(raw), keyId: await svc.computeKeyId(raw) };
}

// 每个测试用独立的 channel 名,并在结束时释放,避免实例之间串扰、避免 channel 拖住进程
let channelCounter = 0;
const created: VaultSession[] = [];

function makeSession(options: VaultSessionOptions = {}): VaultSession {
  const session = new VaultSession({ channelName: `test-vault-${channelCounter++}`, ...options });
  created.push(session);
  return session;
}

/** 在同一个 channel 上建多个会话,模拟多个 Side Panel */
function makePeers(count: number): VaultSession[] {
  const channelName = `test-vault-${channelCounter++}`;
  return Array.from({ length: count }, () => {
    const session = new VaultSession({ channelName });
    created.push(session);
    return session;
  });
}

async function openSession(session: VaultSession, options?: { expectedEpoch?: number }) {
  const { key, keyId } = await makeKey();
  session.open(key, keyId, options);
  return { key, keyId };
}

afterEach(() => {
  // 先 dispose(会再通知一次订阅者),再恢复 spy,否则 dispose 时的 console.error 会漏到终端
  created.splice(0).forEach(s => s.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('打开与锁定', () => {
  test('新实例是关闭状态,epoch 为 0', () => {
    const session = makeSession();
    expect(session.isOpen()).toBe(false);
    expect(session.getEpoch()).toBe(0);
    expect(() => session.requireKey()).toThrow(VaultLockedError);
  });

  test('open 后可以取到 key、keyId 和当前 epoch', async () => {
    const session = makeSession();
    const { key, keyId } = await openSession(session);
    expect(session.isOpen()).toBe(true);
    const got = session.requireKey();
    expect(got.key).toBe(key);
    expect(toHex(got.keyId)).toBe(toHex(keyId));
    expect(got.epoch).toBe(1);
  });

  test.each(['lock', 'lockLocal'] as const)('%s() 回到关闭状态,取 key 抛 VaultLockedError', async method => {
    const session = makeSession();
    await openSession(session);
    session[method]();
    expect(session.isOpen()).toBe(false);
    expect(() => session.requireKey()).toThrow(VaultLockedError);
  });

  test('epoch:打开 +1,锁定 +1', async () => {
    const session = makeSession();
    await openSession(session);
    expect(session.getEpoch()).toBe(1);
    session.lockLocal();
    expect(session.getEpoch()).toBe(2);
    await openSession(session);
    expect(session.getEpoch()).toBe(3);
  });

  test('已经锁定时再锁定也 +1,让进行中的异步操作失效', () => {
    const session = makeSession();
    session.lockLocal();
    session.lockLocal();
    expect(session.getEpoch()).toBe(2);
  });

  test('extractable 的 key 被拒绝', async () => {
    const session = makeSession();
    const extractable = await crypto.subtle.importKey(
      'raw',
      asBufferSource(svc.generateVaultKeyBytes()),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    expect(() => session.open(extractable, new Uint8Array(8))).toThrow(TypeError);
    expect(session.isOpen()).toBe(false);
  });

  test('keyId 长度不是 8 被拒绝', async () => {
    const session = makeSession();
    const { key } = await makeKey();
    expect(() => session.open(key, new Uint8Array(7))).toThrow(TypeError);
    expect(() => session.open(key, new Uint8Array(9))).toThrow(TypeError);
    expect(session.isOpen()).toBe(false);
  });

  test('requireKey 返回的 keyId 是拷贝,改它不影响会话', async () => {
    const session = makeSession();
    const { keyId } = await openSession(session);
    session.requireKey().keyId.fill(99);
    expect(toHex(session.requireKey().keyId)).toBe(toHex(keyId));
  });

  test('open 保存的 keyId 是拷贝,改原数组不影响会话', async () => {
    const session = makeSession();
    const { key, keyId } = await makeKey();
    const before = toHex(keyId);
    session.open(key, keyId);
    keyId.fill(0);
    expect(toHex(session.requireKey().keyId)).toBe(before);
  });
});

describe('expectedEpoch:防止过期结果打开会话', () => {
  test('期间没有锁定过:正常打开', async () => {
    const session = makeSession();
    const epoch = session.getEpoch();
    await openSession(session, { expectedEpoch: epoch });
    expect(session.isOpen()).toBe(true);
  });

  test('期间被锁定过:抛 VaultLockedError,会话保持关闭', async () => {
    const session = makeSession();
    const epoch = session.getEpoch(); // 解锁开始前读到
    session.lockLocal(); // KDF 跑的时候收到锁定广播
    await expect(openSession(session, { expectedEpoch: epoch })).rejects.toBeInstanceOf(
      VaultLockedError
    );
    expect(session.isOpen()).toBe(false);
  });

  test('不传 expectedEpoch 时不检查', async () => {
    const session = makeSession();
    session.lockLocal();
    await openSession(session);
    expect(session.isOpen()).toBe(true);
  });
});

describe('assertEpoch:在途异步操作', () => {
  test('期间没有锁定:通过', async () => {
    const session = makeSession();
    await openSession(session);
    const { epoch } = session.requireKey();
    expect(() => session.assertEpoch(epoch)).not.toThrow();
  });

  test('期间被锁定:抛 VaultLockedError', async () => {
    const session = makeSession();
    await openSession(session);
    const { epoch } = session.requireKey();
    session.lock();
    expect(() => session.assertEpoch(epoch)).toThrow(VaultLockedError);
  });

  test('锁定后又重新打开:旧 epoch 仍然失效', async () => {
    const session = makeSession();
    await openSession(session);
    const { epoch } = session.requireKey();
    session.lock();
    await openSession(session);
    expect(() => session.assertEpoch(epoch)).toThrow(VaultLockedError);
  });

  test('模拟 getRecord:解密期间被锁定,明文不会返回给调用方', async () => {
    const session = makeSession();
    await openSession(session);

    const getRecord = async () => {
      const { epoch } = session.requireKey();
      await sleep(5); // 读库、解密
      session.assertEpoch(epoch);
      return 'plaintext-secret';
    };

    const pending = getRecord();
    session.lock(); // 用户在这时点了锁定
    await expect(pending).rejects.toBeInstanceOf(VaultLockedError);
  });
});

describe('多实例广播', () => {
  test('一个实例锁定,另一个实例也锁定', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);

    a.lock();

    await vi.waitFor(() => expect(b.isOpen()).toBe(false));
    expect(a.isOpen()).toBe(false);
  });

  test('不会无限互相广播:每个实例的 epoch 只增加一次', async () => {
    const [a, b, c] = makePeers(3);
    await openSession(a);
    await openSession(b);
    await openSession(c);
    const before = [a, b, c].map(s => s.getEpoch());

    a.lock();
    await vi.waitFor(() => expect(b.isOpen() || c.isOpen()).toBe(false));
    await sleep(150); // 如果收到广播的一方又转发,这期间 epoch 会持续增长

    expect([a, b, c].map(s => s.getEpoch())).toEqual(before.map(e => e + 1));
  });

  test('announce(wrapper-changed):其他实例锁定,发送方不受影响', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);
    const epochA = a.getEpoch();

    a.announce('wrapper-changed');

    await vi.waitFor(() => expect(b.isOpen()).toBe(false));
    expect(a.isOpen()).toBe(true);
    expect(a.getEpoch()).toBe(epochA);
  });

  test('announce(imported):其他实例锁定', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);

    a.announce('imported');

    await vi.waitFor(() => expect(b.isOpen()).toBe(false));
  });

  test('未知的消息类型被忽略', async () => {
    const [a, b] = makePeers(2);
    await openSession(b);
    const epoch = b.getEpoch();

    // 用同一个 channel 名发一些乱七八糟的消息
    const name = (a as unknown as { channel: BroadcastChannel }).channel.name;
    const raw = new BroadcastChannel(name);
    raw.postMessage({ type: 'something-else' });
    raw.postMessage('lock');
    raw.postMessage(null);
    raw.postMessage({});
    await sleep(100);
    raw.close();

    expect(b.isOpen()).toBe(true);
    expect(b.getEpoch()).toBe(epoch);
  });

  test('不同 channel 名的实例互不影响', async () => {
    const a = makeSession();
    const b = makeSession();
    await openSession(a);
    await openSession(b);

    a.lock();
    await sleep(100);

    expect(b.isOpen()).toBe(true);
  });

  test('另一个实例改了 wrapper:本实例正在进行的解锁结果作废', async () => {
    const [a, b] = makePeers(2);
    const epoch = b.getEpoch(); // b 开始解锁,KDF 在跑
    a.announce('wrapper-changed');
    await vi.waitFor(() => expect(b.getEpoch()).toBeGreaterThan(epoch));

    await expect(openSession(b, { expectedEpoch: epoch })).rejects.toBeInstanceOf(VaultLockedError);
    expect(b.isOpen()).toBe(false);
  });

  test('另一个实例锁定时,本实例正在进行的读取作废', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);
    const { epoch } = b.requireKey();

    a.lock();
    await vi.waitFor(() => expect(b.isOpen()).toBe(false));

    expect(() => b.assertEpoch(epoch)).toThrow(VaultLockedError);
  });
});

describe('自动锁定', () => {
  async function openWith(timeoutMs: number, clock: { now: number }) {
    const session = makeSession({ getTimeoutMs: () => timeoutMs, now: () => clock.now });
    await openSession(session);
    return session;
  }

  test('时间没到不锁定', async () => {
    const clock = { now: 1000 };
    const session = await openWith(60_000, clock);
    clock.now += 59_999;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
  });

  test('刚好到时间就锁定', async () => {
    const clock = { now: 1000 };
    const session = await openWith(60_000, clock);
    clock.now += 60_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(false);
  });

  test('系统休眠后唤醒:时间戳差值超过超时就锁定,哪怕计时器没触发过', async () => {
    const clock = { now: 1000 };
    const session = await openWith(60_000, clock);
    clock.now += 8 * 3600_000; // 睡了 8 小时
    session.checkIdle();
    expect(session.isOpen()).toBe(false);
  });

  test('touch 重新计时', async () => {
    const clock = { now: 1000 };
    const session = await openWith(60_000, clock);
    clock.now += 59_000;
    session.touch();
    clock.now += 59_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
    clock.now += 1_001;
    session.checkIdle();
    expect(session.isOpen()).toBe(false);
  });

  test('超时为 0 表示 Never,永不自动锁定', async () => {
    const clock = { now: 1000 };
    const session = await openWith(0, clock);
    clock.now += 10 ** 12;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
  });

  test('超时每次检查时重新读取,设置改了立即生效', async () => {
    const clock = { now: 1000 };
    let timeout = 100_000;
    const session = makeSession({ getTimeoutMs: () => timeout, now: () => clock.now });
    await openSession(session);

    clock.now += 99_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);

    timeout = 50_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(false);
  });

  test('锁定后再打开,计时从打开时重新开始', async () => {
    const clock = { now: 1000 };
    const session = await openWith(60_000, clock);
    clock.now += 30_000;
    session.lockLocal();
    clock.now += 100_000;
    await openSession(session);
    clock.now += 59_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
  });

  test('未打开时 touch 和 checkIdle 是空操作', () => {
    const session = makeSession();
    expect(() => session.touch()).not.toThrow();
    expect(() => session.checkIdle()).not.toThrow();
    expect(session.getEpoch()).toBe(0);
  });

  test('自动锁定也会通知其他实例', async () => {
    const clock = { now: 1000 };
    const channelName = `test-vault-${channelCounter++}`;
    const a = new VaultSession({ channelName, getTimeoutMs: () => 60_000, now: () => clock.now });
    const b = new VaultSession({ channelName });
    created.push(a, b);
    await openSession(a);
    await openSession(b);

    clock.now += 60_000;
    a.checkIdle();

    await vi.waitFor(() => expect(b.isOpen()).toBe(false));
  });
});

describe('startIdleWatch / stopIdleWatch', () => {
  test('定时器每隔 intervalMs 调一次 checkIdle', async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(1000);
    expect(spy).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test('默认间隔是 10 秒', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch();
    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS - 1);
    expect(spy).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('stopIdleWatch 之后不再调用', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(1000);
    session.stopIdleWatch();
    vi.advanceTimersByTime(10_000);
    expect(spy).not.toHaveBeenCalled();
  });

  test('重复 startIdleWatch 会先停掉旧的,不会叠加', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(1000);
    session.startIdleWatch(1000);
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('页面重新可见时立即检查一次', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(10 ** 9);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('页面变为不可见时不检查', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(10 ** 9);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  test('stopIdleWatch 之后 visibilitychange 不再触发检查', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'checkIdle');
    session.startIdleWatch(10 ** 9);
    session.stopIdleWatch();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).not.toHaveBeenCalled();
  });

  test('visible 时发现已超时:同步锁定,回调里没有 await', async () => {
    const clock = { now: 1000 };
    const session = makeSession({ getTimeoutMs: () => 60_000, now: () => clock.now });
    await openSession(session);
    session.startIdleWatch(10 ** 9);

    clock.now += 61_000;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(session.isOpen()).toBe(false); // 事件派发返回时就已经锁定,不需要等微任务
  });
});

describe('trackActivity', () => {
  test('keydown 和 pointerdown 调用 touch', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'touch');
    const cleanup = trackActivity(session, document.body);

    document.body.dispatchEvent(new KeyboardEvent('keydown'));
    document.body.dispatchEvent(new Event('pointerdown'));
    expect(spy).toHaveBeenCalledTimes(2);
    cleanup();
  });

  test('活动让自动锁定重新计时', async () => {
    const clock = { now: 1000 };
    const session = makeSession({ getTimeoutMs: () => 60_000, now: () => clock.now });
    await openSession(session);
    const cleanup = trackActivity(session, document.body);

    clock.now += 59_000;
    document.body.dispatchEvent(new KeyboardEvent('keydown'));
    clock.now += 59_000;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
    cleanup();
  });

  test('不监听 mousemove、scroll 这类可能被页面自动触发的事件', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'touch');
    const cleanup = trackActivity(session, document.body);

    document.body.dispatchEvent(new MouseEvent('mousemove'));
    document.body.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(new Event('focus'));
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  test('清理后不再监听', () => {
    const session = makeSession();
    const spy = vi.spyOn(session, 'touch');
    const cleanup = trackActivity(session, document.body);
    cleanup();

    document.body.dispatchEvent(new KeyboardEvent('keydown'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('subscribe / useSyncExternalStore', () => {
  test('open、lock、lockLocal 都会通知订阅者', async () => {
    const session = makeSession();
    const callback = vi.fn();
    session.subscribe(callback);

    await openSession(session);
    expect(callback).toHaveBeenCalledTimes(1);
    session.lock();
    expect(callback).toHaveBeenCalledTimes(2);
    session.lockLocal();
    expect(callback).toHaveBeenCalledTimes(3);
  });

  test('收到广播锁定时也通知订阅者', async () => {
    const [a, b] = makePeers(2);
    await openSession(b);
    const callback = vi.fn();
    b.subscribe(callback);

    a.lock();

    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  });

  test('subscribe 返回的函数取消订阅', async () => {
    const session = makeSession();
    const callback = vi.fn();
    const unsubscribe = session.subscribe(callback);
    unsubscribe();
    await openSession(session);
    expect(callback).not.toHaveBeenCalled();
  });

  test('一个订阅者抛错,不影响其他订阅者收到锁定通知', async () => {
    const session = makeSession();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    session.subscribe(bad);
    session.subscribe(good);

    await openSession(session);

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('订阅者抛错时的日志不含错误内容', async () => {
    const session = makeSession();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    session.subscribe(() => {
      throw new Error('sk-secret-in-error');
    });
    await openSession(session);
    expect(errorSpy).toHaveBeenCalled(); // 确认 spy 确实接到了调用,下面的断言才有意义
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('sk-secret-in-error');
  });

  test('subscribe 和 getEpoch 的引用稳定(useSyncExternalStore 要求)', () => {
    const session = makeSession();
    expect(session.subscribe).toBe(session.subscribe);
    expect(session.getEpoch).toBe(session.getEpoch);
  });

  test('与 React 的 useSyncExternalStore 配合:epoch 变化触发重新渲染', async () => {
    const session = makeSession();
    const { result, unmount } = renderHook(() =>
      useSyncExternalStore(session.subscribe, session.getEpoch)
    );
    expect(result.current).toBe(0);

    const { key, keyId } = await makeKey();
    act(() => session.open(key, keyId));
    expect(result.current).toBe(1);

    act(() => session.lock());
    expect(result.current).toBe(2);
    unmount(); // afterEach 的 dispose 会再通知一次,不卸载就会在 act 之外更新
  });

  test('React:其他实例广播锁定后,本实例的 epoch 变化触发重新渲染', async () => {
    const [a, b] = makePeers(2);
    await openSession(b);
    const { result, unmount } = renderHook(() => useSyncExternalStore(b.subscribe, b.getEpoch));
    expect(result.current).toBe(1);

    // 广播是异步到达的,状态更新发生在 act 里才不会有警告
    await act(async () => {
      a.lock();
      await vi.waitFor(() => expect(b.isOpen()).toBe(false));
    });

    expect(result.current).toBe(2);
    unmount();
  });
});

describe('dispose', () => {
  test('清除会话', async () => {
    const session = makeSession();
    await openSession(session);
    session.dispose();
    expect(session.isOpen()).toBe(false);
  });

  test('清空订阅者', async () => {
    const session = makeSession();
    const callback = vi.fn();
    session.subscribe(callback);
    session.dispose();
    callback.mockClear();
    await openSession(session);
    expect(callback).not.toHaveBeenCalled();
  });

  test('关闭 channel,不再接收广播', async () => {
    const [a, b] = makePeers(2);
    await openSession(b);
    b.dispose();
    const epochAfterDispose = b.getEpoch();

    a.lock();
    await sleep(100);

    expect(b.getEpoch()).toBe(epochAfterDispose);
  });

  test('dispose 不广播,不会锁定其他实例', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);

    a.dispose();
    await sleep(100);

    expect(b.isOpen()).toBe(true);
  });
});

describe('自动锁定超时:内存缓存 setAutoLockTimeoutMs', () => {
  test('没设过时用注入的 getTimeoutMs,再没有就用默认的 5 分钟', () => {
    expect(makeSession({ getTimeoutMs: () => 123_000 }).getAutoLockTimeoutMs()).toBe(123_000);
    expect(makeSession().getAutoLockTimeoutMs()).toBe(300_000);
  });

  test('设过之后内存里的值优先于 getTimeoutMs', () => {
    const session = makeSession({ getTimeoutMs: () => 123_000 });
    session.setAutoLockTimeoutMs(60_000);
    expect(session.getAutoLockTimeoutMs()).toBe(60_000);
  });

  test('改小之后立即生效:下一次 checkIdle 就按新值锁定', async () => {
    const clock = { now: 1000 };
    const session = makeSession({ now: () => clock.now });
    await openSession(session);

    clock.now += 61_000; // 默认 5 分钟,还没到
    session.checkIdle();
    expect(session.isOpen()).toBe(true);

    session.setAutoLockTimeoutMs(60_000); // 改成 1 分钟,已经超了
    session.checkIdle();
    expect(session.isOpen()).toBe(false);
  });

  test('改成 0(Never)之后永不自动锁定,即使注入的回调说要锁', async () => {
    const clock = { now: 1000 };
    const session = makeSession({ getTimeoutMs: () => 60_000, now: () => clock.now });
    await openSession(session);

    session.setAutoLockTimeoutMs(0);
    clock.now += 10 ** 12;
    session.checkIdle();
    expect(session.isOpen()).toBe(true);
  });

  test.each([-1, NaN, Infinity, -Infinity])('非法的超时 %s:TypeError,原来的值不变', value => {
    const session = makeSession();
    session.setAutoLockTimeoutMs(60_000);
    expect(() => session.setAutoLockTimeoutMs(value)).toThrow(TypeError);
    expect(session.getAutoLockTimeoutMs()).toBe(60_000);
  });

  test.each(['60000', null, undefined, {}])('不是数字的超时 %s:TypeError', value => {
    const session = makeSession();
    expect(() => session.setAutoLockTimeoutMs(value as unknown as number)).toThrow(TypeError);
  });

  test('锁定和重新打开都不会丢掉这个值(它不是秘密,下次解锁时服务层会再读一遍)', async () => {
    const session = makeSession();
    session.setAutoLockTimeoutMs(60_000);
    await openSession(session);
    session.lockLocal();
    expect(session.getAutoLockTimeoutMs()).toBe(60_000);
    await openSession(session);
    expect(session.getAutoLockTimeoutMs()).toBe(60_000);
  });
});

describe('settings-changed 广播:通知其他面板,但不锁定它们', () => {
  test('其他面板的监听者被调用,而且这些面板保持打开', async () => {
    const [a, b, c] = makePeers(3);
    await openSession(a);
    await openSession(b);
    await openSession(c);
    const heardB = vi.fn();
    const heardC = vi.fn();
    b.onSettingsChanged(heardB);
    c.onSettingsChanged(heardC);
    const epochs = [a, b, c].map(s => s.getEpoch());

    a.announceSettingsChanged();

    await vi.waitFor(() => expect(heardB).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(heardC).toHaveBeenCalledTimes(1));
    await sleep(100);
    expect([a, b, c].every(s => s.isOpen())).toBe(true);
    expect([a, b, c].map(s => s.getEpoch())).toEqual(epochs); // 没有任何一个被 lockLocal
  });

  test('发送方自己的监听者不会被调用(BroadcastChannel 不会回送给自己)', async () => {
    const [a, b] = makePeers(2);
    const heardA = vi.fn();
    const heardB = vi.fn();
    a.onSettingsChanged(heardA);
    b.onSettingsChanged(heardB);

    a.announceSettingsChanged();

    await vi.waitFor(() => expect(heardB).toHaveBeenCalledTimes(1));
    await sleep(100);
    expect(heardA).not.toHaveBeenCalled();
  });

  test('不会无限互相广播:每个监听者只被调用一次', async () => {
    const [a, b] = makePeers(2);
    const heardA = vi.fn();
    const heardB = vi.fn();
    a.onSettingsChanged(heardA);
    b.onSettingsChanged(heardB);

    a.announceSettingsChanged();
    await sleep(200);

    expect(heardB).toHaveBeenCalledTimes(1);
    expect(heardA).not.toHaveBeenCalled();
  });

  test('未打开的面板也能收到(它下次解锁时会读到新值,但提前刷新也无妨)', async () => {
    const [a, b] = makePeers(2);
    const heard = vi.fn();
    b.onSettingsChanged(heard);
    a.announceSettingsChanged();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    expect(b.isOpen()).toBe(false);
  });

  test('onSettingsChanged 返回的函数可以取消监听', async () => {
    const [a, b] = makePeers(2);
    const heard = vi.fn();
    const off = b.onSettingsChanged(heard);
    off();

    a.announceSettingsChanged();
    await sleep(100);

    expect(heard).not.toHaveBeenCalled();
  });

  test('一个监听者抛错,不影响其他监听者,日志里没有错误内容', async () => {
    const [a, b] = makePeers(2);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    b.onSettingsChanged(() => {
      throw new Error('super-secret-detail');
    });
    b.onSettingsChanged(second);

    a.announceSettingsChanged();

    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('settings listener failed');
    expect(logged).not.toContain('super-secret-detail');
  });

  test('锁定类广播仍然会锁定:settings-changed 没有改变它们的行为', async () => {
    const [a, b] = makePeers(2);
    await openSession(a);
    await openSession(b);
    a.announce('wrapper-changed');
    await vi.waitFor(() => expect(b.isOpen()).toBe(false));
  });

  test('dispose 之后监听者被清空,收不到通知', async () => {
    const [a, b] = makePeers(2);
    const heard = vi.fn();
    b.onSettingsChanged(heard);
    b.dispose();

    a.announceSettingsChanged();
    await sleep(100);

    expect(heard).not.toHaveBeenCalled();
  });
});
