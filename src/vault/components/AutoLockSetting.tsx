import { useEffect, useState } from 'react';
import { describeVaultError } from '../error-messages';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { AUTO_LOCK_TIMEOUT_OPTIONS, type AutoLockTimeoutMs } from '../types';

/** 取值清单在 types.ts(AUTO_LOCK_TIMEOUT_OPTIONS),这里只写显示名。Record 的键由类型保证不会漏档 */
const LABELS: Record<AutoLockTimeoutMs, string> = {
  60_000: '1 分钟',
  300_000: '5 分钟',
  900_000: '15 分钟',
  0: '从不',
};

/**
 * 自动锁定时间:1 / 5 / 15 分钟 / 从不。
 * 本面板立即生效;别的面板收到通知后自己重新读,不会被锁定。
 */
export function AutoLockSetting() {
  const { service, session } = useVaultRuntime();
  const [value, setValue] = useState<AutoLockTimeoutMs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      service.getAutoLockTimeout().then(
        loaded => {
          if (!cancelled) setValue(loaded);
        },
        caught => {
          if (!cancelled) setError(describeVaultError(caught));
        }
      );
    };
    load();
    // 别的面板改了:跟着变,界面上显示的才是真正生效的值
    const stopListening = session.onSettingsChanged(load);
    return () => {
      cancelled = true;
      stopListening();
    };
  }, [service, session]);

  const choose = async (next: AutoLockTimeoutMs) => {
    // 不用判断 next === value:点已经选中的 radio,浏览器不会触发 onChange
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await service.setAutoLockTimeout(next);
      setValue(next);
    } catch (caught) {
      // 没保存成功:界面上保持原来的选择,和实际生效的一致
      setError(describeVaultError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="space-y-3" disabled={saving}>
      <legend className="sr-only">自动锁定</legend>
      <p className="text-sm text-brown">无操作超过所选时间后自动锁定。关闭侧边栏会立即锁定。</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="自动锁定时间">
        {AUTO_LOCK_TIMEOUT_OPTIONS.map(option => (
          <label key={option} className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="radio"
              name="vault-auto-lock"
              checked={value === option}
              onChange={() => void choose(option)}
              disabled={value === null}
            />
            {LABELS[option]}
          </label>
        ))}
      </div>
      {value === 0 && (
        <p className="meta">选择“从不”之后，只有关闭侧边栏或手动锁定才会锁定保险箱。</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-seal">
          {error}
        </p>
      )}
    </fieldset>
  );
}
