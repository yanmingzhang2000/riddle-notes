# Riddle Notes

> 一个收纳值得留下的信息、灵感与 AI 对话的私人手札。

Riddle Notes 是一个以 AI 对话自动收藏为核心的轻量级个人信息管理工具。在 AI 回复旁点一下星标，提问、回复和来源就收进你的手札，之后可以搜索和整理。

手动新建和粘贴其他内容的能力正在规划中。

> 当前是早期开发版：支持 ChatGPT Web，需要通过 Chrome 开发者模式手动加载。

## 功能

### 已提供

- **AI 对话一键收集**：在 ChatGPT 回复旁点击星标，自动保存提问、AI 回复、来源平台和对话链接。
- **侧边栏手札**：在 Chrome Side Panel 中查看已收集的笔记和详情，不占用页面空间。
- **搜索与浏览**：按关键词搜索（匹配标题和摘要），用「全部笔记」「最近收集」「重要」三个视图浏览，也可以按文件夹查看。
- **JSON 导入导出**：在设置页导出全部数据作为备份，需要时导入恢复。
- **本地存储**：数据保存在本机浏览器的 IndexedDB 中。

### 平台支持

| 平台 | 状态 |
| --- | --- |
| ChatGPT Web | 已支持 |
| Claude、Gemini、WorkBuddy | 适配器已接入，尚未完成验证，星标按钮可能无法正常显示 |
| DeepSeek | 尚未启用 |

### 规划中

- 手动新建和粘贴笔记
- 更可靠的 JSON 导入导出与数据恢复
- 更多 AI 平台的稳定支持

## 安装与构建

不想自己构建？查看 [INSTALLATION.md](INSTALLATION.md) 了解其他安装方式。

### 前置要求

需要安装以下工具：

1. **Node.js**（推荐 v18 或更高版本）
   - Windows: `winget install OpenJS.NodeJS.LTS`
   - macOS: `brew install node`
   - Linux: `sudo apt install nodejs`

2. **包管理器**（npm 随 Node.js 一起安装）

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

### 收集 AI 对话

1. 打开 ChatGPT（https://chatgpt.com 或 https://chat.openai.com）
2. 在 AI 回复旁边找到星标按钮 (☆)
3. 点击星标，保存这段对话的提问、AI 回复和来源链接
4. 出现"已收藏到：未分类"的提示，表示保存成功

### 查看和查找

1. 点击浏览器工具栏的 Riddle Notes 图标，打开 Side Panel
2. 在列表中点击一条笔记，查看详情
3. 在侧边栏顶部输入关键词搜索（匹配标题和摘要）

### 浏览和管理

- **三个视图**：侧边栏的「全部笔记」「最近收集」（最近 7 天）和「重要」。
- **重要标记**：在详情页点击右上角的书签图标，可以把笔记标记为重要，之后在「重要」视图中查看。
- **文件夹**：点击侧边栏的「文件夹」展开。目前所有笔记都存入默认的「未分类」文件夹。
- **删除**：在详情页底部点击删除按钮。

## 项目结构

```
riddle-notes/
├── public/
│   ├── manifest.json           # Chrome 扩展配置
│   ├── icons/                  # 扩展图标
│   └── content/                # 内容脚本样式
├── src/
│   ├── background/             # Service Worker
│   ├── content/                # 内容脚本
│   │   ├── adapters/           # 各 AI 平台的适配器
│   │   ├── content-script.ts   # 星标按钮注入与收集
│   │   ├── onboarding.ts       # 首次使用引导
│   │   └── selectors.ts        # 各平台的选择器配置
│   ├── sidepanel/              # Side Panel 界面
│   │   ├── components/         # React 组件
│   │   ├── hooks/              # React hooks
│   │   └── pages/              # 页面
│   ├── db/
│   │   └── schema.ts           # 数据模型（Dexie）
│   ├── options/                # 扩展选项页
│   └── shared/                 # 共享类型、常量与更新检查
├── tests/                      # 测试文件
├── website/                    # 产品落地页
├── scripts/                    # 脚本（图标生成）
├── package.json
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

## 数据与隐私

你的笔记数据只保存在本机浏览器的 IndexedDB 中，不会上传到服务器。扩展只会定期从 GitHub 读取更新清单，用于版本提醒。

当前版本没有跨设备同步。换浏览器或换电脑时，需要先导出 JSON，再在新环境中导入。

清除浏览器数据，或使用隐私模式，都会导致数据丢失。请在设置页定期导出 JSON 备份。

### 数据表

| 表 | 内容 |
| --- | --- |
| `prompts` | 笔记主表（标题、摘要、来源平台、文件夹、标签） |
| `promptVersions` | 提问内容 |
| `runs` | AI 回复、来源平台和对话链接 |
| `folders` | 文件夹 |
| `tags` | 标签（界面暂未提供） |
| `attachments` | 附件 |
| `appSettings` | 更新检查等应用设置 |
| `improvementRequests` | 早期 AI 改进功能留下的表，该功能已取消，保留以兼容旧数据 |

表名沿用了早期的 Prompt 命名，不影响使用。

## 测试

```bash
npm run test
```

## 已知限制

1. **平台适配**: 目前只有 ChatGPT Web 稳定支持。Claude、Gemini、WorkBuddy 的适配器已接入但未完成验证，DeepSeek 尚未启用。
2. **搜索范围**: 搜索只匹配标题和摘要，不包含 AI 回复的正文。
3. **整理功能有限**: 暂时不能新建文件夹、移动笔记或添加标签，所有笔记都存入默认的「未分类」文件夹。
4. **导入会覆盖现有数据**: 导入前请先导出一份当前数据作为备份。
5. **附件**: 附件功能受限，部分平台可能无法自动读取。附件内容可能无法随 JSON 一起导出。
6. **DOM 变化**: 平台页面结构变化可能导致适配器失效。

## 下一步计划

以下是大致顺序，可能会调整：

1. 加固 JSON 导入导出与数据恢复
2. 支持手动新建和粘贴笔记
3. 验证并稳定更多 AI 平台的适配

## 文档

- [INSTALLATION.md](INSTALLATION.md)：安装指南
- [QUICKSTART.md](QUICKSTART.md)：快速启动
- [BUILD.md](BUILD.md)：构建指南
- [PRODUCT-POSITIONING.md](PRODUCT-POSITIONING.md)：产品定位与方向
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献指南

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
