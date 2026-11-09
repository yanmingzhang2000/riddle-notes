# Sidecar MVP

一键收藏 Prompt 及 AI 输出，本地管理与迭代优化

## 功能特性

### Phase 1 (当前)
- ✅ Chrome Extension Manifest V3 基础架构
- ✅ React + TypeScript + Vite + Tailwind CSS
- ✅ IndexedDB 本地数据库 (Dexie)
- ✅ ChatGPT 平台适配器
- ✅ 星标收藏功能
- ✅ Side Panel UI
- ✅ Prompt 列表和详情页
- ✅ 版本管理
- ✅ 运行记录

### Phase 2 (计划)
- ⏳ Claude 适配器
- ⏳ Gemini 适配器
- ⏳ WorkBuddy 适配器
- ⏳ AI 改进 Prompt 功能

## 安装与构建

### 前置要求

需要安装以下工具：

1. **Node.js** (推荐 v18 或更高版本)
   - Windows: `winget install OpenJS.NodeJS.LTS`
   - macOS: `brew install node`
   - Linux: `sudo apt install nodejs`

2. **包管理器** (npm 随 Node.js 一起安装)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

这将在 `dist` 目录生成开发版本，并启用热重载。

### 生产构建

```bash
npm run build
```

## 加载扩展到 Chrome

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目的 `dist` 目录

## 使用方法

### 收藏 Prompt

1. 打开 ChatGPT (https://chat.openai.com)
2. 在 AI 回复旁边会看到星标按钮 (☆)
3. 点击星标按钮保存 Prompt 和输出
4. 提示"已收藏到：未分类"表示保存成功

### 查看 Prompt

1. 点击浏览器工具栏的 Sidecar 图标
2. Side Panel 将打开显示所有 Prompt
3. 点击 Prompt 卡片查看详情

### 管理 Prompt

- **搜索**: 在侧边栏顶部输入关键词
- **筛选**: 点击左侧导航栏的文件夹或标签
- **收藏**: 点击详情页的星标图标
- **版本**: 在详情页查看历史版本
- **删除**: 在详情页底部点击删除按钮

## 项目结构

```
sidecar-mvp/
├── public/
│   ├── manifest.json          # Chrome Extension 配置
│   └── icons/                  # 扩展图标
├── src/
│   ├── background/             # Service Worker
│   │   └── service-worker.ts
│   ├── content/                # Content Scripts
│   │   ├── adapters/          # 平台适配器
│   │   │   └── chatgpt.ts
│   │   └── content-script.ts
│   ├── sidepanel/              # Side Panel UI
│   │   ├── components/        # React 组件
│   │   ├── pages/             # 页面
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── db/                     # 数据库层
│   │   ├── schema.ts          # 数据模型
│   │   ├── repositories/      # 数据仓库
│   │   └── migrations/        # 迁移
│   ├── ai/                     # AI 功能
│   │   ├── provider.ts
│   │   └── improve-prompt.ts
│   ├── shared/                 # 共享代码
│   │   ├── types.ts
│   │   └── constants.ts
│   └── options/                # 设置页
├── tests/                      # 测试文件
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## 技术栈

- **框架**: React 18
- **语言**: TypeScript
- **构建**: Vite + @crxjs/vite-plugin
- **样式**: Tailwind CSS
- **路由**: React Router v6
- **数据库**: IndexedDB (Dexie)
- **扩展**: Chrome Extension Manifest V3
- **图标**: Lucide React

## 数据存储

所有数据保存在浏览器的 IndexedDB 中：

- `folders` - 文件夹
- `tags` - 标签
- `prompts` - Prompt 主表
- `promptVersions` - 版本历史
- `runs` - 运行记录
- `attachments` - 附件
- `improvementRequests` - AI 改进请求

数据完全本地化，不会上传到任何服务器。

## API Key 安全

- API Key 仅保存在 `chrome.storage.local`
- 不会提交到 Git
- 不会出现在日志中
- 不会上传到自有服务器

## 测试

```bash
npm run test
```

## 已知限制

1. **平台适配**: 目前仅支持 ChatGPT Web，其他平台适配器后续添加
2. **AI 改进**: AI 改进功能需要配置 OpenAI-compatible API，当前版本未实现
3. **附件**: 附件功能受限，部分平台可能无法自动读取
4. **DOM 变化**: 平台 DOM 结构变化可能导致适配器失效

## 下一步计划

1. 实现 Claude Web 适配器
2. 实现 Gemini Web 适配器
3. 实现 WorkBuddy Web 适配器
4. 实现 AI 改进 Prompt 功能
5. 添加单元测试和集成测试
6. 优化 UI/UX
7. 添加导入导出功能完善

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
