/**
 * Vault 使用独立的 Dexie 数据库 RiddleVaultDB,不放进 SidecarDB。见技术方案 §3.1。
 *
 *  - SidecarDB 升级失败不会连带 Vault,反过来也一样。
 *  - 对 SidecarDB 调 delete()(例如将来的"重置数据库")不会误删 Vault。
 *  - 现有 createBackup / restoreBackup 用显式表名,Notes 的导入导出和搜索碰不到 Vault 表。
 *
 * vaultSnapshot 在 v1 就建好:发布前加进 v1 不需要迁移,发布后再加就要 v2。
 * 未初始化的判定:vaultKeys 里没有 'singleton' 记录。
 */
import Dexie, { Table } from 'dexie';
import type { VaultKeys, VaultRecord, VaultSettings, VaultSnapshot } from '../vault/types';

export const VAULT_DB_NAME = 'RiddleVaultDB';

export class RiddleVaultDB extends Dexie {
  vaultKeys!: Table<VaultKeys, string>;
  vaultSettings!: Table<VaultSettings, string>;
  vaultRecords!: Table<VaultRecord, string>;
  vaultSnapshot!: Table<VaultSnapshot, string>;

  /** name 参数只给测试用,生产代码一律用 vaultDb 单例 */
  constructor(name: string = VAULT_DB_NAME) {
    super(name);

    this.version(1).stores({
      vaultKeys: 'id',
      vaultSettings: 'id',
      vaultRecords: 'id, type, updatedAt',
      vaultSnapshot: 'id',
    });
  }
}

export const vaultDb = new RiddleVaultDB();

export async function isVaultInitialized(database: RiddleVaultDB = vaultDb): Promise<boolean> {
  return (await database.vaultKeys.get('singleton')) !== undefined;
}
