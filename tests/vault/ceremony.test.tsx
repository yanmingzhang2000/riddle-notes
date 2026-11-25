/**
 * useRecoveryKeyCeremony:展示 Recovery Key → 回填确认 → 才允许写库。
 *
 * 用一个假的服务层动作代替 initialize / rotateRecoveryKey:它先调用 onRecoveryKey,
 * resolve 之后才调用 write()。所以"write 什么时候被调用"就是"什么时候写库"。
 */
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useRecoveryKeyCeremony,
  type CeremonyResult,
  type RecoveryKeyHandler,
} from '../../src/vault/hooks/useRecoveryKeyCeremony';
import { createGate } from '../helpers/vault';

afterEach(() => {
  vi.restoreAllMocks();
});

const KEY = 'RN-V1-TEST-KEY';

/** 开始一次流程,返回最终结果的 Promise。act 结束时流程已经停在"等用户"的位置 */
async function start(
  result: { current: ReturnType<typeof useRecoveryKeyCeremony> },
  action: (onRecoveryKey: RecoveryKeyHandler) => Promise<void>
) {
  let outcome!: Promise<CeremonyResult>;
  await act(async () => {
    outcome = result.current.run(action);
    // 吞掉拒绝:有的用例就是要看 run 抛错,它们自己 await outcome
    outcome.catch(() => {});
    await Promise.resolve();
  });
  // 必须包一层:async 函数直接 return 一个 Promise 会去等它 settle,而它要到整个流程结束才 settle
  return { outcome };
}

/** 到达 confirm 阶段 */
async function toConfirm(result: { current: ReturnType<typeof useRecoveryKeyCeremony> }, write: () => void) {
  const started = await start(result, async onRecoveryKey => {
    await onRecoveryKey(KEY);
    write();
  });
  act(() => result.current.proceedToConfirm());
  return started;
}

describe('正常流程', () => {
  test('idle → working → show → confirm → saving → idle,Recovery Key 只在中间几个阶段存在', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const gate = createGate();
    const write = vi.fn();
    expect(result.current.phase).toBe('idle');
    expect(result.current.recoveryKey).toBeNull();

    const { outcome } = await start(result, async onRecoveryKey => {
      await gate.wait(); // 服务层在做 KDF
      await onRecoveryKey(KEY);
      write();
    });
    expect(result.current.phase).toBe('working');
    expect(result.current.recoveryKey).toBeNull();

    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
    expect(result.current.phase).toBe('show');
    expect(result.current.recoveryKey).toBe(KEY);

    act(() => result.current.proceedToConfirm());
    expect(result.current.phase).toBe('confirm');
    expect(result.current.recoveryKey).toBe(KEY);

    await act(async () => {
      result.current.confirmed();
    });
    await expect(outcome).resolves.toBe('completed');
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(result.current.recoveryKey).toBeNull();
  });

  test('从 confirm 可以回到 show,再继续,Key 不变', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    await toConfirm(result, vi.fn());

    act(() => result.current.backToShow());
    expect(result.current.phase).toBe('show');
    expect(result.current.recoveryKey).toBe(KEY);
    act(() => result.current.proceedToConfirm());

    expect(result.current.phase).toBe('confirm');
  });
});

describe('回填确认之前不写库', () => {
  test('working、show、confirm 三个阶段 write 都没有被调用', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const write = vi.fn();

    await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      write();
    });
    expect(result.current.phase).toBe('show');
    expect(write).not.toHaveBeenCalled();

    act(() => result.current.proceedToConfirm());
    expect(result.current.phase).toBe('confirm');
    await act(async () => {});
    expect(write).not.toHaveBeenCalled();
  });

  test('show 阶段调用 confirmed():被忽略,不能跳过回填确认', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const write = vi.fn();
    await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      write();
    });

    await act(async () => {
      result.current.confirmed();
    });

    expect(result.current.phase).toBe('show');
    expect(write).not.toHaveBeenCalled();
  });

  test('idle 阶段调用 confirmed() / proceedToConfirm() / backToShow() / cancel():什么都不发生', () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());

    act(() => {
      result.current.confirmed();
      result.current.proceedToConfirm();
      result.current.backToShow();
      result.current.cancel();
    });

    expect(result.current.phase).toBe('idle');
  });

  test('阶段只能按顺序走:confirm 阶段不能再 proceedToConfirm,show 阶段不能 backToShow', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
    });

    act(() => result.current.backToShow());
    expect(result.current.phase).toBe('show');
    act(() => result.current.proceedToConfirm());
    act(() => result.current.proceedToConfirm());
    expect(result.current.phase).toBe('confirm');
  });
});

