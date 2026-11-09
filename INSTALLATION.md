# 📦 Sidecar MVP 安装指南

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
git clone https://github.com/yanmingzhang2000/sidecar.git
cd sidecar

# 方式 B: 直接下载 ZIP
# 1. 访问 https://github.com/yanmingzhang2000/sidecar
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
6. 完成！Sidecar 图标会出现在工具栏

---

## 方式 2: 下载构建版本（无需 Node.js）

### 步骤

#### 1. 创建发布包（需要 Node.js 一次）

如果你已经安装了 Node.js：

```bash
git clone https://github.com/yanmingzhang2000/sidecar.git
cd sidecar
npm install
npm run build

# 打包 dist 目录为 ZIP
# Windows: 右键 dist 文件夹 → 发送到 → 压缩(zipped)文件夹
# Mac/Linux: zip -r sidecar-extension.zip dist/
```

#### 2. 分享给他人

将生成的 `sidecar-extension.zip` 发送给其他人：

- Email
- 网盘（百度云、Google Drive）
- 微信/QQ

#### 3. 接收者安装

1. 解压 `sidecar-extension.zip`
2. 在 Chrome 中加载解压后的文件夹

---

## 方式 3: 从 GitHub Release 下载（未来）

将来会在 GitHub Releases 页面提供打包好的 ZIP 文件。

---

## 🎮 使用方法

### 1. 收藏 Prompt

1. 打开支持的 AI 平台：
   - **ChatGPT**: https://chat.openai.com 或 https://chatgpt.com
   - **Claude**: https://claude.ai
   - **Gemini**: https://gemini.google.com
   - **WorkBuddy**: https://workbuddy.ai

2. 发送消息并等待 AI 回复

3. 在 AI 回复旁边找到 **星标按钮 (☆)**

4. 点击星标保存 Prompt 和回复

### 2. 查看和管理

1. 点击浏览器工具栏的 **Sidecar 图标**

2. Side Panel 会打开，显示所有 Prompt

3. 使用左侧导航：
   - 全部 Prompt
   - 最近收藏
   - 我的收藏
   - 文件夹分类
   - 标签筛选

### 3. 搜索和筛选

- 在搜索框输入关键词
- 点击文件夹筛选
- 点击标签筛选
- 按平台筛选

### 4. 导入导出数据

1. 点击左下角 **"设置"**

2. 导出数据：
   - 点击 "导出所有数据 (JSON)"
   - 保存 JSON 文件

3. 导入数据：
   - 点击 "导入数据"
   - 选择之前导出的 JSON 文件
   - 确认导入

---

## ❓ 常见问题

### Q1: 找不到星标按钮？

**原因**: 可能是页面还没加载完或 DOM 结构变化

**解决**:
1. 刷新页面
2. 打开浏览器控制台（F12）查看错误
3. 检查 URL 是否正确（chat.openai.com 或 chatgpt.com）

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

**不会**！
- 所有数据保存在浏览器 IndexedDB
- 关闭浏览器不会丢失
- 重启浏览器数据仍在
- 清除浏览器数据会删除（记得导出备份）

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

- **GitHub Issues**: https://github.com/yanmingzhang2000/sidecar/issues
- **文档**: README.md, BUILD.md
- **Node.js 安装**: INSTALL-NODEJS.md

---

## 🎊 完成！

按照以上步骤，你就可以成功安装和使用 Sidecar MVP 了！

**关键步骤**:
1. ✅ 安装 Node.js
2. ✅ 克隆项目
3. ✅ 安装依赖 (npm install)
4. ✅ 构建 (npm run build)
5. ✅ 在 Chrome 中加载 dist 目录

有问题随时提问！🚀
