import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { VaultError } from '../crypto/errors';
import { PasswordStrength } from '../components/PasswordStrength';
import { RecoveryKeyConfirm } from '../components/RecoveryKeyConfirm';
import { RecoveryKeyDisplay } from '../components/RecoveryKeyDisplay';
import { VaultPage } from '../components/VaultPage';
import { describeVaultError } from '../error-messages';
import { useRecoveryKeyCeremony } from '../hooks/useRecoveryKeyCeremony';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { useVaultStatus } from '../hooks/useVaultStatus';
import type { PasswordEvaluation } from '../types';

/**
 * 创建保险箱,四步,状态全在内存里:
 *   1 说明   2 设置主密码   3 显示恢复密钥   4 回填确认
 * 回填校验通过之前数据库里什么都没有(见 useRecoveryKeyCeremony):中途离开、取消、出错,都不会留下半个保险箱。
 *
 * 不使用 <form>:提交一个 type=password 的表单会让浏览器弹出"保存密码"提示,
 * 和"主密码不持久化"冲突。用 onClick 和 Enter 键处理。
 */
export default function VaultSetup() {
  const navigate = useNavigate();
  const { service } = useVaultRuntime();
  const { status, refresh } = useVaultStatus();
  const ceremony = useRecoveryKeyCeremony();

  const [started, setStarted] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [evaluation, setEvaluation] = useState<PasswordEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 已经创建过:不该停在这里。流程进行中不跳转,否则会把用户从恢复密钥那一步带走
  useEffect(() => {
    if (ceremony.phase !== 'idle') return;
    if (status === 'unlocked') navigate('/vault', { replace: true });
    else if (status === 'locked') navigate('/vault/unlock', { replace: true });
  }, [status, ceremony.phase, navigate]);

  if (status === 'loading') {
    return (
      <VaultPage title="创建保险箱">
        <p role="status" className="text-sm text-soft">
          正在检查…
        </p>
      </VaultPage>
    );
  }

  if (status === 'error') {
    return (
      <VaultPage title="创建保险箱">
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>读取保险箱状态失败，所以现在不能判断是否需要创建。请重试。</p>
          <button type="button" className="btn-secondary" onClick={refresh}>
            重试
          </button>
        </div>
      </VaultPage>
    );
  }

  const busy = ceremony.phase === 'working';
  const mismatch = confirmPassword !== '' && password !== confirmPassword;
  // 空密码的评估一定不是 ok,所以不用单独判断空串。
  // 流程进行中(phase 不是 idle)不能再触发:ceremony.run 会因为并发而抛错,界面上会闪出一条假的错误
  const canCreate = evaluation?.ok === true && password === confirmPassword && ceremony.phase === 'idle';

  const create = async () => {
    if (!canCreate) return;
    setError(null);
    setNotice(null);
    try {
      const result = await ceremony.run(onRecoveryKey => service.initialize(password, onRecoveryKey));
      if (result === 'cancelled') {
        setNotice('已取消，没有创建保险箱。');
        return;
      }
      // 不在这里跳转:会话已经打开,状态变成 unlocked,上面的 effect 会带用户进保险箱
      setPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setError(describeVaultError(caught));
      // 别的窗口已经创建了:重新读一次状态,上面的 effect 会把用户带去解锁页
      if (caught instanceof VaultError && caught.kind === 'already-initialized') refresh();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void create();
    }
  };

  // —— 第 3 步:显示恢复密钥 ——
  if (ceremony.phase === 'show' && ceremony.recoveryKey) {
    return (
      <VaultPage title="创建保险箱">
        <div className="space-y-4">
          <p className="eyebrow">第 3 步，共 4 步</p>
          <h3 className="font-display text-base font-semibold text-ink">保存你的恢复密钥</h3>
          <RecoveryKeyDisplay recoveryKey={ceremony.recoveryKey} />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" onClick={ceremony.proceedToConfirm}>
              我已保存，下一步
            </button>
            <button type="button" className="btn-secondary" onClick={ceremony.cancel}>
              取消创建
            </button>
          </div>
        </div>
      </VaultPage>
    );
  }

  // —— 第 4 步:回填确认。这一步不再显示恢复密钥,否则"回填"就成了抄一遍 ——
  if ((ceremony.phase === 'confirm' || ceremony.phase === 'saving') && ceremony.recoveryKey) {
    return (
      <VaultPage title="创建保险箱">
        <div className="space-y-4">
          <p className="eyebrow">第 4 步，共 4 步</p>
          <h3 className="font-display text-base font-semibold text-ink">确认你保存了恢复密钥</h3>
          {ceremony.phase === 'saving' ? (
            <p role="status" className="text-sm text-soft">
              正在创建保险箱…
            </p>
          ) : (
            <>
              <RecoveryKeyConfirm
                recoveryKey={ceremony.recoveryKey}
                onConfirmed={ceremony.confirmed}
                onBack={ceremony.backToShow}
              />
              <button type="button" className="btn-secondary" onClick={ceremony.cancel}>
                取消创建
              </button>
            </>
          )}
        </div>
      </VaultPage>
    );
  }

  // —— 第 1 步:说明 ——
  if (!started) {
    return (
      <VaultPage title="创建保险箱" onBack={() => navigate('/prompts')}>
        <div className="space-y-4">
          <p className="eyebrow">第 1 步，共 4 步</p>
          <h3 className="font-display text-base font-semibold text-ink">先了解几件事</h3>
          <div className="paper-panel paper-panel--gold p-4 text-sm text-brown space-y-2">
            <p>主密码用来解锁保险箱。它不会被保存，忘记之后无法找回。</p>
            <p>下一步会生成一把恢复密钥，只显示一次。忘记主密码时，只有它能打开保险箱。</p>
            <p>主密码和恢复密钥都丢失，保险箱里的内容将永久无法找回。</p>
            <p>内容加密之后只保存在这个浏览器里。</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setStarted(true)}>
            我知道了，开始设置
          </button>
        </div>
      </VaultPage>
    );
  }

  // —— 第 2 步:设置主密码 ——
  return (
    <VaultPage title="创建保险箱" onBack={busy ? undefined : () => setStarted(false)}>
      <div className="space-y-5">
        <p className="eyebrow">第 2 步，共 4 步</p>
        <h3 className="font-display text-base font-semibold text-ink">设置主密码</h3>

        <div>
          <label htmlFor="setup-password" className="block text-sm font-medium text-brown mb-2">
            主密码
          </label>
          <input
            id="setup-password"
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
          <label htmlFor="setup-password-confirm" className="block text-sm font-medium text-brown mb-2">
            再输入一次
          </label>
          <input
            id="setup-password-confirm"
            type="password"
            className="input"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'setup-password-mismatch' : undefined}
          />
          {mismatch && (
            <p id="setup-password-mismatch" className="text-xs text-seal mt-1">
              两次输入不一致
            </p>
          )}
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

        <button type="button" className="btn-primary" disabled={!canCreate} onClick={() => void create()}>
          {busy ? '正在生成恢复密钥…' : '下一步'}
        </button>
      </div>
    </VaultPage>
  );
}
