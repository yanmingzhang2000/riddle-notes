import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Copy, Trash2 } from 'lucide-react';
import { db, Prompt, PromptVersion, Run } from '@db/schema';

const PromptDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
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
      // 加载笔记
      const promptData = await db.prompts.get(promptId);
      if (!promptData) {
        navigate('/prompts');
        return;
      }
      setPrompt(promptData);

      // 提问内容存放在最新版本里。版本历史不再展示，但数据保留
      const versionData = await db.promptVersions
        .where('promptId')
        .equals(promptId)
        .reverse()
        .toArray();
      setCurrentVersion(versionData.length > 0 ? versionData[0] : null);

      // AI 回复存放在 runs.outputText
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
    
    const confirmed = window.confirm('确定要删除这条笔记吗？此操作不可恢复。');
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
        <div className="text-gray-500">笔记未找到</div>
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
            title={prompt.isFavorite ? '取消重要标记' : '标记为重要'}
            aria-label={prompt.isFavorite ? '取消重要标记' : '标记为重要'}
          >
            <Bookmark
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
        {/* 提问 */}
        {currentVersion && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">提问</h3>
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4" />
                复制
              </button>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                {currentVersion.content}
              </pre>
            </div>
          </div>
        )}

        {/* AI 回复 */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">AI 回复</h3>

          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">暂无 AI 回复</p>
          ) : (
            <div className="space-y-3">
              {runs.map(run => (
                <div key={run.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  {runs.length > 1 && (
                    <p className="text-xs text-gray-500 mb-2">{formatDate(run.createdAt)}</p>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm text-gray-700">
                    {run.outputText}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="p-4 border-t border-gray-200 bg-white">
        <button
          onClick={handleDelete}
          className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          删除
        </button>
      </footer>
    </div>
  );
};

export default PromptDetail;
