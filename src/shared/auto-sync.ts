/**
 * 自动同步管理器
 * 
 * 功能：
 * - 自动同步：数据变更后延迟上传
 * - 离线队列：离线时标记待同步，恢复后自动上传
 * - 冲突检测：启动时检查版本冲突
 * - 密钥缓存：减少 PBKDF2 计算
 */

import { uploadSnapshot, downloadLatestSnapshot, getLatestVersion, getCurrentUserEmail, ConflictError } from './sync-service';
import { createBackup } from './backup';
import { db } from '../db/schema';

// Storage 键定义
const STORAGE_KEYS = {
  SYNC_ENABLED: 'sync_enabled',
  SYNC_PENDING_UPLOAD: 'sync_pending_upload',
  SYNC_LAST_SYNCED_VERSION: 'sync_last_synced_version',
  SYNC_LOCAL_LAST_MODIFIED: 'sync_local_last_modified',
  SYNC_CACHED_PASSPHRASE: 'sync_cached_passphrase', // 仅内存缓存，不持久化
} as const;

// 同步配置
const SYNC_CONFIG = {
  DEBOUNCE_DELAY: 5000, // 5 秒 debounce
  MAX_RETRY: 3,
  RETRY_DELAY: 2000,
} as const;

/**
 * 自动同步管理器（单例）
 */
class AutoSyncManager {
  private static instance: AutoSyncManager;
  
  private uploadTimer: number | null = null;
  private isUploading = false;
  private retryCount = 0;
  
  // 内存中的口令缓存（service-worker 重启时清空）
  private cachedPassphrase: string | null = null;
  
  private constructor() {
    this.setupNetworkListener();
  }
  
  static getInstance(): AutoSyncManager {
    if (!AutoSyncManager.instance) {
      AutoSyncManager.instance = new AutoSyncManager();
    }
    return AutoSyncManager.instance;
  }
  
