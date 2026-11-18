# 📦 Riddle Notes 安装指南

Riddle Notes 是一个收纳值得留下的信息、灵感与 AI 对话的私人手札。目前支持在 ChatGPT Web 中一键收集对话。

## 🎯 快速安装（3种方式）

---

## 方式 1: 从源码构建（推荐）

### 前置要求
- Node.js 18+ （必需）
- Chrome 或 Edge 浏览器

### 步骤

#### 1. 安装 Node.js

**Windows (使用 winget)**:
```powershell
winget install OpenJS.NodeJS.LTS
```

**或手动下载**:
- 访问 https://nodejs.org/
- 下载 LTS 版本（18.x 或更高）
- 运行安装程序
- 安装完成后**重启终端**

#### 2. 克隆或下载项目

```bash
# 方式 A: 使用 Git
git clone https://github.com/yanmingzhang2000/riddle-notes.git
cd riddle-notes

# 方式 B: 直接下载 ZIP
# 1. 访问 https://github.com/yanmingzhang2000/riddle-notes
# 2. 点击绿色 "Code" 按钮
# 3. 选择 "Download ZIP"
# 4. 解压后进入目录
```

#### 3. 安装依赖并构建

```bash
# 安装依赖
npm install

# 构建
npm run build
```

构建成功后会生成 `dist` 目录。

#### 4. 加载到 Chrome

1. 打开 Chrome 浏览器
2. 在地址栏输入: `chrome://extensions/`
3. 右上角开启 **"开发者模式"**
4. 点击 **"加载已解压的扩展程序"**
5. 选择项目的 `dist` 目录
6. 完成！Riddle Notes 图标会出现在工具栏

---

## 方式 2: 下载构建版本（无需 Node.js）

### 步骤

#### 1. 创建发布包（需要 Node.js 一次）

如果你已经安装了 Node.js：

```bash
git clone https://github.com/yanmingzhang2000/riddle-notes.git
cd riddle-notes
npm install
npm run build

# 打包 dist 目录为 ZIP
# Windows: 右键 dist 文件夹 → 发送到 → 压缩(zipped)文件夹
# Mac/Linux: zip -r riddle-notes-extension.zip dist/
```

#### 2. 分享给他人

将生成的 `riddle-notes-extension.zip` 发送给其他人：

- Email
- 网盘（百度云、Google Drive）
- 微信/QQ

#### 3. 接收者安装

1. 解压 `riddle-notes-extension.zip`
2. 在 Chrome 中加载解压后的文件夹

---

## 方式 3: 从 GitHub Release 下载（未来）

将来会在 GitHub Releases 页面提供打包好的 ZIP 文件。

---

## 🎮 使用方法

### 1. 收集 AI 对话

1. 打开支持的 AI 平台：
   - **ChatGPT**（已支持）: https://chatgpt.com 或 https://chat.openai.com
   - **Claude、Gemini、WorkBuddy**（适配中）: 适配器已接入，但尚未完成验证，星标按钮可能无法正常显示
   - **DeepSeek**: 尚未启用

2. 发送消息并等待 AI 回复

3. 在 AI 回复旁边找到 **星标按钮 (☆)**

4. 点击星标，保存提问、AI 回复和来源

### 2. 查看笔记

1. 点击浏览器工具栏的 **Riddle Notes 图标**

2. Side Panel 会打开，显示你收集的内容

3. 使用侧边栏的「全部笔记」「最近收集」「重要」和文件夹浏览笔记

4. 在详情页点击书签图标，可以把笔记标记为重要，之后在「重要」中查看

### 3. 搜索和筛选

- 在搜索框输入关键词（匹配标题和摘要，不包含 AI 回复的正文）
- 展开侧边栏的「文件夹」，点击文件夹查看其中的笔记（目前只有默认的「未分类」）

### 4. 导入导出数据

1. 点击左下角 **"设置"**

2. 导出数据：
   - 点击 "导出所有数据 (JSON)"
   - 保存 JSON 文件

3. 导入数据：
   - 点击 "导入数据"
   - 选择之前导出的 JSON 文件（旧版本导出的文件也可以）
   - 在弹出的确认信息里查看备份的导出时间、笔记数量，以及将被覆盖的现有数据
   - 确认后，扩展会先自动下载一份现有数据的备份，再执行导入
   - 导入完成后界面会自动刷新，提示里会写明备份文件名
   - 如果当前没有笔记（例如刚安装的扩展），不会生成备份

**注意**: 导入会用文件内容覆盖现有数据，暂不支持合并。如果文件不完整或格式不对，导入会被拒绝，现有数据不会被改动。

---

## ❓ 常见问题

### Q1: 找不到星标按钮？

**原因**: 可能是页面还没加载完、DOM 结构变化，或者当前网站还没有稳定支持

**解决**:
1. 刷新页面
2. 打开浏览器控制台（F12）查看错误
3. 检查 URL 是否正确（chat.openai.com 或 chatgpt.com）

目前只有 ChatGPT Web 稳定支持。

### Q2: 构建失败？

**原因**: 网络问题或依赖安装失败

**解决**:
```bash
# 清除缓存
npm cache clean --force

# 使用国内镜像
npm config set registry https://registry.npmmirror.com

# 重新安装
npm install
```

### Q3: Chrome 无法加载扩展？

**原因**: 路径问题或 manifest 错误

**解决**:
1. 确保选择的是 `dist` 目录
2. 检查 `dist` 目录中有 `manifest.json`
3. 查看扩展页面的错误信息

### Q4: 数据会丢失吗？

**正常使用不会丢失。**
- 数据保存在本机浏览器的 IndexedDB
- 关闭浏览器不会丢失
- 重启浏览器数据仍在
- 清除浏览器数据会删除（记得导出备份）
- 当前版本没有跨设备同步，换浏览器或换电脑时，需要导出后再导入

### Q5: 可以在 Edge 中使用吗？

**可以**！
- Edge 基于 Chromium
- 同样加载 `dist` 目录
- 操作步骤相同

---

## 🔧 开发者选项

### 开发模式

```bash
npm run dev  # 启动开发服务器
```

修改代码后会自动重新构建。

### 运行测试

```bash
npm run test  # 运行所有测试
```

### 代码检查

```bash
npm run lint  # 检查代码风格
```

---

## 📞 需要帮助？

- **GitHub Issues**: https://github.com/yanmingzhang2000/riddle-notes/issues
- **文档**: README.md, BUILD.md
- **Node.js 安装**: INSTALL-NODEJS.md

---

## 🎊 完成！

按照以上步骤，你就可以成功安装和使用 Riddle Notes 了！

**关键步骤**:
1. ✅ 安装 Node.js
2. ✅ 克隆项目
3. ✅ 安装依赖 (npm install)
4. ✅ 构建 (npm run build)
5. ✅ 在 Chrome 中加载 dist 目录

有问题随时提问！🚀
