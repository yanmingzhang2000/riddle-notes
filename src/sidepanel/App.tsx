import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import PromptList from './pages/PromptList';
import PromptDetail from './pages/PromptDetail';
import Settings from './pages/Settings';
import { Star, FolderOpen, Tag, Clock, TrendingUp, Settings as SettingsIcon, Search } from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<string>('all');

  return (
    <HashRouter>
      <div className="flex h-screen bg-gray-50">
        {/* Sidebar */}
        <Sidebar currentView={currentView} onViewChange={setCurrentView} />
        
        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/prompts" replace />} />
            <Route path="/prompts" element={<PromptList />} />
            <Route path="/prompts/:id" element={<PromptDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
};

export default App;
