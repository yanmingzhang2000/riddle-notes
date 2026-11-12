import { useState, useEffect, useCallback } from 'react';
import { UpdateBannerData, MandatoryUpdateData, UpdateCheckResult } from '../../shared/update-types';
import { UpdateService } from '../../shared/update-service';

/**
 * 更新管理 hook
 */
export function useUpdateManager() {
  const [updateBannerData, setUpdateBannerData] = useState<UpdateBannerData>();
  const [mandatoryUpdateData, setMandatoryUpdateData] = useState<MandatoryUpdateData>();
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckResult, setLastCheckResult] = useState<UpdateCheckResult>();
  const updateService = UpdateService.getInstance();

  /**
   * 检查更新
   */
  const checkForUpdates = useCallback(async (force = false) => {
    try {
      setIsChecking(true);
      const result = await updateService.checkForUpdates({
        forceCheck: force,
        showNotification: true,
      });
      
      setLastCheckResult(result);
      
      // 如果有强制更新
      if (result.isMandatory) {
        setMandatoryUpdateData({
          title: '当前版本已不再支持，请更新 RiddleNote 后继续使用',
          message: `您的版本 ${result.currentVersion} 已低于最低支持版本 ${result.minSupportedVersion}，请立即更新到最新版本 ${result.latestVersion}。`,
          downloadUrl: result.downloadUrl,
          minSupportedVersion: result.minSupportedVersion,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
        });
        setUpdateBannerData(undefined);
      }
      // 如果有普通更新
      else if (result.hasUpdate) {
        setUpdateBannerData({
          title: `RiddleNote v${result.latestVersion} 已发布`,
          message: result.releaseNotes.split('\n')[0] || '新版本已发布，请及时更新',
          version: result.latestVersion,
          isMandatory: false,
          downloadUrl: result.downloadUrl,
          releaseNotes: result.releaseNotes,
          publishedAt: result.publishedAt,
          showRemindLater: true,
          showDismiss: true,
        });
        setMandatoryUpdateData(undefined);
      } else {
        // 没有更新
        setUpdateBannerData(undefined);
        setMandatoryUpdateData(undefined);
      }

      return result;
    } catch (error) {
      console.error('[useUpdateManager] Update check failed:', error);
      throw error;
    } finally {
      setIsChecking(false);
    }
  }, [updateService]);

  /**
   * 稍后提醒
   */
  const handleRemindLater = useCallback(async (version: string) => {
    try {
      await updateService.remindLater(version);
      setUpdateBannerData(undefined);
    } catch (error) {
      console.error('[useUpdateManager] Failed to set remind later:', error);
      throw error;
    }
  }, [updateService]);

  /**
   * 忽略此版本
   */
  const handleDismiss = useCallback(async (version: string) => {
    try {
      await updateService.dismissUpdate(version);
      setUpdateBannerData(undefined);
    } catch (error) {
      console.error('[useUpdateManager] Failed to dismiss update:', error);
      throw error;
    }
  }, [updateService]);

  /**
   * 下载更新
   */
  const handleDownload = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  /**
   * 初始化更新检查
   */
  useEffect(() => {
    // 启动时检查更新
    checkForUpdates().catch(console.error);
    
    // 启动定时检查
    updateService.startPeriodicChecks();
    
    // 监听来自background的更新消息
    const handleUpdateMessage = (message: any) => {
      if (message.type === 'UPDATE_AVAILABLE') {
        const { payload } = message;
        
        if (payload.isMandatory) {
          setMandatoryUpdateData({
            title: payload.title,
            message: payload.message,
            downloadUrl: payload.downloadUrl,
            minSupportedVersion: '1.0.0', // 需要从manifest获取
            currentVersion: updateService.getCurrentVersion(),
            latestVersion: payload.version,
          });
          setUpdateBannerData(undefined);
        } else {
          setUpdateBannerData({
            ...payload,
            showRemindLater: true,
            showDismiss: true,
          });
          setMandatoryUpdateData(undefined);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleUpdateMessage);

    // 清理函数
    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdateMessage);
      updateService.stopPeriodicChecks();
    };
  }, [checkForUpdates, updateService]);

  /**
   * 获取当前版本
   */
  const getCurrentVersion = useCallback(() => {
    return updateService.getCurrentVersion();
  }, [updateService]);

  return {
    // 状态
    updateBannerData,
    mandatoryUpdateData,
    isChecking,
    lastCheckResult,
    
    // 操作
    checkForUpdates,
    handleRemindLater,
    handleDismiss,
    handleDownload,
    getCurrentVersion,
    
    // 工具函数
    hasUpdate: !!updateBannerData || !!mandatoryUpdateData,
  };
}