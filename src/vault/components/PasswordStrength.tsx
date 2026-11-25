import { useEffect, useRef, useState } from 'react';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { MIN_PASSWORD_LENGTH } from '../services/password-policy';
import type { PasswordEvaluation } from '../types';

/**
 * 主密码强度指示器。初始化、改主密码、恢复三个页面共用。
 *
 * 这里不实现任何规则:评估交给 service.evaluatePassword(),和服务层强制校验用的是同一份,
 * 所以"这里显示合格"和"服务层放行"不会不一致。zxcvbn 是懒加载的,第一次评估才会下载。
 *
 * 评估是异步的:密码一变就先通知父组件 null(评估中),结果回来之后再通知真实结果。
 * 父组件用 evaluation?.ok 决定要不要启用按钮;这只是便利,真正的把关在服务层。
 */

const SCORE_LABELS = ['很弱', '较弱', '一般', '较强', '很强'] as const;

/** zxcvbn 对中文和拼音口令会高估,这条提示一直显示 */
export const PASSWORD_HINT =
  '建议使用长随机口令或随机词组。对中文和拼音口令，这里的强度评估可能偏高。';

type State =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'done'; evaluation: PasswordEvaluation };

interface PasswordStrengthProps {
  password: string;
  /** null 表示"没有可用的评估":输入为空、评估中、或评估失败。父组件都应当当作不合格处理 */
  onEvaluated?: (evaluation: PasswordEvaluation | null) => void;
  /** 停止输入多久之后再评估 */
  debounceMs?: number;
}

export function PasswordStrength({ password, onEvaluated, debounceMs = 250 }: PasswordStrengthProps) {
  const { service } = useVaultRuntime();
  const [state, setState] = useState<State>({ kind: 'idle' });

  // 回调放进 ref:父组件每次渲染都传新函数时,不应该因此重新评估
  const callback = useRef(onEvaluated);
  useEffect(() => {
    callback.current = onEvaluated;
  });

  useEffect(() => {
    if (password === '') {
      setState({ kind: 'idle' });
      callback.current?.(null);
      return;
    }

    setState({ kind: 'pending' });
    callback.current?.(null);

    let cancelled = false;
    const timer = setTimeout(() => {
      service.evaluatePassword(password).then(
        evaluation => {
          if (cancelled) return;
          setState({ kind: 'done', evaluation });
          callback.current?.(evaluation);
        },
        () => {
          // 估算器加载失败:服务层同样会拒绝,所以这里也按不合格处理,不放行。
          // 评估开始时已经通知过父组件 null,这里不用再通知
          if (cancelled) return;
          setState({ kind: 'failed' });
        }
      );
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, service, debounceMs]);

  return (
    <div className="space-y-2" aria-live="polite">
      {state.kind === 'done' && <Meter evaluation={state.evaluation} />}
      <Status state={state} />
      <p className="meta">{PASSWORD_HINT}</p>
    </div>
  );
}

function Meter({ evaluation }: { evaluation: PasswordEvaluation }) {
  const { score, ok } = evaluation;
  const filled = Math.max(score, 1);
  const color = ok ? 'bg-sage' : score >= 2 ? 'bg-gold' : 'bg-seal';
  return (
    <div
      role="meter"
      aria-label="主密码强度"
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={score}
      aria-valuetext={SCORE_LABELS[score]}
      className="flex items-center gap-1"
    >
      {[1, 2, 3, 4].map(segment => (
        <span
          key={segment}
          data-filled={segment <= filled}
          className={`h-1.5 flex-1 rounded-sm ${segment <= filled ? color : 'bg-aged'}`}
        />
      ))}
      <span className="ml-2 text-xs text-soft">{SCORE_LABELS[score]}</span>
    </div>
  );
}

function Status({ state }: { state: State }) {
  switch (state.kind) {
    case 'idle':
      return <p className="text-xs text-soft">{`至少 ${MIN_PASSWORD_LENGTH} 个字符。`}</p>;
    case 'pending':
      return <p className="text-xs text-soft">正在评估强度…</p>;
    case 'failed':
      return (
        <p role="alert" className="text-xs text-seal">
          暂时无法评估强度，所以不能使用这个主密码。请稍后重试。
        </p>
      );
    case 'done': {
      const { ok, issues, length } = state.evaluation;
      if (ok) return <p className="text-xs text-soft">强度合格。</p>;
      return (
        <ul className="text-xs text-seal space-y-0.5">
          {issues.includes('too-short') && (
            <li>{`还差 ${Math.max(MIN_PASSWORD_LENGTH - length, 1)} 个字符，至少需要 ${MIN_PASSWORD_LENGTH} 个`}</li>
          )}
          {issues.includes('too-weak') && <li>太容易被猜到，请换一个更长或更随机的口令</li>}
        </ul>
      );
    }
  }
}
