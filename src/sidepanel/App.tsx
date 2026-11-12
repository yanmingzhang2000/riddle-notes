import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import PromptList from './pages/PromptList';
import PromptDetail from './pages/PromptDetail';
import Settings from './pages/Settings';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdateManager } from './hooks/useUpdateManager';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<string>('all');
  const updateManager = useUpdateManager();

  return (
    <HashRouter>
      <div className="flex h-screen bg-gray-50">
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
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
  );
};

export default App;
