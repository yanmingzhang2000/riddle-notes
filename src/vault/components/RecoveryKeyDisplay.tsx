import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadRecoveryKeyFile } from './recovery-key-file';
import { splitRecoveryKey } from './recovery-key-groups';

/**
 * 展示 Recovery Key。每一组旁边标出序号,下一步回填校验会说"请输入第 N 组"。
 *
 * 只提供下载,不提供"复制"按钮:这把密钥不需要主密码就能打开保险箱,
 * 一键复制会让它进入剪贴板历史,甚至被同步到其他设备。
 */
export function RecoveryKeyDisplay({ recoveryKey }: { recoveryKey: string }) {
  const { prefix, groups } = splitRecoveryKey(recoveryKey);
  const [download, setDownload] = useState<'idle' | 'done' | 'failed'>('idle');

  const handleDownload = () => {
    try {
      downloadRecoveryKeyFile(recoveryKey);
      setDownload('done');
    } catch {
      setDownload('failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-1">
        <p className="font-medium">这把恢复密钥只会显示这一次。</p>
        <p>
          忘记主密码时，只有它能打开保险箱。主密码和恢复密钥都丢失，保险箱里的内容将永久无法找回。
        </p>
      </div>

      <div role="group" aria-label="恢复密钥" className="bg-paper border border-line p-4 space-y-3">
        <p className="eyebrow">{prefix}</p>
        <div className="grid grid-cols-4 gap-x-3 gap-y-2 font-mono text-base text-ink">
          {groups.map((group, index) => (
            <div key={index} data-group-index={index + 1} className="flex items-baseline gap-1.5">
              <span className="meta w-4 text-right">{index + 1}</span>
              <span>{group}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button type="button" className="btn-secondary text-xs px-3 py-1.5 min-h-0" onClick={handleDownload}>
          <Download size={14} aria-hidden="true" />
          下载为 .txt 文件
        </button>
        {download === 'done' && (
          <p role="status" className="text-xs text-soft">
            已下载。请保存到离线或可信的地方，不要和加密备份放在一起。
          </p>
        )}
        {download === 'failed' && (
          <p role="alert" className="text-xs text-seal">
            下载失败。请把上面的恢复密钥抄写下来。
          </p>
        )}
      </div>
    </div>
  );
}
