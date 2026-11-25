import { useState, type KeyboardEvent } from 'react';
import { groupMatches, normalizeGroupInput, pickGroupIndexes, splitRecoveryKey } from './recovery-key-groups';

/** 要求回填几组。技术方案 §6.2:3 组 */
const GROUPS_TO_CONFIRM = 3;

interface RecoveryKeyConfirmProps {
  recoveryKey: string;
  /** 三组全部匹配之后,用户点"继续"时调用 */
  onConfirmed: () => void;
  /** 回去再看一遍 Recovery Key */
  onBack?: () => void;
  /** 抽哪几组。只有测试需要替换 */
  pickIndexes?: (total: number, count: number) => number[];
}

/**
 * Recovery Key 回填校验,用来代替"我已保存"的勾选框:勾选不能证明用户真的抄下来了。
 * 随机抽 3 组让用户输入,全部匹配才启用"继续"。校验在内存里完成。
 *
 * 这个组件不显示 Recovery Key。要抽查的位置在挂载时确定一次,之后不变,
 * 否则用户可以靠刷新这一步换到自己记得的位置。
 */
export function RecoveryKeyConfirm({ recoveryKey, onConfirmed, onBack, pickIndexes }: RecoveryKeyConfirmProps) {
  const { groups } = splitRecoveryKey(recoveryKey);
  const [indexes] = useState(() => (pickIndexes ?? pickGroupIndexes)(groups.length, GROUPS_TO_CONFIRM));
  const [values, setValues] = useState<string[]>(() => indexes.map(() => ''));

  const matches = indexes.map((groupIndex, slot) => groupMatches(values[slot], groups[groupIndex]));
  const allMatch = matches.every(Boolean);

  const setValue = (slot: number, value: string) =>
    setValues(current => current.map((existing, i) => (i === slot ? value : existing)));

  const submit = () => {
    if (allMatch) onConfirmed();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-brown">
        请对照刚才显示的恢复密钥，输入下面指定的几组。这样可以确认你真的保存了它，而不是只点了“已保存”。
      </p>

      <div className="space-y-3">
        {indexes.map((groupIndex, slot) => {
          const id = `recovery-confirm-${groupIndex + 1}`;
          const typed = normalizeGroupInput(values[slot]);
          // 输满 4 个字符还对不上才提示,输到一半不打扰
          const wrong = typed.length >= 4 && !matches[slot];
          return (
            <div key={groupIndex}>
              <label htmlFor={id} className="block text-sm font-medium text-brown mb-2">
                {`第 ${groupIndex + 1} 组`}
              </label>
              <input
                id={id}
                type="text"
                className="input font-mono uppercase tracking-widest"
                value={values[slot]}
                onChange={event => setValue(slot, event.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={wrong}
                aria-describedby={wrong ? `${id}-error` : undefined}
              />
              {wrong && (
                <p id={`${id}-error`} className="text-xs text-seal mt-1">
                  {`与第 ${groupIndex + 1} 组不一致，请再检查一遍`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={!allMatch} onClick={submit}>
          继续
        </button>
        {onBack && (
          <button type="button" className="btn-secondary" onClick={onBack}>
            返回查看恢复密钥
          </button>
        )}
      </div>
    </div>
  );
}
