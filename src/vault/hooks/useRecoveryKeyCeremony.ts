import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "展示 Recovery Key → 回填确认 → 才允许写库"这一整套流程的状态机。
 * 创建保险箱(initialize)和重新生成 Recovery Key(rotateRecoveryKey)用的是同一套。
 *
 * 服务层的约定是:onRecoveryKey 回调 resolve 之前什么都不会写进库,回调抛错就整体取消。
 * 这个 hook 把回调的 resolve 交给 confirmed(),并且只有处在 confirm 阶段才接受它,
 * 所以"没有通过回填校验就写库"在这里是不可能的:
 *
 *   idle ──run──▶ working ──(服务层调用回调)──▶ show ──▶ confirm ──confirmed()──▶ saving ──▶ idle
 *                                                 └── cancel()/卸载 ──▶ 回调 reject ──▶ idle(什么都没写)
 *
 * Recovery Key 只在 show / confirm 阶段存在于 state 里,流程结束(成功、取消、出错、卸载)后清掉。
 */

export type CeremonyPhase = 'idle' | 'working' | 'show' | 'confirm' | 'saving';
export type CeremonyResult = 'completed' | 'cancelled';
export type RecoveryKeyHandler = (formatted: string) => Promise<void>;

class CeremonyCancelled extends Error {
  constructor() {
    super('Recovery key ceremony cancelled');
    this.name = 'CeremonyCancelled';
  }
}

export interface RecoveryKeyCeremony {
  phase: CeremonyPhase;
  /** 只在 show / confirm 阶段有值 */
  recoveryKey: string | null;
  /**
   * 执行一个会调用 onRecoveryKey 的服务层方法。
   * 正常完成返回 'completed',用户取消返回 'cancelled',其他错误原样抛出。
   */
  run(action: (onRecoveryKey: RecoveryKeyHandler) => Promise<void>): Promise<CeremonyResult>;
  /** show → confirm */
  proceedToConfirm(): void;
  /** confirm → show */
  backToShow(): void;
  /** 回填校验通过后调用。只有 confirm 阶段有效 */
  confirmed(): void;
  /** 放弃。show / confirm 阶段有效,服务层什么都不会写 */
  cancel(): void;
}

export function useRecoveryKeyCeremony(): RecoveryKeyCeremony {
  const [phase, setPhaseState] = useState<CeremonyPhase>('idle');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  // phase 的同步镜像:事件处理函数要读"此刻"的阶段,不能读上一次渲染时的闭包
  const phaseRef = useRef<CeremonyPhase>('idle');
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);

  const setPhase = useCallback((next: CeremonyPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 用户离开了页面:让还在等待的服务层调用整体取消,不能留着一个永远不会 resolve 的 Promise
      pending.current?.reject(new CeremonyCancelled());
    };
  }, []);

  const run = useCallback<RecoveryKeyCeremony['run']>(
    async action => {
      if (running.current) throw new Error('Recovery key ceremony is already running');
      running.current = true;
      setPhase('working');
      try {
        await action(
          formatted =>
            new Promise<void>((resolve, reject) => {
              // 服务层在页面已经离开之后才调用回调(例如 KDF 跑得比用户离开慢):直接取消,不展示给没人看的页面
              if (!mounted.current) {
                reject(new CeremonyCancelled());
                return;
              }
              pending.current = { resolve, reject };
              setRecoveryKey(formatted);
              setPhase('show');
            })
        );
        return 'completed';
      } catch (error) {
        if (error instanceof CeremonyCancelled) return 'cancelled';
        throw error;
      } finally {
        pending.current = null;
        running.current = false;
        phaseRef.current = 'idle';
        if (mounted.current) {
          setRecoveryKey(null);
          setPhaseState('idle');
        }
      }
    },
    [setPhase]
  );

  const proceedToConfirm = useCallback(() => {
    if (phaseRef.current === 'show') setPhase('confirm');
  }, [setPhase]);

  const backToShow = useCallback(() => {
    if (phaseRef.current === 'confirm') setPhase('show');
  }, [setPhase]);

  const confirmed = useCallback(() => {
    if (phaseRef.current !== 'confirm') return;
    setPhase('saving');
    pending.current?.resolve();
  }, [setPhase]);

  const cancel = useCallback(() => {
    const current = phaseRef.current;
    if (current !== 'show' && current !== 'confirm') return;
    pending.current?.reject(new CeremonyCancelled());
  }, []);

  return { phase, recoveryKey, run, proceedToConfirm, backToShow, confirmed, cancel };
}
