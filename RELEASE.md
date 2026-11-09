# Sidecar MVP - Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/yourusername/sidecar-mvp)

> 🌟 一键收藏 Prompt 及 AI 输出，本地管理与迭代优化

**Sidecar** 是一个 Chrome/Edge 浏览器扩展，帮助你在 ChatGPT、Claude、Gemini 和 WorkBuddy 中快速收藏 Prompt 和 AI 回复，并在本地进行管理、版本控制和 AI 辅助改进。

## ✨ 核心功能

### 📝 Prompt 收藏
- 在支持的 AI 平台中点击星标，一键保存 Prompt 和 AI 回复
- 自动识别用户消息和 AI 回复
- 支持附件元信息保存

### 🗂️ 本地管理
- Side Panel 界面，不占用页面空间
- 文件夹分类管理
- 标签系统跨文件夹标记
- 关键词搜索和筛选
- 平台筛选

### 📊 版本控制
- 每次修改自动创建新版本
- 版本历史追溯
- 修改说明记录
- 版本对比（开发中）

### 🤖 AI 改进（开发中）
- 基于运行结果的 Prompt 改进建议
- 支持自定义 API 配置
- 用户确认后保存新版本

### 💾 数据安全
- 所有数据保存在本地 IndexedDB
- JSON 导入导出
- API Key 仅保存在本地
- 不上传任何用户数据

## 🚀 快速开始

### 前置要求

- Node.js 18+ (仅用于构建)
- Chrome 或 Edge 浏览器

### 安装方式

#### 方式 1: 下载构建版本（推荐）

1. 前往 [Releases](https://github.com/yourusername/sidecar-mvp/releases)
2. 下载最新的 `sidecar-mvp-x.x.x.zip`
3. 解压到任意目录
4. 在 Chrome 中加载 `dist` 目录

#### 方式 2: 自己构建

```bash
# 克隆仓库
git clone https://github.com/yourusername/sidecar-mvp.git
cd sidecar-mvp

# 安装依赖
npm install

# 构建
npm run build

# 加载到 Chrome
# 1. 打开 chrome://extensions/
# 2. 开启开发者模式
# 3. 加载已解压的扩展程序
# 4. 选择 dist 目录
```

## 📖 使用指南

### 1. 收藏 Prompt

1. 打开支持的 AI 平台：
   - ChatGPT: https://chat.openai.com 或 https://chatgpt.com
   - Claude: https://claude.ai
   - Gemini: https://gemini.google.com
   - WorkBuddy: https://workbuddy.ai

2. 发送消息并等待 AI 回复

3. 在 AI 回复旁边找到星标按钮 (☆)

4. 点击星标保存 Prompt 和回复

### 2. 查看和管理

1. 点击浏览器工具栏的 Sidecar 图标

2. Side Panel 会打开显示所有 Prompt

3. 使用左侧导航筛选：
   - 全部 Prompt
   - 最近收藏
   - 我的收藏
   - 文件夹
   - 标签

### 3. Prompt 详情

点击 Prompt 卡片查看：
- 完整内容
- 运行记录
- 版本历史
- 来源平台和 URL

### 4. 数据导入导出

在设置页面：
- 导出所有数据为 JSON
- 导入 JSON 恢复数据

## 🛠️ 技术栈

- **框架**: React 18 + TypeScript
- **构建**: Vite + @crxjs/vite-plugin
- **样式**: Tailwind CSS
- **路由**: React Router v6
- **数据库**: IndexedDB (Dexie)
- **图标**: Lucide React
- **扩展**: Chrome Extension Manifest V3

## 📁 项目结构

```
sidecar-mvp/
├── public/
│   ├── manifest.json      # Chrome Extension 配置
│   ├── icons/              # 扩展图标
│   └── content/            # Content Script 资源
├── src/
│   ├── background/         # Service Worker
│   ├── content/            # Content Scripts
│   │   └── adapters/       # 平台适配器
│   ├── sidepanel/          # Side Panel UI
│   │   ├── components/     # React 组件
│   │   └── pages/          # 页面
│   ├── db/                 # 数据库层
│   ├── ai/                 # AI 功能
│   └── shared/             # 共享代码
├── tests/                  # 测试文件
└── docs/                   # 文档
```

## 🧪 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 测试
npm run test

# Lint
npm run lint
```

## 🗺️ 路线图

### v0.1.0 (当前)
- ✅ ChatGPT 支持
- ✅ Side Panel UI
- ✅ 版本管理
- ✅ 运行记录
- ✅ 导入导出

### v0.2.0 (计划中)
- ⏳ Claude/Gemini/WorkBuddy 支持
- ⏳ AI Prompt 改进
- ⏳ 版本 Diff
- ⏳ 高级搜索

### v1.0.0 (未来)
- ⏳ Chrome Web Store 发布
- ⏳ 完整测试覆盖
- ⏳ 性能优化
- ⏳ 用户反馈集成

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📝 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 💬 联系方式

- 问题反馈: [GitHub Issues](https://github.com/yourusername/sidecar-mvp/issues)
- 功能建议: [GitHub Discussions](https://github.com/yourusername/sidecar-mvp/discussions)

## 🙏 致谢

感谢以下开源项目：
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Dexie](https://dexie.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Lucide Icons](https://lucide.dev/)

---

⭐ 如果这个项目对你有帮助，欢迎 Star！
