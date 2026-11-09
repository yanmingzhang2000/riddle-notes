import React, { useState } from 'react';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '@db/schema';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [apiConfig, setApiConfig] = useState({
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 保存到 Chrome Storage
      await chrome.storage.local.set({ aiConfig: apiConfig });
      alert('设置已保存');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
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
        {/* AI API Configuration */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            AI 配置
          </h3>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
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

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中...' : '保存设置'}
            </button>
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

        {/* About */}
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            关于
          </h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p>Sidecar MVP v0.1.0</p>
            <p>一键收藏 Prompt 及 AI 输出，本地管理与迭代优化</p>
            <p className="text-xs text-gray-500">
              所有数据保存在浏览器本地 IndexedDB 中
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;
