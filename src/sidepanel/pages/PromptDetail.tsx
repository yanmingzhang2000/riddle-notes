import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Copy, Trash2, Edit } from 'lucide-react';
import { db, Prompt, PromptVersion, Run } from '@db/schema';
import ReactMarkdown from 'react-markdown';

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
      manual: '手动笔记',
    };
    return platformNames[platformId] || platformId;
  };

  const isManualNote = prompt?.type === 'manual';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="meta">加载中...</div>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="meta">笔记未找到</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => navigate('/prompts')}
            className="btn-icon"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="page-title text-lg flex-1">
            {prompt.title}
          </h2>
          {isManualNote && (
            <button
              onClick={() => navigate(`/notes/${id}/edit`)}
              className="btn-icon"
              title="编辑笔记"
            >
              <Edit className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={handleToggleFavorite}
            className="btn-icon"
            title={prompt.isFavorite ? '取消重要标记' : '标记为重要'}
            aria-label={prompt.isFavorite ? '取消重要标记' : '标记为重要'}
          >
            <Bookmark
              className={`w-5 h-5 ${
                prompt.isFavorite ? 'text-gold fill-gold' : 'text-soft'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-4 meta">
          <span className="badge">{getPlatformName(prompt.sourcePlatform)}</span>
          <span>创建于 {formatDate(prompt.createdAt)}</span>
          <span>更新于 {formatDate(prompt.updatedAt)}</span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-parchment">
        {isManualNote ? (
          /* 手动笔记：显示 Markdown 渲染的正文 */
          <div className="note-prose max-w-3xl mx-auto">
            <ReactMarkdown>{prompt.content || ''}</ReactMarkdown>
          </div>
        ) : (
          <>
            {/* 提问 */}
            {currentVersion && (
              <div className="mb-6 max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-ink">提问</h3>
                  <button
                    onClick={handleCopyPrompt}
                    className="btn-secondary text-xs px-2 py-1 min-h-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制</span>
                  </button>
                </div>

                <div className="paper-panel">
                  <pre className="whitespace-pre-wrap text-sm text-brown font-mono">
                    {currentVersion.content}
                  </pre>
                </div>
              </div>
            )}

            {/* AI 回复 */}
            <div className="max-w-3xl mx-auto">
              <h3 className="text-base font-semibold text-ink mb-3">AI 回复</h3>

              {runs.length === 0 ? (
                <p className="text-sm meta">暂无 AI 回复</p>
              ) : (
                <div className="space-y-3">
                  {runs.map(run => (
                    <div key={run.id} className="paper-panel paper-panel--seal">
                      {runs.length > 1 && (
                        <p className="text-xs meta mb-2">{formatDate(run.createdAt)}</p>
                      )}
                      <div className="whitespace-pre-wrap break-words text-sm text-brown">
                        {run.outputText}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer Actions */}
      <footer className="p-4 border-t border-line bg-aged/20">
        <button
          onClick={handleDelete}
          className="flex items-center gap-2 px-4 py-2 text-seal hover:text-ink hover:bg-aged/50 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          删除
        </button>
      </footer>
    </div>
  );
};

export default PromptDetail;
