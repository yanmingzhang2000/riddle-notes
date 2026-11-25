import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';

/** 隐藏时显示的固定占位。长度固定,不泄露秘密有多长 */
export const SECRET_PLACEHOLDER = '••••••••';

export const COPIED_NOTICE = '已复制，请注意及时清除剪贴板';
const COPIED_NOTICE_MS = 4000;

interface SecretFieldProps {
  label: string;
  value: string;
  /**
   * 换了一条记录时,"已显示"要自动复位。传记录的 id。
   * 不用 effect 复位:那样换记录的那一帧会把新记录的明文闪出来。
   */
  resetKey: string;
}

/**
 * 隐藏时渲染固定占位,点"显示"才把明文渲染成文本节点。
 * 不用 <input value={secret}>:那样明文会进入输入框的值,可能被浏览器的自动填充、
 * 扩展、或"检查元素"之外的途径读到,并且 type 切换时行为不一致。
 *
 * 不记录"最后复制的内容",也不自动清剪贴板:没有 clipboardRead 权限就无法确认剪贴板里
 * 还是不是这个秘密,盲目清空会冲掉用户后来复制的东西;而记在模块变量里的明文在锁定后还会留在内存里。
 */
export function SecretField({ label, value, resetKey }: SecretFieldProps) {
  const [reveal, setReveal] = useState({ forKey: resetKey, shown: false });
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  // resetKey 变了就在渲染期间把状态清掉。React 会在提交之前立刻用新状态重新渲染,
  // 带着旧状态的这一次输出不会上屏,所以不会闪出一帧明文;
  // 并且切走再切回来时,不会因为"上次显示过"又自动变回显示
  if (reveal.forKey !== resetKey) setReveal({ forKey: resetKey, shown: false });
  const revealed = reveal.shown;

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), COPIED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <div>
      <div className="flex items-start gap-2">
        <div
          className="flex-1 min-h-[40px] px-3 py-2 bg-paper border border-line text-ink font-mono text-sm whitespace-pre-wrap break-all"
          data-revealed={revealed}
        >
          {revealed ? value : SECRET_PLACEHOLDER}
        </div>
        <button
          type="button"
          className="btn-icon"
          aria-label={`${revealed ? '隐藏' : '显示'}${label}`}
          onClick={() => setReveal({ forKey: resetKey, shown: !revealed })}
        >
          {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="btn-icon" aria-label={`复制${label}`} onClick={handleCopy}>
          <Copy size={16} aria-hidden="true" />
        </button>
      </div>
      {copy === 'copied' && (
        <p role="status" className="text-xs text-soft mt-1">
          {COPIED_NOTICE}
        </p>
      )}
      {copy === 'failed' && (
        <p role="alert" className="text-xs text-seal mt-1">
          复制失败，浏览器没有允许访问剪贴板
        </p>
      )}
    </div>
  );
}
