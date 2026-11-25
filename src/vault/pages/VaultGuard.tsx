import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { VaultPage } from '../components/VaultPage';
import { useRecoveryRotationRequired } from '../hooks/useRecoveryRotationRequired';
import { useVaultRuntime } from '../hooks/VaultRuntimeProvider';
import { useVaultSession } from '../hooks/useVaultSession';
import { useVaultStatus } from '../hooks/useVaultStatus';

/**
 * 守卫:包住所有"必须已初始化且已解锁"的页面(技术方案 §6.3)。
 * setup / unlock / recover 在守卫**外面**,否则未初始化时守卫把人送去 setup,而 setup 又被守卫包着,会死循环。
 *
 * 几个要点:
 *   - loading 时不跳转:还不知道是新用户还是老用户,不能先把人送去"创建保险箱";
 *   - error 时同样不跳转,显示错误和重试:读库失败不等于"还没有创建";
 *   - 已解锁时用 key={epoch} 渲染子页面。每次锁定、重新解锁 epoch 都会变,整个页面被卸载重建,
 *     页面组件里的 state(编辑页表单、已展开的明文、搜索词)随之销毁。
 *     只靠"状态变成 locked 就跳走"不够:如果锁定和重新解锁发生在同一次渲染之间,状态始终是 unlocked,
 *     页面就不会被卸载,上一个会话里的内容会留在屏幕上。
 */
export default function VaultGuard() {
  const { status, refresh } = useVaultStatus();
  const { epoch } = useVaultSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <VaultPage title="保险箱">
        <p role="status" className="text-sm text-soft">
          正在检查…
        </p>
      </VaultPage>
    );
  }

  if (status === 'error') {
    return (
      <VaultPage title="保险箱">
        <div role="alert" className="paper-panel paper-panel--seal p-4 text-sm text-brown space-y-3">
          <p>读取保险箱失败。你的数据没有被改动，请重试。</p>
          <button type="button" className="btn-secondary" onClick={refresh}>
            重试
          </button>
        </div>
      </VaultPage>
    );
  }

  if (status === 'uninitialized') return <Navigate to="/vault/setup" replace />;

  // 带上原路径:解锁之后回到用户本来要去的页面(白名单校验在 vaultReturnPath)
  if (status === 'locked') return <Navigate to="/vault/unlock" replace state={{ from: location.pathname }} />;

  return (
    <UnlockedFrame>
      <Outlet key={epoch} />
    </UnlockedFrame>
  );
}

/** 已解锁时所有保险箱页面共用的外框:顶栏(状态和手动锁定)、恢复密钥提醒、页面本身 */
function UnlockedFrame({ children }: { children: ReactNode }) {
  const { session } = useVaultRuntime();
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-2 border-b border-line bg-aged/30">
        <span className="meta flex items-center gap-1.5">
          <Lock size={12} aria-hidden="true" />
          保险箱已解锁
        </span>
        {/* lock() 会广播:别的打开着的侧边栏也一起锁 */}
        <button type="button" className="btn-secondary text-xs px-3 py-1.5 min-h-0" onClick={() => session.lock()}>
          立即锁定
        </button>
      </div>
      <RotationBanner />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/**
 * 用恢复密钥找回访问之后,旧的恢复密钥仍然有效,直到用户重新生成。这条提醒在保险箱的每个页面都显示,
 * 不能关掉。设置页自己有更详细的提示,所以在那里不重复显示。
 *
 * 以路径为刷新键:用户在设置页完成重新生成、再离开设置页的时候,重新读一次,提醒随之消失。
 */
function RotationBanner() {
  const { pathname } = useLocation();
  const { required } = useRecoveryRotationRequired(pathname);
  if (!required || pathname === '/vault/settings') return null;
  return (
    <aside
      aria-label="恢复密钥提醒"
      className="shrink-0 paper-panel paper-panel--seal mx-6 my-3 p-3 text-sm text-brown flex items-center justify-between gap-3"
    >
      <span>还没有重新生成恢复密钥，旧的恢复密钥仍然有效。</span>
      <Link to="/vault/settings" className="underline shrink-0">
        去重新生成
      </Link>
    </aside>
  );
}
