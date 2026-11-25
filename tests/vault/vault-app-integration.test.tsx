/**
 * 把保险箱接进现有应用:Sidebar 的入口,以及 App 里 Provider 和路由的接线。
 *
 * App 用的是 HashRouter 和真实的默认 runtime(真实的 vaultDb,在内存 IndexedDB 里),
 * 所以这里的"保险箱"是一个全新的、没有创建过的库。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import App from '../../src/sidepanel/App';
import Sidebar from '../../src/sidepanel/components/Sidebar';
import { getDefaultVaultRuntime } from '../../src/vault/runtime';

// App 里的更新检查会去请求网络;这里不关心它,给一个什么都不做的假实现
vi.mock('../../src/sidepanel/hooks/useUpdateManager', () => ({
  useUpdateManager: () => ({
    updateBannerData: null,
    mandatoryUpdateData: null,
    handleRemindLater: () => {},
    handleDismiss: () => {},
    handleDownload: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

function renderSidebar(currentView: string, path = '/prompts') {
  const onViewChange = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar currentView={currentView} onViewChange={onViewChange} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return { onViewChange };
}

// ===========================================================================
describe('Sidebar 的保险箱入口', () => {
  test('底部有"保险箱"入口,在"设置"之前', async () => {
    renderSidebar('all');

    const vault = await screen.findByRole('button', { name: '保险箱' });
    const settings = screen.getByRole('button', { name: '设置' });
    expect(vault.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('点击:进入 /vault,并把当前视图切成 vault(笔记的导航项不再高亮)', async () => {
    const { onViewChange } = renderSidebar('all');

    fireEvent.click(await screen.findByRole('button', { name: '保险箱' }));

    expect(onViewChange).toHaveBeenCalledWith('vault');
    expect(screen.getByTestId('where')).toHaveTextContent('/vault');
  });

  test('当前视图是 vault 时入口高亮,笔记的导航项都不高亮', async () => {
    renderSidebar('vault', '/vault');

    const vault = await screen.findByRole('button', { name: '保险箱' });
    expect(vault.className).toContain('nav-item-active');
    expect(screen.getByRole('button', { name: '全部笔记' }).className).not.toContain('nav-item-active');
  });

  test('在 /vault 下的任何子页面,入口都保持高亮(哪怕 currentView 没变)', async () => {
    renderSidebar('all', '/vault/settings');

    expect((await screen.findByRole('button', { name: '保险箱' })).className).toContain('nav-item-active');
  });

  test('在笔记页面时入口不高亮', async () => {
    renderSidebar('all', '/prompts');

    expect((await screen.findByRole('button', { name: '保险箱' })).className).not.toContain('nav-item-active');
  });

  test('原有的导航项和设置入口行为没有变', async () => {
    const { onViewChange } = renderSidebar('all');

    fireEvent.click(await screen.findByRole('button', { name: '手动笔记' }));
    expect(onViewChange).toHaveBeenCalledWith('manual');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });
});

// ===========================================================================
describe('App 接入保险箱', () => {
  beforeEach(() => {
    window.location.hash = '#/prompts';
  });

  test('从侧边栏进入保险箱:还没创建过,被带去创建页', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '保险箱' }));

    expect(await screen.findByText('先了解几件事')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/vault/setup');
  });

  test('笔记的原有页面照常工作(路由没有被保险箱的路由遮住)', async () => {
    window.location.hash = '#/prompts';
    render(<App />);

    expect(await screen.findByRole('heading', { name: '全部笔记' })).toBeInTheDocument();
    expect(screen.queryByText('先了解几件事')).toBeNull();
  });

  test('App 挂载后保险箱运行时开始工作,卸载后停止:空闲检查和活动追踪不会泄漏', async () => {
    const runtime = getDefaultVaultRuntime();
    const touch = vi.spyOn(runtime.session, 'touch');
    const { unmount } = render(<App />);
    await screen.findByRole('button', { name: '保险箱' });

    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    expect(touch).toHaveBeenCalledTimes(1); // Provider 在 App 最外层,笔记页面上的按键也算活动

    unmount();
    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    expect(touch).toHaveBeenCalledTimes(1);
  });

  test('保险箱的 Provider 在整个 App 外层:在笔记页面上(不在 /vault 路由下)监听也在运行', async () => {
    const runtime = getDefaultVaultRuntime();
    const touch = vi.spyOn(runtime.session, 'touch');
    window.location.hash = '#/prompts';
    render(<App />);
    await screen.findByRole('button', { name: '保险箱' });
    await waitFor(() => expect(window.location.hash).toBe('#/prompts'));

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    expect(touch).toHaveBeenCalled();
  });
});
