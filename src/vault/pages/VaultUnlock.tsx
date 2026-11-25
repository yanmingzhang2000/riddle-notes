import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { VaultPage } from '../components/VaultPage';
import { describeVaultError } from '../error-messages';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { useVaultStatus } from '../hooks/useVaultStatus';
import { vaultReturnPath } from './return-path';

/**
 * 用主密码解锁。
 *
 * 不使用 <form>,原因同 VaultSetup:避免浏览器弹出"保存密码"。输入框只写一个 autoComplete="off"。
 * 解锁成功之后不在这里跳转,而是等会话打开、状态变成 unlocked,由下面的 effect 统一处理:
 * 这样从别的窗口发来的解锁(同一个浏览器里)也走同一条路。
 */
export default function VaultUnlock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { service } = useVaultRuntime();
  const { status, refresh } = useVaultStatus();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unlocked') navigate(vaultReturnPath(location.state), { replace: true });
    else if (status === 'uninitialized') navigate('/vault/setup', { replace: true });
  }, [status, location.state, navigate]);

  if (status === 'loading' || status === 'unlocked' || status === 'uninitialized') {
    return (
      <VaultPage title="解锁保险箱">
        <p role="status" className="text-sm text-soft">
          正在检查…
        </p>
      </VaultPage>
    );
  }

  if (status === 'error') {
    return (
      <VaultPage title="解锁保险箱">
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>读取保险箱失败。你的数据没有被改动，请重试。</p>
          <button type="button" className="btn-secondary" onClick={refresh}>
            重试
          </button>
        </div>
      </VaultPage>
    );
  }

  const unlock = async () => {
    if (busy || password === '') return;
    setBusy(true);
    setError(null);
    try {
      await service.unlockWithMasterPassword(password);
      setPassword('');
    } catch (caught) {
      setError(describeVaultError(caught, 'master'));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void unlock();
    }
  };

  return (
    <VaultPage title="解锁保险箱" onBack={() => navigate('/prompts')}>
      <div className="space-y-5">
        <div>
          <label htmlFor="unlock-password" className="block text-sm font-medium text-brown mb-2">
            主密码
          </label>
          <input
            id="unlock-password"
            type="password"
            className="input"
            value={password}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={error !== null}
            aria-describedby={error ? 'unlock-error' : undefined}
          />
          {error && (
            <p id="unlock-error" role="alert" className="text-xs text-seal mt-1">
              {error}
            </p>
          )}
        </div>

        <button type="button" className="btn-primary" disabled={busy || password === ''} onClick={() => void unlock()}>
          {busy ? '正在解锁…' : '解锁'}
        </button>

        <p className="meta">
          忘记主密码？
          <Link to="/vault/recover" className="underline ml-1">
            使用恢复密钥
          </Link>
        </p>
      </div>
    </VaultPage>
  );
}
