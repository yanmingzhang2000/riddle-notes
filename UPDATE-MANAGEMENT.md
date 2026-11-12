# Riddle Notes 更新管理功能

根据 PRD 第10章要求，已实现完整的更新管理功能。

## 功能概览

### ✅ 已实现的功能

1. **版本清单 (`update-manifest.json`)**
   - 支持标准的 JSON 格式
   - 包含最新版本、发布时间、更新说明、下载地址等信息
   - 支持强制更新标记和最低支持版本

2. **自动更新检查**
   - 扩展启动时自动检查
   - 每24小时定时检查
   - 检查失败不影响核心功能
   - 支持手动检查更新

3. **侧边栏更新提醒**
   - 非阻塞式 Banner 提醒
   - 强制更新警告（红色边框）
   - "稍后提醒"功能
   - 版本更新忽略功能

4. **设置页更新管理**
   - 当前版本显示
   - 更新检查开关
   - 更新清单 URL 配置
   - 最后检查时间
   - 手动检查按钮
   - 下载入口

5. **安全要求**
   - 必须使用 HTTPS
   - 不自动下载或安装扩展
   - 检查失败时降级处理
   - 隐私数据本地存储

## 数据结构

### 更新清单格式 (`update-manifest.json`)

```json
{
  "latestVersion": "1.1.0",
  "publishedAt": "2026-11-12T10:00:00+08:00",
  "releaseNotes": "RiddleNote v1.1.0 现已发布！\n\n主要更新：\n- ✅ 新增多平台支持\n- ✅ 修复收藏失败问题\n- ✅ 增加数据导出功能",
  "downloadUrl": "https://github.com/yanmingzhang2000/sidecar/releases/tag/v1.1.0",
  "minSupportedVersion": "1.0.0",
  "isMandatory": false
}
```

### 数据库表 (`app_settings`)

```sql
id
updateCheckEnabled      -- 是否启用更新检查
lastUpdateCheckAt       -- 最后检查时间
lastNotifiedVersion     -- 最后通知的版本
lastDismissedVersion    -- 用户忽略的版本
updateManifestUrl       -- 更新清单 URL
createdAt
updatedAt
```

## 版本比较逻辑

### 版本号格式
- 支持语义化版本号: `major.minor.patch`
- 示例: `1.0.0`, `1.1.0`, `2.0.0`

### 比较规则
1. **有可用更新**: `最新版本 > 当前版本`
2. **强制更新**: `isMandatory = true` 或 `当前版本 < minSupportedVersion`
3. **无更新**: `最新版本 ≤ 当前版本`

## 用户界面

### 1. 侧边栏 Banner

**普通更新提醒:**
```
RiddleNote v1.1.0 已发布
修复了收藏失败问题，并增加数据导出功能。

[下载新版本] [稍后提醒]
```

**强制更新警告:**
```
当前版本已不再支持，请更新 RiddleNote 后继续使用。
您的版本 1.0.0 已低于最低支持版本 1.1.0。

[下载新版本]
```

### 2. 设置页面

设置页面包含完整的更新管理功能:
- 当前版本信息
- 更新检查开关
- 更新清单 URL 配置
- 最后检查时间和结果
- 手动检查按钮
- 错误状态显示

## API 接口

### UpdateService 类

```typescript
// 获取更新服务实例
const updateService = UpdateService.getInstance();

// 检查更新
const result = await updateService.checkForUpdates({
  forceCheck: true,
  showNotification: true,
});

// 获取应用设置
const settings = await updateService.getAppSettings();

// 更新应用设置
await updateService.updateAppSettings({
  updateCheckEnabled: false,
  updateManifestUrl: 'https://custom.example.com/manifest.json',
});

// 稍后提醒
await updateService.remindLater('1.1.0');

// 忽略此版本
await updateService.dismissUpdate('1.1.0');

// 启动定时检查
await updateService.startPeriodicChecks();

// 停止定时检查
updateService.stopPeriodicChecks();
```

### 类型定义

完整类型定义见 `src/shared/update-types.ts`:
- `UpdateManifest`: 更新清单数据结构
- `UpdateCheckResult`: 检查结果
- `UpdateNotificationState`: 通知状态
- `UpdateError`: 错误信息
- 等等...

## 测试覆盖

已编写完整的测试用例 (`tests/update-service.test.ts`):

### 测试场景
1. ✅ 获取和更新应用设置
2. ✅ 获取和验证更新清单
3. ✅ 版本比较逻辑
4. ✅ 更新检查流程
5. ✅ "稍后提醒"和"忽略"功能
6. ✅ 错误处理和降级

### 运行测试
```bash
npm run test update-service.test.ts
```

## 部署说明

### 1. 发布新版本
1. 更新 `public/manifest.json` 中的版本号
2. 打包扩展 (`npm run build`)
3. 发布到 GitHub Releases
4. 更新 `update-manifest.json` 文件

### 2. 更新清单托管
推荐将 `update-manifest.json` 托管在:
- GitHub Releases 附件
- GitHub Pages
- 其他静态文件服务

### 3. 用户更新流程
1. 扩展检查更新清单
2. 发现新版本时显示提醒
3. 用户点击"下载新版本"
4. 跳转到 GitHub Releases 页面
5. 用户手动下载并安装

## 安全考虑

1. **HTTPS 要求**: 所有清单和下载地址必须使用 HTTPS
2. **不自动安装**: 从不自动下载或安装扩展包
3. **本地存储**: 所有设置和状态保存在本地 IndexedDB
4. **失败降级**: 网络错误或清单解析失败时不影响核心功能
5. **用户确认**: 下载前显示完整的更新信息和下载地址

## 性能优化

1. **缓存策略**: 24小时内不重复检查
2. **后台检查**: 使用定时器，避免阻塞 UI
3. **按需加载**: 更新服务按需初始化
4. **错误重试**: 网络错误时 1 小时后重试

## 扩展性

1. **可配置清单 URL**: 支持自定义更新清单地址
2. **灵活的版本策略**: 支持强制更新和最低版本
3. **多通知渠道**: 可扩展到其他通知方式
4. **国际化支持**: 文本内容可配置

---

## 后续改进建议

### Phase 6+ 功能
1. **增量更新**: 支持增量包下载
2. **更新统计**: 收集匿名更新统计
3. **测试清单**: 支持测试环境清单
4. **回滚机制**: 支持版本回滚
5. **离线检查**: 支持离线状态处理

### 用户体验优化
1. **进度显示**: 下载和安装进度
2. **夜间模式**: 更新提醒适配夜间模式
3. **多语言**: 支持更多语言
4. **无障碍**: 更好的屏幕阅读器支持

---

**状态**: ✅ 完整实现，已通过单元测试
**符合 PRD**: 完全满足第10章所有要求
**安全性**: 符合所有安全要求
**可靠性**: 优雅降级，不影响核心功能