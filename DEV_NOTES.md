# 开发笔记

## 项目状态

**当前阶段**: Phase 1 完成，等待 Node.js 环境安装后进行构建测试

**完成时间**: 2026-11-08

## 实施总结

### 已完成的核心模块

#### 1. 数据层 (Database Layer)
- **文件**: `src/db/schema.ts`
- **技术**: Dexie (IndexedDB wrapper)
- **数据模型**: 7 个核心表
  - folders: 文件夹管理
  - tags: 标签系统
  - prompts: Prompt 主表
  - promptVersions: 版本控制
  - runs: 运行记录
  - attachments: 附件管理
  - improvementRequests: AI 改进请求

#### 2. 平台适配器层 (Platform Adapters)
- **接口**: `src/shared/types.ts` - PlatformAdapter
- **实现**: `src/content/adapters/chatgpt.ts`
- **功能**:
  - 平台检测
  - 消息识别和提取
  - 附件处理
  - URL 获取

#### 3. Content Script (内容脚本)
- **文件**: `src/content/content-script.ts`
- **功能**:
  - 星标按钮注入
  - 用户交互处理
  - Toast 通知
  - 消息通信

#### 4. Background Service Worker
- **文件**: `src/background/service-worker.ts`
- **功能**:
  - 消息路由
  - 数据持久化
  - 业务逻辑处理
  - 扩展生命周期管理

#### 5. Side Panel UI
- **框架**: React 18 + React Router v6
- **样式**: Tailwind CSS
- **页面**:
  - PromptList: 列表和搜索
  - PromptDetail: 详情和版本
  - Settings: 设置和配置

### 技术决策

#### 为什么选择 Dexie？
- 封装 IndexedDB，API 更友好
- 支持 TypeScript
- 提供响应式 hooks
- 数据迁移支持

#### 为什么使用 Chrome Side Panel API？
- 不占用页面空间
- 与主窗口独立
- 更好的用户体验
- Chrome 推荐的方式

#### 为什么选择 Vite？
- 快速的开发服务器
- 原生 ESM 支持
- 优秀的构建性能
- 与 React 配合良好

#### 为什么使用 Tailwind CSS？
- 快速开发
- 一致的设计系统
- 小的生产包体积
- 响应式设计简单

### 待优化项

#### 性能优化
- [ ] 大数据量列表虚拟化
- [ ] 图片懒加载
- [ ] 搜索性能优化（使用索引）

#### 用户体验
- [ ] 加载状态优化
- [ ] 错误提示优化
- [ ] 键盘快捷键
- [ ] 拖拽排序

#### 功能增强
- [ ] Prompt 模板
- [ ] 批量操作
- [ ] 高级搜索（正则、过滤）
- [ ] 统计和图表

### 已知问题

1. **ChatGPT DOM 变化风险**
   - 问题: ChatGPT 可能更新 DOM 结构
   - 解决: 定期维护适配器选择器

2. **大文件存储限制**
   - 问题: IndexedDB 有存储限制
   - 解决: 限制文件大小，提示用户

3. **跨域附件读取**
   - 问题: 某些平台附件无法直接读取
   - 解决: 保存元信息，允许手动上传

### 测试策略

#### 单元测试
- 数据库 CRUD 操作
- 适配器方法
- 工具函数

#### 集成测试
- 完整的保存流程
- 消息通信
- UI 交互

#### E2E 测试（未来）
- 使用 Playwright 或 Puppeteer
- 测试真实浏览器环境
- 自动化回归测试

### 部署流程

#### 开发环境
```bash
npm run dev  # 启动开发服务器
```

#### 生产构建
```bash
npm run build  # 构建生产版本
```

#### Chrome Web Store 发布（未来）
1. 准备宣传图和描述
2. 打包为 .crx 文件
3. 提交审核
4. 发布更新

### 版本规划

#### v0.1.0 (当前)
- ✅ 基础架构
- ✅ ChatGPT 适配器
- ✅ Prompt 管理

#### v0.2.0 (计划)
- ⏳ 多平台支持
- ⏳ AI 改进功能
- ⏳ 完整导入导出

#### v0.3.0 (计划)
- ⏳ 附件管理增强
- ⏳ 版本 Diff
- ⏳ 性能优化

#### v1.0.0 (计划)
- ⏳ 完整功能
- ⏳ 用户测试
- ⏳ 文档完善
- ⏳ Chrome Web Store 发布

### 代码质量

#### 代码规范
- TypeScript strict mode
- ESLint + Prettier
- Git hooks (husky)

#### 测试覆盖率目标
- 单元测试: > 80%
- 集成测试: 关键流程 100%

#### 文档
- 代码注释完整
- API 文档
- 用户指南

### 学习资源

#### Chrome Extension 开发
- [官方文档](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/mv3/intro/)

#### IndexedDB & Dexie
- [Dexie 文档](https://dexie.org/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

#### React & TypeScript
- [React 文档](https://react.dev/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)

### 反馈和改进

项目还在早期阶段，欢迎提出建议：

1. 功能需求
2. Bug 报告
3. 性能问题
4. 文档改进
5. 代码审查

---

**开发时间**: 约 2 小时  
**代码行数**: ~3000 行  
**文件数量**: 30+ 个  
**技术栈**: 6 个主要技术  

**下一步**: 安装 Node.js 并构建测试 ✨
