import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Star, Copy, Edit, History, Trash2, ExternalLink } from 'lucide-react';
import { db, Prompt, PromptVersion, Run } from '@db/schema';

const PromptDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentVersion, setCurrentVersion] = useState<PromptVersion | null>(null);

  useEffect(() => {
    if (id) {
      loadPromptData(parseInt(id));
    }
  }, [id]);

  const loadPromptData = async (promptId: number) => {
    setLoading(true);
    try {
      // 加载 Prompt
      const promptData = await db.prompts.get(promptId);
      if (!promptData) {
        navigate('/prompts');
        return;
      }
      setPrompt(promptData);

      // 加载版本
      const versionData = await db.promptVersions
        .where('promptId')
        .equals(promptId)
        .reverse()
        .toArray();
      setVersions(versionData);

      // 设置当前版本（最新的）
      if (versionData.length > 0) {
        setCurrentVersion(versionData[0]);
      }

      // 加载运行记录
      const runData = await db.runs
        .where('promptId')
        .equals(promptId)
        .reverse()
        .toArray();
      setRuns(runData);
    } catch (error) {
      console.error('Failed to load prompt:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (currentVersion) {
      try {
        await navigator.clipboard.writeText(currentVersion.content);
        // TODO: Show toast
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  const handleToggleFavorite = async () => {
    if (prompt) {
      await db.prompts.update(prompt.id!, {
        isFavorite: !prompt.isFavorite,
        updatedAt: new Date(),
      });
      setPrompt({ ...prompt, isFavorite: !prompt.isFavorite });
    }
  };

  const handleDelete = async () => {
    if (!prompt) return;
    
    const confirmed = window.confirm('确定要删除这个 Prompt 吗？此操作不可恢复。');
    if (confirmed) {
      // 发送消息到后台删除
      chrome.runtime.sendMessage({
        type: 'DELETE_PROMPT',
        payload: { promptId: prompt.id },
      }, (response) => {
        if (response?.success) {
          navigate('/prompts');
        }
      });
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN');
  };

  const getPlatformName = (platformId: string) => {
    const platformNames: Record<string, string> = {
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      gemini: 'Gemini',
      workbuddy: 'WorkBuddy',
    };
    return platformNames[platformId] || platformId;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Prompt 未找到</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => navigate('/prompts')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900 flex-1">
            {prompt.title}
          </h2>
          <button
            onClick={handleToggleFavorite}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <Star
              className={`w-5 h-5 ${
                prompt.isFavorite ? 'text-yellow-500 fill-current' : 'text-gray-400'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="badge badge-blue">{getPlatformName(prompt.sourcePlatform)}</span>
          <span>创建于 {formatDate(prompt.createdAt)}</span>
          <span>更新于 {formatDate(prompt.updatedAt)}</span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Current Version */}
        {currentVersion && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">
                当前版本 (v{currentVersion.versionNumber})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  复制
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
                  <Edit className="w-4 h-4" />
                  编辑
                </button>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                {currentVersion.content}
              </pre>
            </div>

            {currentVersion.changeNote && (
              <p className="text-sm text-gray-500 mt-2">
                修改说明: {currentVersion.changeNote}
              </p>
            )}
          </div>
        )}

        {/* Run History */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            运行记录 ({runs.length})
          </h3>

          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">暂无运行记录</p>
          ) : (
            <div className="space-y-3">
              {runs.map((run, index) => (
                <div key={run.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">
                      运行 #{index + 1}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(run.createdAt)}</span>
                  </div>
                  
                  <div className="mb-2">
                    <p className="text-xs text-gray-500 mb-1">输出:</p>
                    <div className="bg-gray-50 rounded p-2 text-sm text-gray-700 line-clamp-3">
                      {run.outputText}
                    </div>
                  </div>

                  {run.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-yellow-500 fill-current" />
                      <span className="text-xs text-gray-600">{run.rating}/5</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Version History */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            版本历史 ({versions.length})
          </h3>

          {versions.length <= 1 ? (
            <p className="text-sm text-gray-500">暂无历史版本</p>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <button
                  key={version.id}
                  onClick={() => setCurrentVersion(version)}
                  className={`w-full text-left bg-white border rounded-lg p-3 transition-colors ${
                    currentVersion?.id === version.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      v{version.versionNumber}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(version.createdAt)}
                    </span>
                  </div>
                  {version.changeNote && (
                    <p className="text-xs text-gray-600 mt-1">{version.changeNote}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            删除
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <History className="w-4 h-4" />
            查看完整历史
          </button>
        </div>
      </footer>
    </div>
  );
};

export default PromptDetail;
