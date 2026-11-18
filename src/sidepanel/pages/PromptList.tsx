import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Star, Bookmark, Copy, Plus, FileText, MessageSquare } from 'lucide-react';
import { db, Prompt } from '@db/schema';

const PromptList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('全部笔记');
  const [isFiltered, setIsFiltered] = useState(false);

  useEffect(() => {
    loadPrompts();
  }, [searchParams]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      let allPrompts = await db.prompts.orderBy('updatedAt').reverse().toArray();

      const searchQuery = searchParams.get('search');
      const folderId = searchParams.get('folder');
      const filter = searchParams.get('filter');
      const platform = searchParams.get('platform');
      const type = searchParams.get('type');

      // 应用搜索筛选
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        allPrompts = allPrompts.filter(p => 
          p.title.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query)
        );
      }

      // 应用文件夹筛选
      if (folderId) {
        allPrompts = allPrompts.filter(p => p.folderId === parseInt(folderId));
      }

      // 应用重要标记筛选
      if (filter === 'favorite') {
        allPrompts = allPrompts.filter(p => p.isFavorite);
      }

      // 应用最近收集筛选（最近7天）
      if (filter === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        allPrompts = allPrompts.filter(p => new Date(p.createdAt) >= sevenDaysAgo);
      }

      // 历史筛选：评分低于 3 的运行记录。界面已不再提供入口，保留代码以兼容旧链接
      if (filter === 'improve') {
        const lowRatingRuns = await db.runs.where('rating').below(3).toArray();
        const promptIds = new Set(lowRatingRuns.map(r => r.promptId));
        allPrompts = allPrompts.filter(p => promptIds.has(p.id!));
      }

      // 应用平台筛选
      if (platform) {
        allPrompts = allPrompts.filter(p => p.sourcePlatform === platform);
      }

      // 应用类型筛选：手动笔记 vs AI 对话
      if (type === 'manual') {
        allPrompts = allPrompts.filter(p => p.type === 'manual');
      } else if (type === 'ai') {
        allPrompts = allPrompts.filter(p => p.type === 'ai');
      }

      // 页面标题跟随当前筛选
      let nextTitle = '全部笔记';
      if (searchQuery) {
        nextTitle = `搜索「${searchQuery}」`;
      } else if (type === 'manual') {
        nextTitle = '手动笔记';
      } else if (folderId) {
        const folder = await db.folders.get(parseInt(folderId));
        nextTitle = folder?.name ?? '文件夹';
      } else if (filter === 'recent') {
        nextTitle = '最近收集';
      } else if (filter === 'favorite') {
        nextTitle = '重要';
      } else if (filter || platform) {
        nextTitle = '筛选结果';
      }

      setTitle(nextTitle);
      setIsFiltered(Boolean(searchQuery || folderId || filter || platform || type));
      setPrompts(allPrompts);
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePromptClick = (promptId: number) => {
    navigate(`/prompts/${promptId}`);
  };

  const handleCopyPrompt = async (e: React.MouseEvent, promptId: number) => {
    e.stopPropagation();
    try {
      // 获取最新版本的内容
      const versions = await db.promptVersions
        .where('promptId')
        .equals(promptId)
        .reverse()
        .limit(1)
        .toArray();
      
      if (versions.length > 0) {
        await navigator.clipboard.writeText(versions[0].content);
        // TODO: Show toast notification
      }
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    return d.toLocaleDateString('zh-CN');
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
          <button
            onClick={() => navigate('/notes/new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            title="新建手动笔记"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">新建笔记</span>
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{prompts.length} 条笔记</p>
      </header>

      {/* Note List */}
      <div className="flex-1 overflow-y-auto p-6">
        {prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Star className="w-12 h-12 mb-4 text-gray-300" />
            {isFiltered ? (
              <p className="text-lg font-medium">没有找到符合条件的笔记</p>
            ) : (
              <>
                <p className="text-lg font-medium">还没有笔记</p>
                <p className="text-sm mt-2">在 ChatGPT 回复旁点击星标，把值得留下的对话收进来</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {prompts.map(prompt => (
              <div
                key={prompt.id}
                onClick={() => handlePromptClick(prompt.id!)}
                className="bg-white border border-gray-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow prompt-card"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    {prompt.type === 'manual' ? (
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" aria-label="手动笔记" />
                    ) : (
                      <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0" aria-label="AI 对话" />
                    )}
                    <h3 className="text-lg font-semibold text-gray-900">
                      {prompt.title}
                    </h3>
                  </div>
                  {prompt.isFavorite && (
                    <Bookmark
                      className="w-4 h-4 text-yellow-500 fill-current flex-shrink-0"
                      aria-label="重要"
                    />
                  )}
                </div>

                {prompt.description && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {prompt.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-3">
                    {prompt.type !== 'manual' && (
                      <span className="badge badge-blue">
                        {getPlatformName(prompt.sourcePlatform)}
                      </span>
                    )}
                    <span>{formatDate(prompt.updatedAt)}</span>
                  </div>
                  {prompt.type !== 'manual' && (
                    <button
                      onClick={(e) => handleCopyPrompt(e, prompt.id!)}
                      className="p-1 hover:bg-gray-100 rounded"
                      title="复制提问内容"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptList;
