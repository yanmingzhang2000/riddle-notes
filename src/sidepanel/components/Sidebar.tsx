import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Star,
  FolderOpen,
  BookOpen,
  Clock,
  Bookmark,
  Settings,
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { db, Folder } from '@db/schema';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadFolders();
  }, []);

  // 正在查看某个文件夹时，自动展开文件夹列表，避免当前选中项被折叠起来
  useEffect(() => {
    if (currentView.startsWith('folder-')) {
      setFoldersOpen(true);
    }
  }, [currentView]);

  const loadFolders = async () => {
    const allFolders = await db.folders.orderBy('sortOrder').toArray();
    setFolders(allFolders);
  };

  const navItems = [
    { id: 'all', label: '全部笔记', icon: BookOpen, path: '/prompts' },
    { id: 'manual', label: '手动笔记', icon: FileText, path: '/prompts?type=manual' },
    { id: 'recent', label: '最近收集', icon: Clock, path: '/prompts?filter=recent' },
    { id: 'favorite', label: '重要', icon: Bookmark, path: '/prompts?filter=favorite' },
  ];

  const handleNavClick = (item: typeof navItems[0]) => {
    onViewChange(item.id);
    navigate(item.path);
  };

  const handleFolderClick = (folderId: number) => {
    onViewChange(`folder-${folderId}`);
    navigate(`/prompts?folder=${folderId}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/prompts?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <aside className="w-64 bg-parchment border-r border-line flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-line bg-aged/50">
        <h1 className="text-xl font-bold text-ink flex items-center gap-2">
          <Star className="w-6 h-6 text-gold" />
          <span className="font-display">Riddle Notes</span>
        </h1>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="p-3 border-b border-line bg-aged/20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-soft" />
          <input
            type="text"
            placeholder="搜索笔记..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input text-sm"
          />
        </div>
      </form>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 bg-parchment">
        {/* Main Nav */}
        <div className="mb-6">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = currentView === item.id || location.pathname === item.path;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item)}
                className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Folders（默认折叠） */}
        {folders.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setFoldersOpen(open => !open)}
              aria-expanded={foldersOpen}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-aged/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                {foldersOpen ? (
                  <ChevronDown className="w-3 h-3 text-soft" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-soft" />
                )}
                <span className="eyebrow">
                  文件夹
                </span>
              </span>
              <span className="text-xs text-soft">{folders.length}</span>
            </button>
            {foldersOpen &&
              folders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => handleFolderClick(folder.id!)}
                  className={`nav-item ${currentView === `folder-${folder.id}` ? 'nav-item-active' : ''}`}
                >
                  <FolderOpen className="w-4 h-4" />
                  <span className="text-sm">{folder.name}</span>
                </button>
              ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-line bg-aged/20">
        <button
          onClick={() => navigate('/settings')}
          className="nav-item"
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm">设置</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
