import { useState, type KeyboardEvent } from 'react';
import { describeVaultError } from '../error-messages';
import { useRecoveryKeyCeremony } from '../hooks/useRecoveryKeyCeremony';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { RecoveryKeyConfirm } from './RecoveryKeyConfirm';
import { RecoveryKeyDisplay } from './RecoveryKeyDisplay';

interface RecoveryKeyRotationProps {
  /** 新的恢复密钥已经确认并保存 */
  onDone: () => void;
  /** 不传就不显示取消按钮 */
  onCancel?: () => void;
  cancelLabel?: string;
}

/**
 * 重新生成 Recovery Key:输入主密码 → 显示新的 Key → 回填确认 → 才写库。
 * Recover 的第二屏和 Settings 里的"重新生成"是同一个流程,共用这个组件。
 *
 * 取消或出错时旧的 Recovery Key 继续有效:服务层在回填确认之前什么都不写。
 */
export function RecoveryKeyRotation({ onDone, onCancel, cancelLabel = '取消' }: RecoveryKeyRotationProps) {
  const { service } = useVaultRuntime();
  const ceremony = useRecoveryKeyCeremony();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const start = async () => {
    if (password === '' || ceremony.phase !== 'idle') return;
    setError(null);
    setNotice(null);
    try {
      const result = await ceremony.run(onRecoveryKey => service.rotateRecoveryKey(password, onRecoveryKey));
      if (result === 'cancelled') {
        setNotice('已取消。旧的恢复密钥仍然有效。');
        return;
      }
      // 切到完成界面:输入框整个被卸载,主密码随组件一起销毁,不用另外清空
      setFinished(true);
    } catch (caught) {
      setError(describeVaultError(caught, 'master'));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void start();
    }
  };

  if (finished) {
    return (
      <div className="space-y-4">
        <div role="status" className="paper-panel p-4 text-sm text-brown space-y-1">
          <p className="font-medium">新的恢复密钥已经生效。</p>
          <p>旧的恢复密钥不能再打开这个保险箱。</p>
        </div>
        <button type="button" className="btn-primary" onClick={onDone}>
          完成
        </button>
      </div>
    );
  }

  switch (ceremony.phase) {
    case 'show':
      return (
        <div className="space-y-4">
          <p className="text-sm text-brown">确认保存之后，旧的恢复密钥会立刻失效。</p>
          {ceremony.recoveryKey && <RecoveryKeyDisplay recoveryKey={ceremony.recoveryKey} />}
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" onClick={ceremony.proceedToConfirm}>
              我已保存，下一步
            </button>
            <button type="button" className="btn-secondary" onClick={ceremony.cancel}>
              取消
            </button>
          </div>
        </div>
      );

    case 'confirm':
      return (
        <div className="space-y-4">
          {ceremony.recoveryKey && (
            <RecoveryKeyConfirm
              recoveryKey={ceremony.recoveryKey}
              onConfirmed={ceremony.confirmed}
              onBack={ceremony.backToShow}
            />
          )}
          <button type="button" className="btn-secondary" onClick={ceremony.cancel}>
            取消
          </button>
        </div>
      );

    case 'saving':
      return (
        <p role="status" className="text-sm text-soft">
          正在保存…
        </p>
      );

    default: {
      const busy = ceremony.phase === 'working';
      return (
        <div className="space-y-4">
          <div>
            <label htmlFor="rotation-master-password" className="block text-sm font-medium text-brown mb-2">
              主密码
            </label>
            <input
              id="rotation-master-password"
              type="password"
              className="input"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <p className="meta mt-1">需要主密码才能生成新的恢复密钥。</p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-seal">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-xs text-soft">
              {notice}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || password === ''} onClick={() => void start()}>
              {busy ? '正在生成…' : '生成新的恢复密钥'}
            </button>
            {onCancel && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
                {cancelLabel}
              </button>
            )}
          </div>
        </div>
      );
    }
  }
}
