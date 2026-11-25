import { useCallback, useEffect, useState } from 'react';
import { useVaultSession } from './useVaultSession';
import { useVaultRuntime } from './VaultRuntimeProvider';

/**
 * - loading:还在读库,判断不出是新用户还是老用户
 * - uninitialized:库里没有 wrapper,应当去设置主密码
 * - locked:已初始化,会话没有打开
 * - unlocked:会话已打开
 * - error:读库本身失败。不能当成 uninitialized:那样会把老用户带去"设置主密码"
 */
export type VaultStatus = 'loading' | 'uninitialized' | 'locked' | 'unlocked' | 'error';

type Initialized = boolean | 'error' | null;

export function useVaultStatus(): { status: VaultStatus; refresh: () => void } {
  const { service } = useVaultRuntime();
  const { isOpen } = useVaultSession();
  const [initialized, setInitialized] = useState<Initialized>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // 会话打开本身就说明已经初始化过,不用再读库
    if (isOpen) {
      setInitialized(true);
      return;
    }
    let cancelled = false;
    service.isInitialized().then(
      value => {
        if (!cancelled) setInitialized(value);
      },
      () => {
        if (!cancelled) setInitialized('error');
      }
    );
    return () => {
      cancelled = true;
    };
    // isOpen 变化(包括每次锁定)时重新确认一次;attempt:读库失败后用户点"重试"
  }, [service, isOpen, attempt]);

  const refresh = useCallback(() => {
    setInitialized(null);
    setAttempt(n => n + 1);
  }, []);

  let status: VaultStatus;
  if (isOpen) status = 'unlocked';
  else if (initialized === null) status = 'loading';
  else if (initialized === 'error') status = 'error';
  else status = initialized ? 'locked' : 'uninitialized';

  return { status, refresh };
}
