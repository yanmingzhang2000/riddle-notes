import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import PromptList from './pages/PromptList';
import PromptDetail from './pages/PromptDetail';
import NoteEditor from './pages/NoteEditor';
import Settings from './pages/Settings';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdateManager } from './hooks/useUpdateManager';
import { VaultRuntimeProvider } from '../vault/hooks/VaultRuntimeProvider';
import { vaultRoutes } from '../vault/routes';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<string>('all');
  const updateManager = useUpdateManager();

  return (
    // 保险箱的运行时必须包住整个 App,而不是只包 /vault 路由:
    // 用户解锁后切到笔记页,自动锁定的空闲检查和活动追踪仍要继续运行
    <VaultRuntimeProvider>
    <HashRouter>
      <div className="flex h-screen bg-parchment">
        {/* Sidebar */}
        <Sidebar currentView={currentView} onViewChange={setCurrentView} />
        
        {/* Main Content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* 更新提醒 Banner - 显示在主要内容顶部 */}
          <div className="flex-shrink-0">
            <UpdateBanner
              bannerData={updateManager.updateBannerData}
              mandatoryUpdateData={updateManager.mandatoryUpdateData}
              onRemindLater={updateManager.handleRemindLater}
              onDismiss={updateManager.handleDismiss}
              onDownload={updateManager.handleDownload}
            />
          </div>
          
          {/* 页面内容 */}
          <div className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/prompts" replace />} />
              <Route path="/prompts" element={<PromptList />} />
              <Route path="/prompts/:id" element={<PromptDetail />} />
              <Route path="/notes/new" element={<NoteEditor />} />
              <Route path="/notes/:id/edit" element={<NoteEditor />} />
              <Route path="/settings" element={<Settings />} />
              {vaultRoutes}
            </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
    </VaultRuntimeProvider>
  );
};

export default App;
