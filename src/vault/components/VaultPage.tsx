import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface VaultPageProps {
  title: string;
  /** 不传就不显示返回键 */
  onBack?: () => void;
  /** 页头右侧的操作 */
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** 保险箱页面的统一骨架,和 Settings 等现有页面的结构保持一致 */
export function VaultPage({ title, onBack, actions, footer, children }: VaultPageProps) {
  return (
    <div className="h-full flex flex-col">
      <header className="page-header">
        <div className="flex items-center gap-4">
          {onBack && (
            <button type="button" className="btn-icon" aria-label="返回" onClick={onBack}>
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
          <h2 className="page-title text-lg flex-1">{title}</h2>
          {actions}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 bg-parchment">
        <div className="max-w-3xl mx-auto">{children}</div>
      </div>

      {footer && <div className="p-4 border-t border-line bg-aged/20">{footer}</div>}
    </div>
  );
}
