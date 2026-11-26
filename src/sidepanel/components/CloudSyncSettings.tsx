/**
 * 云同步设置组件
 * 
 * 功能：
 * - 注册/登录 Supabase
 * - 设置同步口令
 * - 手动上传/下载快照
 * - 显示同步状态
 */

import React, { useState, useEffect } from 'react';
import { Cloud, LogIn, LogOut, Upload, Download, Key, Info, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import {
  signUp,
  signIn,
  signOut,
  getCurrentUserEmail,
  uploadSnapshot,
  downloadLatestSnapshot,
  getSyncMetadata,
  getLatestVersion,
  NotAuthenticatedError,
  ConflictError,
  SyncError,
} from '../../shared/sync-service';
import { createBackup, restoreBackup } from '../../shared/backup';
import { db } from '../../db/schema';

type SyncState = 'idle' | 'uploading' | 'downloading' | 'logging-in' | 'signing-up';

const CloudSyncSettings: React.FC = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 认证表单
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // 同步口令表单
  const [showPassphraseForm, setShowPassphraseForm] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAction, setPassphraseAction] = useState<'upload' | 'download'>('upload');

  // 加载用户信息和同步状态
  useEffect(() => {
    loadUserInfo();
  }, []);

  const loadUserInfo = async () => {
    try {
      const email = await getCurrentUserEmail();
      setUserEmail(email);

      if (email) {
        const metadata = await getSyncMetadata();
        if (metadata) {
          setCurrentVersion(metadata.current_version);
          setLastSyncAt(new Date(metadata.last_sync_at));
        }
      }
    } catch (error) {
      // 优雅降级：测试环境或 Supabase 不可用时不报错
      console.debug('Cloud sync not available:', error);
    }
  };

  const handleAuth = async () => {
    if (!authEmail || !authPassword) {
      setErrorMessage('请输入邮箱和密码');
      return;
    }

    try {
      setSyncState(isSignUp ? 'signing-up' : 'logging-in');
      setErrorMessage(null);

      if (isSignUp) {
        await signUp(authEmail, authPassword);
        alert('注册成功！请查收验证邮件（可能在垃圾邮件中）。验证后即可登录。');
      } else {
        await signIn(authEmail, authPassword);
        alert('登录成功！');
      }

      await loadUserInfo();
      setShowAuthForm(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (error) {
      console.error('Auth failed:', error);
      setErrorMessage(error instanceof Error ? error.message : '认证失败');
    } finally {
      setSyncState('idle');
    }
  };

  const handleSignOut = async () => {
    if (!confirm('确定要退出登录吗？')) return;

    try {
      await signOut();
      setUserEmail(null);
      setCurrentVersion(0);
      setLastSyncAt(null);
      alert('已退出登录');
    } catch (error) {
      console.error('Sign out failed:', error);
      alert('退出失败，请重试');
    }
  };

  const handleUpload = async () => {
    if (!passphrase) {
      setErrorMessage('请输入同步口令');
      return;
    }

    try {
      setSyncState('uploading');
      setErrorMessage(null);

      // 创建备份快照
      const backup = await createBackup(db);

      // 上传到云端
      const newVersion = await uploadSnapshot(backup, passphrase, currentVersion);

      setCurrentVersion(newVersion);
      setLastSyncAt(new Date());
      setShowPassphraseForm(false);
      setPassphrase('');
      alert(`上传成功！版本 v${newVersion}`);
    } catch (error) {
      console.error('Upload failed:', error);
      
      if (error instanceof ConflictError) {
        setErrorMessage(`版本冲突：云端已有更新的版本 v${error.remoteVersion}。请先下载云端数据。`);
      } else if (error instanceof NotAuthenticatedError) {
        setErrorMessage('请先登录');
      } else {
        setErrorMessage(error instanceof Error ? error.message : '上传失败');
      }
    } finally {
      setSyncState('idle');
    }
  };

  const handleDownload = async () => {
    if (!passphrase) {
      setErrorMessage('请输入同步口令');
      return;
    }

    try {
      setSyncState('downloading');
      setErrorMessage(null);

      // 下载云端快照
      const result = await downloadLatestSnapshot(passphrase);

      if (!result) {
        alert('云端没有备份数据');
        return;
      }

      // 确认覆盖
      if (!confirm(`即将用云端版本 v${result.version} 覆盖本地数据。是否继续？\n\n（建议先导出本地数据作为备份）`)) {
        return;
      }

      // 恢复数据
      await restoreBackup(db, result.backup);

      setCurrentVersion(result.version);
      setLastSyncAt(new Date());
      setShowPassphraseForm(false);
      setPassphrase('');
      alert(`下载成功！已恢复 ${result.backup.counts.prompts} 条笔记`);
      window.location.reload(); // 刷新界面
    } catch (error) {
      console.error('Download failed:', error);
      
      if (error instanceof SyncError && error.message.includes('口令错误')) {
        setErrorMessage('同步口令错误，请检查后重试');
      } else if (error instanceof NotAuthenticatedError) {
        setErrorMessage('请先登录');
      } else {
        setErrorMessage(error instanceof Error ? error.message : '下载失败');
      }
    } finally {
      setSyncState('idle');
    }
  };

  const handleRefreshVersion = async () => {
    try {
      const version = await getLatestVersion();
      setCurrentVersion(version);
      
      if (version === 0) {
        alert('云端没有备份数据');
      } else {
        alert(`云端最新版本：v${version}`);
      }
    } catch (error) {
      console.error('Failed to refresh version:', error);
      alert('查询失败，请重试');
    }
  };

  return (
    <section className="mb-8">
      <h3 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
        <Cloud className="w-5 h-5 text-mapblue" />
        云同步（实验性）
      </h3>

      {/* 说明 */}
      <div className="paper-panel paper-panel--seal mb-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-seal mt-0.5" />
          <div className="text-sm text-brown">
            <p className="font-medium mb-1">端到端加密云备份</p>
            <p className="mb-2">
              你的数据在上传前会用同步口令加密，云端只存储密文。
              <strong>请妥善保管同步口令，丢失后无法恢复数据。</strong>
            </p>
            <p>云同步账号用于身份验证，与笔记内容解密无关。同步口令只保存在本地浏览器。</p>
          </div>
        </div>
      </div>

      {/* 账号状态 */}
      <div className="paper-panel mb-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-ink">账号状态</h4>
          {userEmail ? (
            <span className="badge badge-sage flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              已登录
            </span>
          ) : (
            <span className="badge badge-brown flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              未登录
            </span>
          )}
        </div>

        {userEmail ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-soft">邮箱: </span>
              <span className="text-brown font-mono">{userEmail}</span>
            </div>

            {currentVersion > 0 && (
              <>
                <div className="text-sm">
                  <span className="text-soft">云端版本: </span>
                  <span className="text-brown">v{currentVersion}</span>
                  <button
                    onClick={handleRefreshVersion}
                    className="ml-2 text-mapblue hover:text-sage transition-colors"
                    title="刷新版本"
                  >
                    <RefreshCw className="w-3 h-3 inline" />
                  </button>
                </div>

                {lastSyncAt && (
                  <div className="text-sm">
                    <span className="text-soft">最后同步: </span>
                    <span className="text-brown">{lastSyncAt.toLocaleString('zh-CN')}</span>
                  </div>
                )}
              </>
            )}

            <button
              onClick={handleSignOut}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-brown">请先登录或注册云同步账号</p>
            <button
              onClick={() => {
                setShowAuthForm(true);
                setIsSignUp(false);
              }}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              登录
            </button>
            <button
              onClick={() => {
                setShowAuthForm(true);
                setIsSignUp(true);
              }}
              className="btn-secondary text-sm"
            >
              注册新账号
            </button>
          </div>
        )}
      </div>

      {/* 认证表单（弹窗） */}
      {showAuthForm && (
        <div className="paper-panel mb-4">
          <h4 className="font-medium text-ink mb-3">
            {isSignUp ? '注册新账号' : '登录'}
          </h4>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-brown mb-1">
                邮箱
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="your@email.com"
                className="input text-sm"
                disabled={syncState !== 'idle'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-brown mb-1">
                密码
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="至少 6 位"
                className="input text-sm"
                disabled={syncState !== 'idle'}
              />
            </div>

            {errorMessage && (
              <div className="p-2 bg-seal/10 border border-seal/30 rounded text-sm text-seal">
                {errorMessage}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleAuth}
                disabled={syncState !== 'idle'}
                className="flex-1 btn-primary text-sm"
              >
                {syncState === 'logging-in' || syncState === 'signing-up'
                  ? '处理中...'
                  : isSignUp
                  ? '注册'
                  : '登录'}
              </button>
              <button
                onClick={() => {
                  setShowAuthForm(false);
                  setAuthEmail('');
                  setAuthPassword('');
                  setErrorMessage(null);
                }}
                disabled={syncState !== 'idle'}
                className="flex-1 btn-secondary text-sm"
              >
                取消
              </button>
            </div>

            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-mapblue hover:text-sage transition-colors"
            >
              {isSignUp ? '已有账号？去登录' : '没有账号？去注册'}
            </button>
          </div>
        </div>
      )}

      {/* 同步操作 */}
      {userEmail && !showAuthForm && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setPassphraseAction('upload');
              setShowPassphraseForm(true);
              setErrorMessage(null);
            }}
            disabled={syncState !== 'idle'}
            className="w-full btn-primary text-left flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            上传到云端
          </button>

          <button
            onClick={() => {
              setPassphraseAction('download');
              setShowPassphraseForm(true);
              setErrorMessage(null);
            }}
            disabled={syncState !== 'idle' || currentVersion === 0}
            className="w-full btn-secondary text-left flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            从云端下载
          </button>

          {currentVersion === 0 && (
            <p className="text-xs meta">
              云端没有备份，请先上传
            </p>
          )}
        </div>
      )}

      {/* 同步口令表单（弹窗） */}
      {showPassphraseForm && (
        <div className="paper-panel mt-4">
          <h4 className="font-medium text-ink mb-3 flex items-center gap-2">
            <Key className="w-4 h-4 text-mapblue" />
            {passphraseAction === 'upload' ? '上传到云端' : '从云端下载'}
          </h4>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-brown mb-1">
                同步口令
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="输入你的同步口令"
                className="input text-sm"
                disabled={syncState !== 'idle'}
                autoFocus
              />
              <p className="text-xs meta mt-1">
                {passphraseAction === 'upload'
                  ? '首次上传时设置。请使用强口令，丢失后无法恢复数据。'
                  : '输入上传时设置的同步口令'}
              </p>
            </div>

            {errorMessage && (
              <div className="p-2 bg-seal/10 border border-seal/30 rounded text-sm text-seal">
                {errorMessage}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={passphraseAction === 'upload' ? handleUpload : handleDownload}
                disabled={syncState !== 'idle'}
                className="flex-1 btn-primary text-sm"
              >
                {syncState === 'uploading'
                  ? '上传中...'
                  : syncState === 'downloading'
                  ? '下载中...'
                  : passphraseAction === 'upload'
                  ? '确认上传'
                  : '确认下载'}
              </button>
              <button
                onClick={() => {
                  setShowPassphraseForm(false);
                  setPassphrase('');
                  setErrorMessage(null);
                }}
                disabled={syncState !== 'idle'}
                className="flex-1 btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default CloudSyncSettings;
