import { useSyncExternalStore } from 'react';
import type { VaultStore, VaultStoreState } from '../services/vault-store';
import { useVaultRuntime } from './VaultRuntimeProvider';

/**
 * 读取解密后的列表和当前这一条的明文。
 * 组件只读这里的数据,不要把它复制进自己的 state:锁定时 store 会同步清空,自己的副本不会。
 */
export function useVaultStore(): VaultStoreState & { store: VaultStore } {
  const { store } = useVaultRuntime();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}