  /**
   * 检查是否已启用自动同步
   */
  async isEnabled(): Promise<boolean> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_ENABLED);
    return result[STORAGE_KEYS.SYNC_ENABLED] ?? true; // 默认启用
  }
  
  /**
   * 启用/禁用自动同步
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_ENABLED]: enabled });
    
    if (!enabled && this.uploadTimer) {
      clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
    }
  }
  
  /**
   * 缓存同步口令（仅内存）
   */
  cachePassphrase(passphrase: string): void {
    this.cachedPassphrase = passphrase;
  }
  
  /**
   * 清除口令缓存
   */
  clearPassphraseCache(): void {
    this.cachedPassphrase = null;
  }
  
  /**
   * 获取缓存的口令
   */
  getCachedPassphrase(): string | null {
    return this.cachedPassphrase;
  }
  
  /**
   * 检查是否有缓存的口令
   */
  hasPassphraseCache(): boolean {
    return this.cachedPassphrase !== null;
  }
  
  /**
   * 标记本地数据已修改
   */
  async markLocalModified(): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SYNC_LOCAL_LAST_MODIFIED]: new Date().toISOString(),
    });
  }
  
  /**
   * 标记待上传（离线时使用）
   */
  async markPendingUpload(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: true });
  }
  
  /**
   * 清除待上传标记
   */
  async clearPendingUpload(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_PENDING_UPLOAD]: false });
  }
  
  /**
   * 检查是否有待上传的数据
   */
  async hasPendingUpload(): Promise<boolean> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_PENDING_UPLOAD);
    return result[STORAGE_KEYS.SYNC_PENDING_UPLOAD] ?? false;
  }
  
  /**
   * 数据变更后触发自动同步（debounce）
   */
  async scheduleAutoSync(): Promise<void> {
    // 检查是否启用自动同步
    if (!(await this.isEnabled())) {
      console.debug('[AutoSync] Auto sync is disabled');
      return;
    }
    
    // 检查是否已登录
    const email = await getCurrentUserEmail();
    if (!email) {
      console.debug('[AutoSync] Not logged in, skip auto sync');
      return;
    }
    
    // 检查是否有缓存的口令
    if (!this.hasPassphraseCache()) {
      console.debug('[AutoSync] No cached passphrase, skip auto sync');
      await this.markPendingUpload();
      return;
    }
    
    // 标记本地修改
    await this.markLocalModified();
    
    // Debounce：清除之前的定时器
    if (this.uploadTimer) {
      clearTimeout(this.uploadTimer);
    }
    
    // 延迟上传
    this.uploadTimer = setTimeout(() => {
      this.performAutoUpload();
    }, SYNC_CONFIG.DEBOUNCE_DELAY) as unknown as number;
    
    console.debug('[AutoSync] Scheduled auto upload in 5s');
  }
  
  /**
   * 执行自动上传
   */
  private async performAutoUpload(): Promise<void> {
    if (this.isUploading) {
      console.debug('[AutoSync] Already uploading, skip');
      return;
    }
    
    try {
      this.isUploading = true;
      
      // 检查网络
      if (!navigator.onLine) {
        console.debug('[AutoSync] Offline, mark as pending');
        await this.markPendingUpload();
        return;
      }
      
      // 获取缓存的口令
      const passphrase = this.getCachedPassphrase();
      if (!passphrase) {
        console.debug('[AutoSync] No cached passphrase');
        await this.markPendingUpload();
        return;
      }
      
      // 获取上次同步的版本号
      const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION);
      const lastVersion = result[STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION] ?? 0;
      
      // 创建备份
      const backup = await createBackup(db);
      
      // 上传
      const newVersion = await uploadSnapshot(backup, passphrase, lastVersion);
      
      // 更新同步版本号
      await chrome.storage.local.set({
        [STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION]: newVersion,
      });
      
      // 清除待上传标记
      await this.clearPendingUpload();
      
      console.log(`[AutoSync] Auto upload success, version: v${newVersion}`);
      
      // 重置重试计数
      this.retryCount = 0;
    } catch (error) {
      console.error('[AutoSync] Auto upload failed:', error);
      
      if (error instanceof ConflictError) {
        // 冲突：通知用户
        await this.notifyConflict(error.remoteVersion);
      } else if (!navigator.onLine) {
        // 离线：标记待上传
        await this.markPendingUpload();
      } else {
        // 其他错误：重试
        await this.retryUpload();
      }
    } finally {
      this.isUploading = false;
    }
  }
  
  /**
   * 重试上传
   */
  private async retryUpload(): Promise<void> {
    if (this.retryCount >= SYNC_CONFIG.MAX_RETRY) {
      console.error('[AutoSync] Max retry reached, mark as pending');
      await this.markPendingUpload();
      this.retryCount = 0;
      return;
    }
    
    this.retryCount++;
    console.debug(`[AutoSync] Retry upload (${this.retryCount}/${SYNC_CONFIG.MAX_RETRY})`);
    
    setTimeout(() => {
      this.performAutoUpload();
    }, SYNC_CONFIG.RETRY_DELAY * this.retryCount);
  }
  
  /**
   * 通知用户版本冲突
   */
  private async notifyConflict(remoteVersion: number): Promise<void> {
    // 创建通知
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: 'Riddle Notes - 同步冲突',
      message: `云端有更新的版本 v${remoteVersion}。请打开设置页面解决冲突。`,
      priority: 2,
    });
    
    // 标记待上传
    await this.markPendingUpload();
  }
  
  /**
   * 网络恢复时处理待上传数据
   */
  private setupNetworkListener(): void {
    // 监听网络状态变化
    if (typeof window !== 'undefined') {
      window.addEventListener('online', async () => {
        console.log('[AutoSync] Network online, checking pending uploads');
        
        if (await this.hasPendingUpload()) {
          await this.scheduleAutoSync();
        }
      });
    }
  }
  
  /**
   * 扩展启动时检查冲突
   */
  async checkConflictOnStartup(): Promise<boolean> {
    try {
      // 检查是否已登录
      const email = await getCurrentUserEmail();
      if (!email) {
        return false;
      }
      
      // 检查网络
      if (!navigator.onLine) {
        console.debug('[AutoSync] Offline on startup');
        return false;
      }
      
      // 获取本地版本号
      const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION);
      const localVersion = result[STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION] ?? 0;
      
      // 获取云端版本号
      const remoteVersion = await getLatestVersion();
      
      if (remoteVersion > localVersion) {
        console.warn(`[AutoSync] Conflict detected: local v${localVersion}, remote v${remoteVersion}`);
        
        // 通知用户
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon-128.png'),
          title: 'Riddle Notes - 有云端更新',
          message: `云端有更新的版本 v${remoteVersion}。建议下载最新数据。`,
          priority: 1,
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[AutoSync] Check conflict failed:', error);
      return false;
    }
  }
  
  /**
   * 手动触发同步（立即上传）
   */
  async manualSync(passphrase: string): Promise<number> {
    // 缓存口令
    this.cachePassphrase(passphrase);
    
    // 获取上次同步的版本号
    const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION);
    const lastVersion = result[STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION] ?? 0;
    
    // 创建备份
    const backup = await createBackup(db);
    
    // 上传
    const newVersion = await uploadSnapshot(backup, passphrase, lastVersion);
    
    // 更新同步版本号
    await chrome.storage.local.set({
      [STORAGE_KEYS.SYNC_LAST_SYNCED_VERSION]: newVersion,
    });
    
    // 清除待上传标记
    await this.clearPendingUpload();
    
    console.log(`[AutoSync] Manual sync success, version: v${newVersion}`);
    
    return newVersion;
  }
}

export const autoSyncManager = AutoSyncManager.getInstance();
export { STORAGE_KEYS };
