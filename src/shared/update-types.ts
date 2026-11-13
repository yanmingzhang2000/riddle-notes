/**
 * 更新管理相关类型定义
 */

/**
 * 更新清单 JSON 结构
 * 参考 PRD 第10.1节
 */
export interface UpdateManifest {
  latestVersion: string;
  publishedAt: string;
  releaseNotes: string;
  downloadUrl: string;
  minSupportedVersion: string;
  isMandatory: boolean;
}

/**
 * 更新检查结果
 */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  isMandatory: boolean;
  isBelowMinSupported: boolean;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: string;
  minSupportedVersion: string;
  lastCheckAt: Date;
}

/**
 * 更新通知状态
 */
export interface UpdateNotificationState {
  lastNotifiedVersion?: string;
  lastDismissedVersion?: string;
  lastCheckAt?: Date;
  nextCheckAt?: Date;
  notificationShownAt?: Date;
}

/**
 * 版本比较结果
 */
export interface VersionComparison {
  hasUpdate: boolean;
  isMandatory: boolean;
  isBelowMinSupported: boolean;
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion: string;
}

/**
 * 更新检查选项
 */
export interface UpdateCheckOptions {
  forceCheck?: boolean;
  ignoreCache?: boolean;
  showNotification?: boolean;
}

/**
 * 更新操作类型
 */
export type UpdateAction = 'check' | 'download' | 'install' | 'remindLater' | 'dismiss';

/**
 * 更新检查错误类型
 */
export type UpdateCheckError = 
  | 'network_error'
  | 'manifest_invalid'
  | 'version_invalid'
  | 'manifest_unavailable'
  | 'check_disabled'
  | 'unknown_error';

/**
 * 更新错误详情
 */
export interface UpdateError {
  type: UpdateCheckError;
  message: string;
  timestamp: Date;
  retryable: boolean;
}

/**
 * 应用设置（扩展 AppSettings 接口）
 */
export interface AppSettingsData {
  updateCheckEnabled: boolean;
  lastUpdateCheckAt?: Date;
  lastNotifiedVersion?: string;
  lastDismissedVersion?: string;
  updateManifestUrl: string;
}

/**
 * 侧边栏更新 Banner 数据
 */
export interface UpdateBannerData {
  title: string;
  message: string;
  version: string;
  isMandatory: boolean;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
  showRemindLater: boolean;
  showDismiss: boolean;
}

/**
 * 强制更新提醒数据
 */
export interface MandatoryUpdateData {
  title: string;
  message: string;
  downloadUrl: string;
  minSupportedVersion: string;
  currentVersion: string;
  latestVersion: string;
}

/**
 * 设置页更新信息
 */
export interface SettingsUpdateInfo {
  currentVersion: string;
  lastCheckAt?: Date;
  latestVersion?: string;
  hasUpdate: boolean;
  isChecking: boolean;
  lastError?: UpdateError;
  updateCheckEnabled: boolean;
  updateManifestUrl: string;
}