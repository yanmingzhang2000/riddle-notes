import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Save, 
  Download, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Globe,
  Info,
  BarChart2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/schema';
import { UpdateService } from '../../shared/update-service';
import { UpdateCheckResult, UpdateError } from '../../shared/update-types';
import { resetOnboardingState } from '../../shared/onboarding';
import {
  BackupError,
  createBackup,
  describeImport,
  downloadBackupFile,
  exportFileName,
  getBackupCounts,
  hasAnyData,
  parseBackup,
  restoreBackup,
  safetyBackupFileName,
} from '../../shared/backup';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '../../shared/analytics';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  
  // 更新管理状态
  const [currentVersion, setCurrentVersion] = useState<string>('0.1.0');
  const [updateSettings, setUpdateSettings] = useState({
    updateCheckEnabled: true,
    updateManifestUrl: 'https://raw.githubusercontent.com/yanmingzhang2000/sidecar/main/update-manifest.json',
  });
  const [lastCheckResult, setLastCheckResult] = useState<UpdateCheckResult>();
  const [lastCheckError, setLastCheckError] = useState<UpdateError>();
  const [isChecking, setIsChecking] = useState(false);
  
  // Analytics 状态
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);
  
  const updateService = UpdateService.getInstance();

  // 初始化数据
  useEffect(() => {
    const initData = async () => {
      try {
        // 获取当前版本
        setCurrentVersion(updateService.getCurrentVersion());
        
        // 获取应用设置
        const settings = await updateService.getAppSettings();
        setUpdateSettings({
          updateCheckEnabled: settings.updateCheckEnabled,
          updateManifestUrl: settings.updateManifestUrl,
        });
        
        // 获取 analytics 设置
        const analyticsState = await isAnalyticsEnabled();
        setAnalyticsEnabledState(analyticsState);
        
        // 获取之前的检查结果
        const existingSettings = await db.appSettings.get(1);
        if (existingSettings?.lastUpdateCheckAt) {
          setLastCheckResult({
            hasUpdate: false,
            currentVersion: updateService.getCurrentVersion(),
            latestVersion: updateService.getCurrentVersion(),
            isMandatory: false,
            isBelowMinSupported: false,
            releaseNotes: '',
            downloadUrl: '',
            publishedAt: '',
            minSupportedVersion: '',
            lastCheckAt: existingSettings.lastUpdateCheckAt,
          });
        }
      } catch (error) {
        console.error('Failed to initialize settings:', error);
      }
    };

    initData();
  }, [updateService]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 保存更新设置
      await updateService.updateAppSettings({
        updateCheckEnabled: updateSettings.updateCheckEnabled,
        updateManifestUrl: updateSettings.updateManifestUrl,
      });
      
      // 保存 analytics 设置
      await setAnalyticsEnabled(analyticsEnabled);
      
      alert('设置已保存');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      setIsChecking(true);
      setLastCheckError(undefined);
      
      const result = await updateService.checkForUpdates({
        forceCheck: true,
        showNotification: false,
      });
      
      setLastCheckResult(result);
      
      if (result.hasUpdate) {
        const updateMessage = result.isMandatory 
          ? `发现强制更新！当前版本 ${result.currentVersion} 已低于最低支持版本 ${result.minSupportedVersion}。`
          : `发现新版本 v${result.latestVersion}！\n\n${result.releaseNotes}`;
          
        alert(updateMessage);
      } else {
        alert('当前已是最新版本');
      }
    } catch (error) {
      console.error('Update check failed:', error);
      setLastCheckError(error as UpdateError);
      alert(`检查更新失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsChecking(false);
    }
  };

  const handleResetOnboarding = async () => {
    try {
      await resetOnboardingState();
      alert('已重置。下次打开 ChatGPT 时会再次显示新手引导。');
    } catch (error) {
      console.error('Reset onboarding failed:', error);
      alert('重置失败，请重试');
    }
  };

  const handleExport = async () => {
    try {
      const backup = await createBackup(db);
      downloadBackupFile(backup, exportFileName());
      alert(`导出成功！共 ${backup.counts.prompts} 条笔记`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出失败，请重试');
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // 覆盖前自动备份时记下文件名，用于在结果提示里告诉用户
      let safetyFileName: string | null = null;

      try {
        // 1. 先解析和校验文件。到这一步为止不会碰数据库
        const parsed = parseBackup(await file.text());

        // 2. 告诉用户将要发生什么，确认后才继续
        const current = await getBackupCounts(db);
        if (!window.confirm(describeImport(parsed.preview, current))) return;

        // 3. 覆盖前先把现有数据备份成文件，防止导错了文件
        if (hasAnyData(current)) {
          const safetyCopy = await createBackup(db);
          safetyFileName = safetyBackupFileName();
          downloadBackupFile(safetyCopy, safetyFileName);
        }

        // 4. 在一个事务里清空并写入。中途失败会整体回滚，现有数据保持原样
        await restoreBackup(db, parsed.data);

        alert(
          `导入成功！\n` +
          `- 笔记: ${parsed.preview.counts.prompts}\n` +
          `- 文件夹: ${parsed.preview.counts.folders}` +
          (safetyFileName
            ? `\n\n导入前的数据已自动备份，文件 ${safetyFileName} 已下载到浏览器的下载目录。`
            : '')
        );
        // 侧边栏等界面在启动时读取过数据，刷新后才会显示导入的内容
        window.location.reload();
      } catch (error) {
        console.error('Import failed:', error);
        const reason = error instanceof BackupError || error instanceof Error ? error.message : '未知错误';
        alert(
          `导入失败：${reason}\n\n现有数据没有被改动。` +
          (safetyFileName
            ? `\n导入前自动下载的备份文件（${safetyFileName}）没有用上，可以删除。`
            : '')
        );
      }
    };

    input.click();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="page-header">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/prompts')}
            className="btn-icon"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="page-title text-lg">设置</h2>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-parchment">
        {/* Update Management */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
            <Download className="w-5 h-5 text-mapblue" />
            版本与更新
          </h3>

          <div className="paper-panel paper-panel--seal mb-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-seal mt-0.5" />
              <div className="text-sm text-brown">
                <p className="font-medium mb-1">更新说明</p>
                <p className="mb-2">Riddle Notes 支持版本检查和更新提醒。更新清单托管在 GitHub，不会自动安装扩展,需要用户手动下载安装。</p>
                <p>扩展的收藏、搜索和数据管理功能在更新检查失败时仍可正常使用。</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* 版本信息 */}
            <div className="paper-panel">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-ink">当前版本信息</h4>
                <span className="badge badge-gold">
                  v{currentVersion}
                </span>
              </div>
              
              {lastCheckResult && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-soft">最后检查时间</span>
                    <span className="text-brown">
                      {lastCheckResult.lastCheckAt.toLocaleString('zh-CN')}
                    </span>
                  </div>
                  
                  {lastCheckResult.hasUpdate && (
                    <div className={`p-3 rounded ${lastCheckResult.isMandatory ? 'bg-seal/10 border border-seal/30' : 'bg-sage/10 border border-sage/30'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {lastCheckResult.isMandatory ? (
                          <XCircle className="w-4 h-4 text-seal" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-sage" />
                        )}
                        <span className="font-medium text-ink">
                          {lastCheckResult.isMandatory ? '需要强制更新' : '发现新版本'}
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-brown">
                        <p>当前版本: v{lastCheckResult.currentVersion}</p>
                        <p>最新版本: v{lastCheckResult.latestVersion}</p>
                        {lastCheckResult.isMandatory && (
                          <p className="text-seal">
                            最低支持版本: v{lastCheckResult.minSupportedVersion}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 更新设置 */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-brown">
                    启用自动更新检查
                  </label>
                  <button
                    type="button"
                    onClick={() => setUpdateSettings(prev => ({
                      ...prev,
                      updateCheckEnabled: !prev.updateCheckEnabled,
                    }))}
                    className={`switch ${
                      updateSettings.updateCheckEnabled ? 'bg-sage' : 'bg-line'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-paper transition ${
                      updateSettings.updateCheckEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                <p className="text-xs meta">
                  启动时和每24小时自动检查更新
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-brown mb-1">
                  <div className="flex items-center gap-1">
                    <Globe className="w-4 h-4" />
                    更新清单 URL
                  </div>
                </label>
                <input
                  type="text"
                  value={updateSettings.updateManifestUrl}
                  onChange={(e) => setUpdateSettings(prev => ({
                    ...prev,
                    updateManifestUrl: e.target.value,
                  }))}
                  placeholder="https://example.com/update-manifest.json"
                  className="input text-sm"
                />
                <p className="text-xs meta mt-1">
                  必须使用 HTTPS 协议
                </p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={handleCheckForUpdates}
                disabled={isChecking}
                className="flex-1 btn-secondary flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? '检查中...' : '立即检查更新'}
              </button>
              
              {lastCheckResult?.hasUpdate && (
                <button
                  onClick={() => window.open(lastCheckResult.downloadUrl, '_blank')}
                  className="flex-1 btn-primary flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  下载新版本
                </button>
              )}
            </div>

            {/* 错误信息 */}
            {lastCheckError && (
              <div className="paper-panel paper-panel--seal">
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-seal mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-ink">检查更新失败</p>
                    <p className="text-brown">{lastCheckError.message}</p>
                    <p className="text-xs meta mt-1">
                      {lastCheckError.retryable ? '可重试' : '暂时无法重试'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Data Management */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-ink mb-4">
            数据管理
          </h3>

          <div className="space-y-3">
            <button
              onClick={handleExport}
              className="w-full btn-secondary text-left"
            >
              导出所有数据 (JSON)
            </button>
            <button
              onClick={handleImport}
              className="w-full btn-secondary text-left"
            >
              导入数据
            </button>
          </div>
          <p className="text-xs meta mt-2">
            导入会覆盖现有数据。导入前会先自动下载一份现有数据的备份。
          </p>
        </section>

        {/* Onboarding */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-ink mb-4">
            新手引导
          </h3>

          <button
            onClick={handleResetOnboarding}
            className="w-full btn-secondary text-left"
          >
            重新查看引导
          </button>
          <p className="text-xs meta mt-1">
            下次打开支持的 AI 网站时,再次显示首次使用引导
          </p>
        </section>

        {/* Analytics Settings */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-mapblue" />
            数据统计
          </h3>

          <div className="paper-panel paper-panel--seal mb-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-seal mt-0.5" />
              <div className="text-sm text-brown">
                <p className="font-medium mb-1">匿名使用统计</p>
                <p className="mb-2">
                  Riddle Notes 会上报匿名的使用统计（如保存次数、活跃天数），
                  用于改进产品。<strong>你的笔记内容、标题和链接不会被上报。</strong>
                </p>
                <p className="mb-2">
                  上报时会使用一个随机生成的安装 ID（不包含任何个人信息），
                  以及你的 IP 和浏览器信息（用于统计地区和设备类型）。
                </p>
                <p>保险箱相关操作不会被上报。</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-brown">
              允许匿名使用统计
            </label>
            <button
              type="button"
              onClick={() => setAnalyticsEnabledState(!analyticsEnabled)}
              className={`switch ${
                analyticsEnabled ? 'bg-sage' : 'bg-line'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-paper transition ${
                analyticsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
          <p className="text-xs meta mt-1">
            关闭后，扩展仍可正常使用，但我们无法了解产品的使用情况
          </p>
        </section>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-parchment pt-4 border-t border-line">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存所有设置'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;