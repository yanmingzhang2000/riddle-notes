import { useState, type KeyboardEvent } from 'react';
import { describeVaultError } from '../error-messages';
import { useRecoveryRotationRequired } from '../hooks/useRecoveryRotationRequired';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { RecoveryKeyRotation } from './RecoveryKeyRotation';

type TestState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'failed'; message: string };

/**
 * 设置页里和恢复密钥有关的两件事:
 *   - 重新生成(需要主密码,流程见 RecoveryKeyRotation)。用恢复密钥找回访问之后,这里有一条不能关掉的提示;
 *   - 检查一把恢复密钥是否有效("Test Recovery Key"):只验证,不改任何数据,不会让保险箱解锁或锁定。
 */
export function RecoveryKeySettings() {
  const { service } = useVaultRuntime();
  const { required, refresh } = useRecoveryRotationRequired();
  const [rotating, setRotating] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const check = async () => {
    if (testInput.trim() === '' || test.kind === 'checking') return;
    setTest({ kind: 'checking' });
    try {
      await service.verifyRecoveryKey(testInput);
      // 验证通过就不需要再留着它了
      setTestInput('');
      setTest({ kind: 'ok' });
    } catch (caught) {
      setTest({ kind: 'failed', message: describeVaultError(caught, 'recovery') });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void check();
    }
  };

  return (
    <div className="space-y-5">
      {required && (
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-1">
          <p className="font-medium">还没有重新生成恢复密钥</p>
          <p>你是用恢复密钥找回访问的，它仍然能打开这个保险箱。请重新生成一把新的，旧的随即作废。</p>
        </div>
      )}

      <div className="paper-panel p-4 space-y-3">
        <h4 className="font-medium text-ink">重新生成恢复密钥</h4>
        {rotating ? (
          <RecoveryKeyRotation
            onDone={() => {
              setRotating(false);
              refresh();
            }}
            onCancel={() => setRotating(false)}
          />
        ) : (
          <>
            <p className="text-sm text-brown">生成之后，旧的恢复密钥会失效。需要输入主密码。</p>
            <button type="button" className="btn-secondary" onClick={() => setRotating(true)}>
              重新生成恢复密钥
            </button>
          </>
        )}
      </div>

      <div className="paper-panel p-4 space-y-3">
        <h4 className="font-medium text-ink">检查恢复密钥</h4>
        <p className="text-sm text-brown">确认你保存的那一把还能用。只做检查，不会修改任何内容。</p>
        <div>
          <label htmlFor="test-recovery-key" className="block text-sm font-medium text-brown mb-2">
            要检查的恢复密钥
          </label>
          <input
            id="test-recovery-key"
            type="text"
            className="input font-mono"
            value={testInput}
            onChange={event => {
              setTestInput(event.target.value);
              setTest({ kind: 'idle' });
            }}
            onKeyDown={handleKeyDown}
            placeholder="RN-V1-XXXX-XXXX-…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={test.kind === 'checking'}
          />
        </div>
        {test.kind === 'ok' && (
          <p role="status" className="text-xs text-soft">
            这把恢复密钥有效，可以用它打开这个保险箱。
          </p>
        )}
        {test.kind === 'failed' && (
          <p role="alert" className="text-xs text-seal">
            {test.message}
          </p>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={test.kind === 'checking' || testInput.trim() === ''}
          onClick={() => void check()}
        >
          {test.kind === 'checking' ? '正在检查…' : '检查这把恢复密钥'}
        </button>
      </div>
    </div>
  );
}
