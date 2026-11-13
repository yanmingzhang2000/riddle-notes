/**
 * 更新管理服务
 * 
 * 实现 PRD 第10章的更新检查、提醒和通知功能
 */

import { db } from '../db/schema';
import { 
  UpdateManifest, 
  UpdateCheckResult, 
  UpdateCheckOptions, 
  UpdateCheckError, 
  UpdateError,
  VersionComparison,
  AppSettingsData
} from './update-types';

/**
 * 更新管理服务
 */
export class UpdateService {
  private static instance: UpdateService;
  private readonly CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24小时
  private readonly DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/yanmingzhang2000/sidecar/main/update-manifest.json';
  private currentVersion: string;
  private isChecking = false;
  private checkTimer?: number;

  private constructor() {
    // 从 manifest.json 读取当前版本
    this.currentVersion = chrome.runtime.getManifest().version;
  }

  public static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService();
    }
    return UpdateService.instance;
  }

  /**
   * 获取当前应用设置
   */
  public async getAppSettings(): Promise<AppSettingsData> {
    try {
      const settings = await db.appSettings.get(1);
      
      if (!settings) {
        // 创建默认设置
        return {
          updateCheckEnabled: true,
          updateManifestUrl: this.DEFAULT_MANIFEST_URL,
        };
      }

      return {
        updateCheckEnabled: settings.updateCheckEnabled,
        lastUpdateCheckAt: settings.lastUpdateCheckAt,
        lastNotifiedVersion: settings.lastNotifiedVersion,
        lastDismissedVersion: settings.lastDismissedVersion,
        updateManifestUrl: settings.updateManifestUrl,
      };
    } catch (error) {
      console.error('[UpdateService] Failed to get app settings:', error);
      return {
        updateCheckEnabled: true,
        updateManifestUrl: this.DEFAULT_MANIFEST_URL,
      };
    }
  }

  /**
   * 更新应用设置
   */
  public async updateAppSettings(settings: Partial<AppSettingsData>): Promise<void> {
    try {
      const existingSettings = await db.appSettings.get(1);
      const now = new Date();

      if (existingSettings) {
        await db.appSettings.update(1, {
          ...settings,
          updatedAt: now,
        });
      } else {
        await db.appSettings.add({
          updateCheckEnabled: true,
          updateManifestUrl: this.DEFAULT_MANIFEST_URL,
          createdAt: now,
          updatedAt: now,
          ...settings,
        });
      }

      // 如果更新了 URL 或启用了检查，重新调度定时检查
      if (settings.updateManifestUrl || settings.updateCheckEnabled !== undefined) {
        this.scheduleNextCheck();
      }
    } catch (error) {
      console.error('[UpdateService] Failed to update app settings:', error);
      throw new Error('更新应用设置失败');
    }
  }

  /**
   * 获取更新清单
   */
  public async fetchUpdateManifest(manifestUrl?: string): Promise<UpdateManifest> {
    try {
      const settings = await this.getAppSettings();
      const url = manifestUrl || settings.updateManifestUrl;

      if (!url) {
        throw new Error('更新清单URL未配置');
      }

      // 确保使用 HTTPS
      if (!url.startsWith('https://')) {
        throw new Error('更新清单必须使用HTTPS');
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const manifest = await response.json();

      // 验证清单格式
      this.validateUpdateManifest(manifest);

      return manifest;
    } catch (error) {
      console.error('[UpdateService] Failed to fetch update manifest:', error);
      throw this.createUpdateError('manifest_unavailable', '无法获取更新清单', true);
    }
  }

  /**
   * 验证更新清单格式
   */
  private validateUpdateManifest(manifest: any): manifest is UpdateManifest {
    const requiredFields = [
      'latestVersion',
      'publishedAt',
      'releaseNotes',
      'downloadUrl',
      'minSupportedVersion',
      'isMandatory',
    ];

    for (const field of requiredFields) {
      if (manifest[field] === undefined) {
        throw new Error(`更新清单缺少必需字段: ${field}`);
      }
    }

    // 验证版本号格式
    if (!this.isValidVersion(manifest.latestVersion)) {
      throw new Error('最新版本号格式无效');
    }

    if (!this.isValidVersion(manifest.minSupportedVersion)) {
      throw new Error('最低支持版本号格式无效');
    }

    // 验证下载URL
    if (!manifest.downloadUrl.startsWith('https://')) {
      throw new Error('下载地址必须使用HTTPS');
    }

    return true;
  }

  /**
   * 检查更新
   */
  public async checkForUpdates(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
    if (this.isChecking && !options.forceCheck) {
      throw new Error('更新检查正在进行中');
    }

    try {
      this.isChecking = true;
      const settings = await this.getAppSettings();

      // 检查是否启用更新检查
      if (!settings.updateCheckEnabled && !options.forceCheck) {
        throw this.createUpdateError('check_disabled', '更新检查已禁用', false);
      }

      // 检查缓存（24小时内不重复检查）
      const now = new Date();
      if (settings.lastUpdateCheckAt && !options.ignoreCache && !options.forceCheck) {
        const timeSinceLastCheck = now.getTime() - settings.lastUpdateCheckAt.getTime();
        if (timeSinceLastCheck < this.CHECK_INTERVAL_MS) {
          // 返回缓存的检查结果（如果需要可以重新获取）
          return {
            hasUpdate: false,
            currentVersion: this.currentVersion,
            latestVersion: this.currentVersion,
            isMandatory: false,
            isBelowMinSupported: false,
            releaseNotes: '',
            downloadUrl: '',
            publishedAt: '',
            minSupportedVersion: '',
            lastCheckAt: settings.lastUpdateCheckAt,
          };
        }
      }

      // 获取更新清单
      const manifest = await this.fetchUpdateManifest();

      // 比较版本
      const comparison = this.compareVersions(this.currentVersion, manifest);

      // 更新最后检查时间
      await this.updateAppSettings({
        lastUpdateCheckAt: now,
      });

      const result: UpdateCheckResult = {
        hasUpdate: comparison.hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion: manifest.latestVersion,
        isMandatory: comparison.isMandatory,
        isBelowMinSupported: comparison.isBelowMinSupported,
        releaseNotes: manifest.releaseNotes,
        downloadUrl: manifest.downloadUrl,
        publishedAt: manifest.publishedAt,
        minSupportedVersion: manifest.minSupportedVersion,
        lastCheckAt: now,
      };

      // 如果需要显示通知
      if (options.showNotification !== false && result.hasUpdate) {
        await this.handleUpdateNotification(result);
      }

      return result;
    } catch (error) {
      console.error('[UpdateService] Update check failed:', error);
      throw error;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 比较版本
   */
  private compareVersions(currentVersion: string, manifest: UpdateManifest): VersionComparison {
    const current = this.parseVersion(currentVersion);
    const latest = this.parseVersion(manifest.latestVersion);
    const minSupported = this.parseVersion(manifest.minSupportedVersion);

    const hasUpdate = this.isVersionGreater(latest, current);
    const isBelowMinSupported = this.isVersionLess(current, minSupported);
    const isMandatory = manifest.isMandatory || isBelowMinSupported;

    return {
      hasUpdate,
      isMandatory,
      isBelowMinSupported,
      currentVersion,
      latestVersion: manifest.latestVersion,
      minSupportedVersion: manifest.minSupportedVersion,
    };
  }

  /**
   * 处理更新通知
   */
  private async handleUpdateNotification(result: UpdateCheckResult): Promise<void> {
    try {
      const settings = await this.getAppSettings();

      // 检查是否已经通知过此版本
      if (settings.lastNotifiedVersion === result.latestVersion) {
        console.log('[UpdateService] Already notified for this version');
        return;
      }

      // 检查用户是否已忽略此版本
      if (settings.lastDismissedVersion === result.latestVersion) {
        console.log('[UpdateService] User dismissed this version');
        return;
      }

      // 发送消息给侧边栏显示更新提示
      await this.sendUpdateNotificationToSidebar(result);

      // 更新最后通知版本
      await this.updateAppSettings({
        lastNotifiedVersion: result.latestVersion,
      });
    } catch (error) {
      console.error('[UpdateService] Failed to handle update notification:', error);
    }
  }

  /**
   * 发送更新通知到侧边栏
   */
  private async sendUpdateNotificationToSidebar(result: UpdateCheckResult): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_AVAILABLE',
        payload: {
          title: `RiddleNote v${result.latestVersion} 已发布`,
          message: result.releaseNotes,
          version: result.latestVersion,
          isMandatory: result.isMandatory,
          downloadUrl: result.downloadUrl,
          showRemindLater: true,
          showDismiss: !result.isMandatory,
        },
      });
    } catch (error) {
      console.error('[UpdateService] Failed to send update notification:', error);
    }
  }

  /**
   * 用户点击"稍后提醒"
   */
  public async remindLater(version: string): Promise<void> {
    try {
      await this.updateAppSettings({
        lastDismissedVersion: version,
      });

      // 24小时后重新检查
      this.scheduleNextCheck(24 * 60 * 60 * 1000);
    } catch (error) {
      console.error('[UpdateService] Failed to set remind later:', error);
      throw error;
    }
  }

  /**
   * 用户忽略此版本更新
   */
  public async dismissUpdate(version: string): Promise<void> {
    try {
      await this.updateAppSettings({
        lastDismissedVersion: version,
        lastNotifiedVersion: version,
      });
    } catch (error) {
      console.error('[UpdateService] Failed to dismiss update:', error);
      throw error;
    }
  }

  /**
   * 启动定时检查
   */
  public async startPeriodicChecks(): Promise<void> {
    try {
      const settings = await this.getAppSettings();
      
      if (!settings.updateCheckEnabled) {
        console.log('[UpdateService] Update checks are disabled');
        return;
      }

      // 清除现有定时器
      if (this.checkTimer) {
        clearTimeout(this.checkTimer);
      }

      // 立即执行一次检查
      this.checkForUpdates({ showNotification: true }).catch(error => {
        console.error('[UpdateService] Initial update check failed:', error);
      });

      // 调度下一次检查
      this.scheduleNextCheck();
    } catch (error) {
      console.error('[UpdateService] Failed to start periodic checks:', error);
    }
  }

  /**
   * 调度下一次检查
   */
  private scheduleNextCheck(delayMs?: number): void {
    // 清除现有定时器
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    const delay = delayMs || this.CHECK_INTERVAL_MS;
    
    this.checkTimer = window.setTimeout(async () => {
      try {
        await this.checkForUpdates({ showNotification: true });
        this.scheduleNextCheck();
      } catch (error) {
        console.error('[UpdateService] Scheduled update check failed:', error);
        // 检查失败时，1小时后重试
        this.scheduleNextCheck(60 * 60 * 1000);
      }
    }, delay);
  }

  /**
   * 停止定时检查
   */
  public stopPeriodicChecks(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 解析版本号
   */
  private parseVersion(version: string): number[] {
    if (!this.isValidVersion(version)) {
      throw new Error(`无效的版本号: ${version}`);
    }

    return version.split('.').map(part => {
      const num = parseInt(part, 10);
      if (isNaN(num)) {
        throw new Error(`版本号包含非数字部分: ${part}`);
      }
      return num;
    });
  }

  /**
   * 验证版本号格式
   */
  private isValidVersion(version: string): boolean {
    return /^\d+(\.\d+)*$/.test(version);
  }

  /**
   * 比较版本号大小
   */
  private isVersionGreater(v1: number[], v2: number[]): boolean {
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const part1 = v1[i] || 0;
      const part2 = v2[i] || 0;
      
      if (part1 > part2) return true;
      if (part1 < part2) return false;
    }
    return false;
  }

  /**
   * 比较版本号大小（小于）
   */
  private isVersionLess(v1: number[], v2: number[]): boolean {
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const part1 = v1[i] || 0;
      const part2 = v2[i] || 0;
      
      if (part1 < part2) return true;
      if (part1 > part2) return false;
    }
    return false;
  }

  /**
   * 创建更新错误
   */
  private createUpdateError(type: UpdateCheckError, message: string, retryable: boolean): UpdateError {
    return {
      type,
      message,
      timestamp: new Date(),
      retryable,
    };
  }

  /**
   * 获取当前版本
   */
  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * 是否正在检查更新
   */
  public getIsChecking(): boolean {
    return this.isChecking;
  }
}