describe('取消', () => {
  test.each(['show', 'confirm'] as const)('在 %s 阶段取消:不写库,结果是 cancelled,Key 清掉', async stage => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const write = vi.fn();
    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      write();
    });
    if (stage === 'confirm') act(() => result.current.proceedToConfirm());

    await act(async () => {
      result.current.cancel();
    });

    await expect(outcome).resolves.toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.recoveryKey).toBeNull();
  });

  // 注意:这条行为由两层保证,阶段守卫(cancel 里)和 Promise 语义(已 resolve 的 Promise 再 reject 是空操作)。
  // 去掉阶段守卫,这条测试不会失败,因为 Promise 语义兜底了。所以它守的是"最终结果",不是那个守卫
  test('已经确认、正在保存时再取消:无效,保存照常完成', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const gate = createGate();
    const write = vi.fn();
    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      await gate.wait(); // 事务还在提交
      write();
    });
    act(() => result.current.proceedToConfirm());
    await act(async () => {
      result.current.confirmed();
    });
    expect(result.current.phase).toBe('saving');

    act(() => result.current.cancel());
    await act(async () => {
      gate.release();
    });

    await expect(outcome).resolves.toBe('completed');
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('取消之后可以重新开始,并拿到新的 Key', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const { outcome: first } = await start(result, async onRecoveryKey => {
      await onRecoveryKey('FIRST');
    });
    await act(async () => {
      result.current.cancel();
    });
    await first;

    await start(result, async onRecoveryKey => {
      await onRecoveryKey('SECOND');
    });

    expect(result.current.recoveryKey).toBe('SECOND');
  });
});

describe('用户离开页面', () => {
  test('在 show 阶段卸载:等待中的回调被拒绝,不写库', async () => {
    const { result, unmount } = renderHook(() => useRecoveryKeyCeremony());
    const write = vi.fn();
    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      write();
    });

    unmount();

    await expect(outcome).resolves.toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });

  test('服务层在页面已经卸载之后才调用回调:立刻拒绝,不会挂着一个永远不 resolve 的 Promise', async () => {
    const { result, unmount } = renderHook(() => useRecoveryKeyCeremony());
    const gate = createGate();
    const write = vi.fn();
    const { outcome } = await start(result, async onRecoveryKey => {
      await gate.wait(); // KDF 还在跑,用户已经走了
      await onRecoveryKey(KEY);
      write();
    });

    unmount();
    gate.release();

    await expect(outcome).resolves.toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('出错', () => {
  test('动作在展示 Key 之前就失败(例如主密码错误):原样抛出,回到 idle', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    let outcome!: Promise<CeremonyResult>;
    await act(async () => {
      outcome = result.current.run(async () => {
        throw new Error('auth failed');
      });
      outcome.catch(() => {});
    });

    await expect(outcome).rejects.toThrow('auth failed');
    expect(result.current.phase).toBe('idle');
    expect(result.current.recoveryKey).toBeNull();
  });

  test('确认之后提交失败(例如并发冲突):原样抛出,Key 被清掉', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      throw new Error('conflict');
    });
    act(() => result.current.proceedToConfirm());

    await act(async () => {
      result.current.confirmed();
    });

    await expect(outcome).rejects.toThrow('conflict');
    expect(result.current.phase).toBe('idle');
    expect(result.current.recoveryKey).toBeNull();
  });

  test('流程进行中再次 run:拒绝,不会开出第二个并行的流程', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
    });

    await expect(result.current.run(async () => {})).rejects.toThrow('already running');
    expect(result.current.phase).toBe('show');
  });

  test('出错之后可以重新开始(running 标记已清除)', async () => {
    const { result } = renderHook(() => useRecoveryKeyCeremony());
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('first failure');
      }).catch(() => {});
    });

    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
    });

    expect(result.current.phase).toBe('show');
    await act(async () => {
      result.current.cancel();
    });
    await outcome;
  });
});

describe('React StrictMode', () => {
  test('开发模式下组件先卸载再挂载一次,之后流程仍然能正常走完', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useRecoveryKeyCeremony(), { wrapper });
    const write = vi.fn();

    const { outcome } = await start(result, async onRecoveryKey => {
      await onRecoveryKey(KEY);
      write();
    });
    expect(result.current.phase).toBe('show');
    act(() => result.current.proceedToConfirm());
    await act(async () => {
      result.current.confirmed();
    });

    await expect(outcome).resolves.toBe('completed');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
