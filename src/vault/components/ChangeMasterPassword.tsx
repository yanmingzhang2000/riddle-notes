import { useState, type KeyboardEvent } from 'react';
import { describeVaultError } from '../error-messages';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import type { PasswordEvaluation } from '../types';
import { PasswordStrength } from './PasswordStrength';

/**
 * 修改主密码。需要输入当前主密码;新主密码走和创建时同一套强度评估。
 * 不使用 <form>(避免浏览器弹出"保存密码"),用按钮和 Enter 键。
 *
 * 修改成功之后,别的打开着的侧边栏会被锁定(服务层广播),它们需要用新主密码重新解锁。
 */
export function ChangeMasterPassword() {
  const { service } = useVaultRuntime();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [evaluation, setEvaluation] = useState<PasswordEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm !== '' && next !== confirm;
  const canChange = !busy && current !== '' && evaluation?.ok === true && next === confirm;

  const change = async () => {
    if (!canChange) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await service.changeMasterPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (caught) {
      setError(describeVaultError(caught, 'master'));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void change();
    }
  };

  const edit = (setter: (value: string) => void) => (event: { target: { value: string } }) => {
    setter(event.target.value);
    setDone(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="change-current" className="block text-sm font-medium text-brown mb-2">
          当前主密码
        </label>
        <input
          id="change-current"
          type="password"
          className="input"
          value={current}
          onChange={edit(setCurrent)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor="change-new" className="block text-sm font-medium text-brown mb-2">
          新主密码
        </label>
        <input
          id="change-new"
          type="password"
          className="input"
          value={next}
          onChange={edit(setNext)}
          onKeyDown={handleKeyDown}
          autoComplete="new-password"
          spellCheck={false}
          disabled={busy}
        />
        <div className="mt-2">
          <PasswordStrength password={next} onEvaluated={setEvaluation} />
        </div>
      </div>

      <div>
        <label htmlFor="change-confirm" className="block text-sm font-medium text-brown mb-2">
          再输入一次新主密码
        </label>
        <input
          id="change-confirm"
          type="password"
          className="input"
          value={confirm}
          onChange={edit(setConfirm)}
          onKeyDown={handleKeyDown}
          autoComplete="new-password"
          spellCheck={false}
          disabled={busy}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'change-mismatch' : undefined}
        />
        {mismatch && (
          <p id="change-mismatch" className="text-xs text-seal mt-1">
            两次输入不一致
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-seal">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-xs text-soft">
          主密码已修改。其他打开着的侧边栏已被锁定，需要用新主密码重新解锁。
        </p>
      )}

      <button type="button" className="btn-secondary" disabled={!canChange} onClick={() => void change()}>
        {busy ? '正在修改…' : '修改主密码'}
      </button>
    </div>
  );
}
