import { useSyncExternalStore } from 'react';
import type { VaultSession } from '../services/vault-session';
import { useVaultRuntime } from './VaultRuntimeProvider';

export interface VaultSessionState {
  session: VaultSession;
  /** 每次锁定、解锁都会变。想在会话变化时重置本地状态,把它放进依赖或 key */
  epoch: number;
  isOpen: boolean;
}

/** 订阅会话的开关。epoch 变化时组件重新渲染 */
export function useVaultSession(): VaultSessionState {
  const { session } = useVaultRuntime();
  const epoch = useSyncExternalStore(session.subscribe, session.getEpoch);
  return { session, epoch, isOpen: session.isOpen() };
}
