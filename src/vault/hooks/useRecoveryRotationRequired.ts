import { useCallback, useEffect, useState } from 'react';
import { useVaultRuntime } from './VaultRuntimeProvider';

/**
 * 是否还需要重新生成 Recovery Key(用 Recovery Key 找回访问之后为 true)。
 *
 * required 为 null 表示"还不知道":读取中,或者读取失败。调用方都当成不显示提示处理,
 * 因为这个提示只是提醒,读不出来时不应该挡住用户的其他操作。
 *
 * refreshKey 变化时重新读一次。Shell 传当前路径:用户在设置页重新生成之后离开设置页,提示条随之消失。
 */
export function useRecoveryRotationRequired(refreshKey?: unknown): { required: boolean | null; refresh: () => void } {
  const { service } = useVaultRuntime();
  const [required, setRequired] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    service.isRecoveryRotationRequired().then(
      value => {
        if (!cancelled) setRequired(value);
      },
      () => {
        if (!cancelled) setRequired(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [service, attempt, refreshKey]);

  const refresh = useCallback(() => setAttempt(n => n + 1), []);
  return { required, refresh };
}
