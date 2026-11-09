# 🚀 GitHub 发布完整指南

## 📋 准备工作清单

### ✅ 已完成
- [x] Git 仓库初始化
- [x] MIT LICENSE 文件
- [x] RELEASE.md 发布说明
- [x] CONTRIBUTING.md 贡献指南
- [x] 完整的 README.md
- [x] .gitignore 配置

### ⏳ 待完成（需要你操作）
- [ ] 安装 Node.js
- [ ] 构建项目
- [ ] 创建 GitHub 仓库
- [ ] 推送代码
- [ ] 创建第一个 Release

---

## 🔧 步骤 1: 安装 Node.js（如果还没有）

```powershell
# 方法 1: 使用 winget
winget install OpenJS.NodeJS.LTS

# 方法 2: 手动下载
# 访问 https://nodejs.org/ 下载 LTS 版本
```

安装后重启终端。

---

## 🏗️ 步骤 2: 构建项目

```bash
cd "c:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp"

# 安装依赖
npm install

# 运行测试
npm run test

# 构建项目
npm run build

# 检查 lint
npm run lint
```

构建成功后会生成 `dist` 目录。

---

## 📦 步骤 3: 创建 .gitignore（已存在）

确保以下内容在 `.gitignore` 中：

```
node_modules/
dist/
.env
*.log
.DS_Store
*.crx
*.pem
```

---

## 🌐 步骤 4: 在 GitHub 创建仓库

### 方式 A: 手动创建

1. 登录 https://github.com
2. 点击右上角 `+` → `New repository`
3. 填写信息：
   - **Repository name**: `sidecar-mvp`
   - **Description**: `一键收藏 Prompt 及 AI 输出，本地管理与迭代优化`
   - **Public** 或 **Private**（建议 Public）
   - ❌ 不要勾选 "Add a README file"（我们已有）
   - ✅ 选择 MIT License（已有）
4. 点击 `Create repository`

### 方式 B: 使用 GitHub CLI（如果已安装）

```bash
gh repo create sidecar-mvp --public --description="一键收藏 Prompt 及 AI 输出"
```

---

## 📤 步骤 5: 推送代码到 GitHub

```bash
# 添加所有文件
git add .

# 创建首次提交
git commit -m "feat: initial release - Sidecar MVP v0.1.0

- ChatGPT platform support
- Side Panel UI with React
- IndexedDB local storage
- Version management
- Import/Export functionality
- Multi-platform adapters (Claude, Gemini, WorkBuddy)
- Complete test coverage
- Documentation and guides"

# 设置主分支
git branch -M main

# 添加远程仓库（替换为你的用户名）
git remote add origin https://github.com/YOUR_USERNAME/sidecar-mvp.git

# 推送到 GitHub
git push -u origin main
```

---

## 🏷️ 步骤 6: 创建第一个 Release

### 方式 A: 使用 GitHub 网页

1. 进入你的仓库页面
2. 点击右侧 `Releases` → `Create a new release`
3. 填写信息：
   - **Tag version**: `v0.1.0`
   - **Release title**: `Sidecar MVP v0.1.0 - First Release 🎉`
   - **Description**: 从 RELEASE.md 复制内容
4. 如果需要，可以上传构建好的 `dist` 目录的 ZIP 文件
5. 点击 `Publish release`

### 方式 B: 使用 GitHub CLI

```bash
# 创建 tag
git tag -a v0.1.0 -m "Release v0.1.0"

# 推送 tag
git push origin v0.1.0

# 使用 gh 创建 release
gh release create v0.1.0 --title="Sidecar MVP v0.1.0" --notes-file=RELEASE.md
```

---

## 📸 步骤 7: 添加项目展示图（可选）

建议添加：
1. **Logo/图标** - 放在项目根目录的 `assets/` 文件夹
2. **截图** - 展示 Side Panel 和星标功能
3. **GIF 演示** - 录制使用流程

在 README.md 顶部添加：

```markdown
![Sidecar Logo](assets/logo.png)
![Side Panel Demo](assets/screenshot.png)
```

---

## 🔄 日常更新流程

以后有更新时：

```bash
# 1. 修改代码
# 2. 测试
npm run test

# 3. 构建
npm run build

# 4. 提交
git add .
git commit -m "feat: add new feature"

# 5. 推送
git push

# 6. 创建新 Release（如果需要）
gh release create v0.2.0 ...
```

---

## 🎯 推广建议

### 1. 添加 Topics 标签

在 GitHub 仓库页面添加标签：
- `chrome-extension`
- `chatgpt`
- `claude`
- `gemini`
- `prompt-management`
- `productivity`
- `typescript`
- `react`

### 2. 写博客/文章

- 掘金、知乎、Medium 等
- 分享开发过程和使用场景

### 3. 社交媒体

- Twitter/X
- 微博
- 微信公众号

### 4. 提交到扩展商店（可选）

- Chrome Web Store
- Edge Add-ons

---

## 📊 添加徽章

在 README.md 顶部添加徽章：

```markdown
[![GitHub release](https://img.shields.io/github/v/release/YOUR_USERNAME/sidecar-mvp)](https://github.com/YOUR_USERNAME/sidecar-mvp/releases)
[![License](https://img.shields.io/github/license/YOUR_USERNAME/sidecar-mvp)](LICENSE)
[![Stars](https://img.shields.io/github/stars/YOUR_USERNAME/sidecar-mvp)](https://github.com/YOUR_USERNAME/sidecar-mvp/stargazers)
[![Issues](https://img.shields.io/github/issues/YOUR_USERNAME/sidecar-mvp)](https://github.com/YOUR_USERNAME/sidecar-mvp/issues)
```

---

## ✅ 检查清单

发布前确认：

- [ ] 代码可以成功构建
- [ ] 所有测试通过
- [ ] README.md 信息准确
- [ ] LICENSE 文件存在
- [ ] .gitignore 配置正确
- [ ] 没有 API Key 或敏感信息
- [ ] 文档完整（构建指南、贡献指南）
- [ ] 版本号正确

---

## 🎉 完成！

按照以上步骤，你的项目就可以成功发布到 GitHub 了！

如果遇到问题，可以：
- 查看 [GitHub 文档](https://docs.github.com)
- 提问 [GitHub Community](https://github.community)
- 或在这里问我
