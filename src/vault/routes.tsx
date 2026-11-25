import { Route } from 'react-router-dom';
import VaultDetail from './pages/VaultDetail';
import VaultEditor from './pages/VaultEditor';
import VaultGuard from './pages/VaultGuard';
import VaultList from './pages/VaultList';
import VaultRecover from './pages/VaultRecover';
import VaultSettings from './pages/VaultSettings';
import VaultSetup from './pages/VaultSetup';
import VaultUnlock from './pages/VaultUnlock';

/**
 * 保险箱的全部路由,放进 App 的 <Routes> 里:
 *
 *   <Routes>{...现有路由}{vaultRoutes}</Routes>
 *
 * setup / unlock / recover 在守卫外面,任何状态都能访问;其余都在守卫里面(技术方案 §6.3)。
 * 这是一个 Route 元素而不是组件:<Routes> 的子节点必须是 <Route>,不能是返回 <Route> 的自定义组件。
 * "settings" 和 "new" 是静态路径,优先于 ":id" 匹配。
 */
export const vaultRoutes = (
  <Route path="/vault">
    <Route path="setup" element={<VaultSetup />} />
    <Route path="unlock" element={<VaultUnlock />} />
    <Route path="recover" element={<VaultRecover />} />

    <Route element={<VaultGuard />}>
      <Route index element={<VaultList />} />
      <Route path="new" element={<VaultEditor />} />
      <Route path="settings" element={<VaultSettings />} />
      <Route path=":id" element={<VaultDetail />} />
      <Route path=":id/edit" element={<VaultEditor />} />
    </Route>
  </Route>
);
