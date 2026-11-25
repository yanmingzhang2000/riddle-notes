import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { getDefaultVaultRuntime, type VaultRuntime } from '../runtime';

const VaultRuntimeContext = createContext<VaultRuntime | null>(null);

interface VaultRuntimeProviderProps {
  /** 不传就用真实环境的单例。测试里传自己建的 runtime */
  runtime?: VaultRuntime;
  children: ReactNode;
}

/**
 * 必须包住整个 App,而不是只包 /vault 路由:
 * 用户解锁保险箱后切到笔记页,自动锁定的空闲检查和活动追踪仍要继续运行。
 * 只包 /vault 的话,离开保险箱页面监听就停了,保险箱会一直保持解锁。
 */
export function VaultRuntimeProvider({ runtime, children }: VaultRuntimeProviderProps) {
  const value = useMemo(() => runtime ?? getDefaultVaultRuntime(), [runtime]);

  // start() 返回停止函数,正好当 effect 的清理函数。StrictMode 下 mount → cleanup → mount 也是安全的
  useEffect(() => value.start(), [value]);

  return <VaultRuntimeContext.Provider value={value}>{children}</VaultRuntimeContext.Provider>;
}

export function useVaultRuntime(): VaultRuntime {
  const runtime = useContext(VaultRuntimeContext);
  if (!runtime) throw new Error('useVaultRuntime must be used inside VaultRuntimeProvider');
  return runtime;
}
