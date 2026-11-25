import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import { RecoveryKeyRotation } from '../components/RecoveryKeyRotation';
import { VaultPage } from '../components/VaultPage';
import { describeVaultError } from '../error-messages';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { useVaultStatus } from '../hooks/useVaultStatus';
import type { PasswordEvaluation } from '../types';

type Phase = 'form' | 'working' | 'rotate';

/**
 * 用恢复密钥找回访问。分两屏,对应服务层的两步:
 *   第一屏 recoverAccess:输入恢复密钥 + 设置新的主密码。成功后新主密码立即生效,会话已经打开
 *   第二屏 rotateRecoveryKey:重新生成恢复密钥。旧的恢复密钥在这一步完成之前一直有效,
 *                            所以第二屏可以跳过,保险箱里会一直显示提醒(见 VaultShell)
 *
 * 第一步一完成就进入保险箱,不会因为用户在第二屏关掉面板而被锁在外面。
 */
export default function VaultRecover() {
  const navigate = useNavigate();
  const { service } = useVaultRuntime();
  const { status, refresh } = useVaultStatus();

  const [phase, setPhase] = useState<Phase>('form');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [evaluation, setEvaluation] = useState<PasswordEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 只在第一屏、没有在提交时才按状态跳转。recoverAccess 一提交成功会话就打开了,
  // 这时状态变成 unlocked 但我们要停在第二屏,不能被这个 effect 带走
  useEffect(() => {
    if (phase !== 'form') return;
    if (status === 'unlocked') navigate('/vault', { replace: true });
    else if (status === 'uninitialized') navigate('/vault/setup', { replace: true });
  }, [status, phase, navigate]);

  if (phase === 'rotate') {
    const finish = () => navigate('/vault', { replace: true });
    return (
      <VaultPage title="重新生成恢复密钥">
        <div className="space-y-4">
          <p className="eyebrow">第 2 屏，共 2 屏</p>
          <div role="status" className="paper-panel paper-panel--gold p-4 text-sm text-brown space-y-1">
            <p className="font-medium">已找回访问，新的主密码已经生效。</p>
            <p>刚才用到的旧恢复密钥仍然有效。建议现在重新生成一把新的，旧的随即作废。</p>
          </div>
          <RecoveryKeyRotation onDone={finish} onCancel={finish} cancelLabel="稍后再说" />
        </div>
      </VaultPage>
    );
  }

  if (status === 'loading' || status === 'uninitialized' || (status === 'unlocked' && phase === 'form')) {
    return (
      <VaultPage title="使用恢复密钥">
        <p role="status" className="text-sm text-soft">
          正在检查…
        </p>
      </VaultPage>
    );
  }

  if (status === 'error') {
    return (
      <VaultPage title="使用恢复密钥">
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>读取保险箱失败。你的数据没有被改动，请重试。</p>
          <button type="button" className="btn-secondary" onClick={refresh}>
            重试
          </button>
        </div>
      </VaultPage>
    );
  }

  const busy = phase === 'working';
  const mismatch = confirmPassword !== '' && password !== confirmPassword;
  const canRecover =
    !busy && recoveryKey.trim() !== '' && evaluation?.ok === true && password !== '' && password === confirmPassword;

  const recover = async () => {
    if (!canRecover) return;
    setPhase('working');
    setError(null);
    try {
      await service.recoverAccess(recoveryKey, password);
      // 切到第二屏:第一屏整个被卸载,输入框里的恢复密钥和新主密码随组件一起销毁,不用另外清空
      setPhase('rotate');
    } catch (caught) {
      setError(describeVaultError(caught, 'recovery'));
      setPhase('form');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void recover();
    }
  };

  return (
    <VaultPage title="使用恢复密钥" onBack={busy ? undefined : () => navigate('/vault/unlock')}>
      <div className="space-y-5">
        <p className="eyebrow">第 1 屏，共 2 屏</p>
        <div className="paper-panel p-4 text-sm text-brown">
          用恢复密钥设置一个新的主密码。完成后会直接进入保险箱，接着建议重新生成恢复密钥。
        </div>

        <div>
          <label htmlFor="recover-key" className="block text-sm font-medium text-brown mb-2">
            恢复密钥
          </label>
          <input
            id="recover-key"
            type="text"
            className="input font-mono"
            value={recoveryKey}
            onChange={event => setRecoveryKey(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="RN-V1-XXXX-XXXX-…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
          />
        </div>

        <div>
          <label htmlFor="recover-password" className="block text-sm font-medium text-brown mb-2">
            新的主密码
          </label>
          <input
            id="recover-password"
            type="password"
            className="input"
            value={password}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy}
          />
          <div className="mt-2">
            <PasswordStrength password={password} onEvaluated={setEvaluation} />
          </div>
        </div>

        <div>
          <label htmlFor="recover-password-confirm" className="block text-sm font-medium text-brown mb-2">
            再输入一次
          </label>
          <input
            id="recover-password-confirm"
            type="password"
            className="input"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'recover-password-mismatch' : undefined}
          />
          {mismatch && (
            <p id="recover-password-mismatch" className="text-xs text-seal mt-1">
              两次输入不一致
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-xs text-seal">
            {error}
          </p>
        )}

        <button type="button" className="btn-primary" disabled={!canRecover} onClick={() => void recover()}>
          {busy ? '正在找回…' : '找回访问'}
        </button>
      </div>
    </VaultPage>
  );
}
