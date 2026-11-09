import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Star, MoreVertical, ExternalLink, Copy } from 'lucide-react';
import { db, Prompt } from '@db/schema';

const PromptList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrompts();
  }, [searchParams]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      let allPrompts = await db.prompts.orderBy('updatedAt').reverse().toArray();

      // 应用搜索筛选
      const searchQuery = searchParams.get('search');
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        allPrompts = allPrompts.filter(p => 
          p.title.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query)
        );
      }

      // 应用文件夹筛选
      const folderId = searchParams.get('folder');
      if (folderId) {
        allPrompts = allPrompts.filter(p => p.folderId === parseInt(folderId));
      }

      // 应用收藏筛选
      const filter = searchParams.get('filter');
      if (filter === 'favorite') {
        allPrompts = allPrompts.filter(p => p.isFavorite);
      }

      // 应用最近收藏筛选（最近7天）
      if (filter === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        allPrompts = allPrompts.filter(p => new Date(p.createdAt) >= sevenDaysAgo);
      }

      // 应用待改进筛选
      if (filter === 'improve') {
        // 查找评分低于3的运行记录
        const lowRatingRuns = await db.runs.where('rating').below(3).toArray();
        const promptIds = new Set(lowRatingRuns.map(r => r.promptId));
        allPrompts = allPrompts.filter(p => promptIds.has(p.id!));
      }

      // 应用平台筛选
      const platform = searchParams.get('platform');
      if (platform) {
        allPrompts = allPrompts.filter(p => p.sourcePlatform === platform);
      }

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
        <h2 className="text-2xl font-bold text-gray-900">全部 Prompt</h2>
        <p className="text-sm text-gray-500 mt-1">{prompts.length} 个 Prompt</p>
      </header>

      {/* Prompt List */}
      <div className="flex-1 overflow-y-auto p-6">
        {prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Star className="w-12 h-12 mb-4 text-gray-300" />
            <p className="text-lg font-medium">还没有收藏的 Prompt</p>
            <p className="text-sm mt-2">在 ChatGPT 中点击星标按钮开始收藏</p>
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
                  <h3 className="text-lg font-semibold text-gray-900 flex-1">
                    {prompt.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    {prompt.isFavorite && (
                      <Star className="w-4 h-4 text-yellow-500 fill-current" />
                    )}
                    <button className="p-1 hover:bg-gray-100 rounded">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>

                {prompt.description && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {prompt.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-3">
                    <span className="badge badge-blue">
                      {getPlatformName(prompt.sourcePlatform)}
                    </span>
                    <span>{formatDate(prompt.updatedAt)}</span>
                  </div>
                  <button
                    onClick={(e) => handleCopyPrompt(e, prompt.id!)}
                    className="p-1 hover:bg-gray-100 rounded"
                    title="复制 Prompt 内容"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
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
