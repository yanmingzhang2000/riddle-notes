import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Save, 
  AlertCircle, 
  Download, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Globe,
  Shield,
  Info
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/schema';
import { UpdateService } from '../../shared/update-service';
import { UpdateCheckResult, UpdateError } from '../../shared/update-types';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [apiConfig, setApiConfig] = useState({
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4',
  });
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
      // 保存 AI 配置到 Chrome Storage
      await chrome.storage.local.set({ aiConfig: apiConfig });
      
      // 保存更新设置
      await updateService.updateAppSettings({
        updateCheckEnabled: updateSettings.updateCheckEnabled,
        updateManifestUrl: updateSettings.updateManifestUrl,
      });
      
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

  const handleExport = async () => {
    try {
      // 导出所有数据
      const folders = await db.folders.toArray();
      const tags = await db.tags.toArray();
      const prompts = await db.prompts.toArray();
      const promptVersions = await db.promptVersions.toArray();
      const runs = await db.runs.toArray();
      const attachments = await db.attachments.toArray();

      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        folders,
        tags,
        prompts,
        promptVersions,
        runs,
        attachments,
      };

      // 创建下载
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sidecar-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      alert(`导出成功！共 ${prompts.length} 个 Prompt`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出失败，请重试');
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // 校验数据结构
        if (!data.version || !data.exportedAt) {
          throw new Error('无效的导出文件格式');
        }

        if (!Array.isArray(data.prompts)) {
          throw new Error('数据结构不正确：缺少 prompts 数组');
        }

        // 确认导入
        const confirmed = window.confirm(
          `即将导入 ${data.prompts.length} 个 Prompt，是否继续？\n\n注意：现有数据将被覆盖。`
        );

        if (!confirmed) return;

        // 清空现有数据
        await db.folders.clear();
        await db.tags.clear();
        await db.prompts.clear();
        await db.promptVersions.clear();
        await db.runs.clear();
        await db.attachments.clear();

        // 导入新数据
        if (data.folders?.length > 0) await db.folders.bulkAdd(data.folders);
        if (data.tags?.length > 0) await db.tags.bulkAdd(data.tags);
        if (data.prompts?.length > 0) await db.prompts.bulkAdd(data.prompts);
        if (data.promptVersions?.length > 0) await db.promptVersions.bulkAdd(data.promptVersions);
        if (data.runs?.length > 0) await db.runs.bulkAdd(data.runs);
        if (data.attachments?.length > 0) await db.attachments.bulkAdd(data.attachments);

        alert(
          `导入成功！\n` +
          `- 文件夹: ${data.folders?.length || 0}\n` +
          `- Prompt: ${data.prompts?.length || 0}\n` +
          `- 版本: ${data.promptVersions?.length || 0}\n` +
          `- 运行记录: ${data.runs?.length || 0}`
        );
      } catch (error) {
        console.error('Import failed:', error);
        alert(`导入失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    };

    input.click();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/prompts')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">设置</h2>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Update Management */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-600" />
            版本与更新
          </h3>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">更新说明</p>
                <p className="mb-2">RiddleNote 支持版本检查和更新提醒。更新清单托管在 GitHub，不会自动安装扩展，需要用户手动下载安装。</p>
                <p>扩展的收藏、搜索和数据管理功能在更新检查失败时仍可正常使用。</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* 版本信息 */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-gray-900">当前版本信息</h4>
                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                  v{currentVersion}
                </span>
              </div>
              
              {lastCheckResult && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">最后检查时间</span>
                    <span className="text-gray-900">
                      {lastCheckResult.lastCheckAt.toLocaleString('zh-CN')}
                    </span>
                  </div>
                  
                  {lastCheckResult.hasUpdate && (
                    <div className={`p-3 rounded ${lastCheckResult.isMandatory ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {lastCheckResult.isMandatory ? (
                          <XCircle className="w-4 h-4 text-red-600" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        )}
                        <span className="font-medium">
                          {lastCheckResult.isMandatory ? '需要强制更新' : '发现新版本'}
                        </span>
                      </div>
                      <div className="text-xs space-y-1">
                        <p>当前版本: v{lastCheckResult.currentVersion}</p>
                        <p>最新版本: v{lastCheckResult.latestVersion}</p>
                        {lastCheckResult.isMandatory && (
                          <p className="text-red-600">
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
                  <label className="text-sm font-medium text-gray-700">
                    启用自动更新检查
                  </label>
                  <button
                    type="button"
                    onClick={() => setUpdateSettings(prev => ({
                      ...prev,
                      updateCheckEnabled: !prev.updateCheckEnabled,
                    }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                      updateSettings.updateCheckEnabled ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      updateSettings.updateCheckEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  启动时和每24小时自动检查更新
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                <p className="text-xs text-gray-500 mt-1">
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
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-red-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-red-800">检查更新失败</p>
                    <p className="text-red-700">{lastCheckError.message}</p>
                    <p className="text-xs text-red-600 mt-1">
                      {lastCheckError.retryable ? '可重试' : '暂时无法重试'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* AI API Configuration */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-600" />
            AI 配置
          </h3>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-purple-600 mt-0.5" />
              <div className="text-sm text-purple-800">
                <p className="font-medium mb-1">隐私说明</p>
                <p>AI 改进功能会将所选内容发送到配置的模型服务商。API Key 仅保存在本地，不会上传到任何服务器。</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Base URL
              </label>
              <input
                type="text"
                value={apiConfig.baseUrl}
                onChange={(e) => setApiConfig({ ...apiConfig, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="input"
              />
              <p className="text-xs text-gray-500 mt-1">
                支持 OpenAI-compatible API
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={apiConfig.apiKey}
                onChange={(e) => setApiConfig({ ...apiConfig, apiKey: e.target.value })}
                placeholder="sk-..."
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                模型
              </label>
              <select
                value={apiConfig.model}
                onChange={(e) => setApiConfig({ ...apiConfig, model: e.target.value })}
                className="input"
              >
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-4-turbo-preview">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="claude-3-opus">Claude 3 Opus</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
              </select>
            </div>
          </div>
        </section>

        {/* Data Management */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
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
        </section>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-white pt-4 border-t border-gray-200">
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