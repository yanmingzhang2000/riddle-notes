# Sidecar MVP 快速启动指南

## 🚀 5 分钟快速开始

### 步骤 1: 安装 Node.js

**Windows (推荐使用 winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

安装完成后，**重启终端**。

**验证安装:**
```bash
node --version   # 应显示 v18.x.x 或更高
npm --version    # 应显示 9.x.x 或更高
```

### 步骤 2: 安装依赖

在项目目录下运行：

```bash
npm install
```

等待依赖安装完成（约 1-2 分钟）。

### 步骤 3: 构建项目

```bash
npm run build
```

构建成功后会在项目根目录生成 `dist` 文件夹。

### 步骤 4: 加载扩展到 Chrome

1. 打开 Chrome 浏览器
2. 地址栏输入：`chrome://extensions/`
3. 右上角开启 **"开发者模式"**
4. 点击 **"加载已解压的扩展程序"**
5. 选择项目的 `dist` 文件夹
6. 完成！扩展图标会出现在工具栏

### 步骤 5: 测试功能

1. **测试星标收藏**
   - 打开 https://chat.openai.com
   - 发送一条消息给 ChatGPT
   - 在 AI 回复旁边找到星标按钮 (☆)
   - 点击星标收藏

2. **查看收藏的 Prompt**
   - 点击浏览器工具栏的 Sidecar 图标
   - Side Panel 会打开显示所有 Prompt
   - 点击 Prompt 卡片查看详情

3. **验证数据持久化**
   - 关闭浏览器
   - 重新打开浏览器和 Sidecar
   - 确认数据仍然存在

## 🎯 核心功能

### ✅ 已实现 (Phase 1)

- **一键收藏**: 在 ChatGPT 中点击星标收藏 Prompt
- **本地存储**: 所有数据保存在浏览器 IndexedDB
- **Prompt 管理**: 列表查看、搜索、筛选
- **版本管理**: 查看历史版本、切换版本
- **运行记录**: 保存每次运行的输入输出
- **文件夹**: 分类管理 Prompt
- **标签**: 跨文件夹标记 Prompt

### 🚧 待实现 (Phase 2+)

- Claude / Gemini / WorkBuddy 适配器
- AI 改进 Prompt 功能
- 版本 Diff 对比
- 完整的导入导出
- 附件处理

## 🛠️ 开发模式

如果需要修改代码并实时预览：

```bash
npm run dev
```

然后在 `chrome://extensions/` 点击扩展的刷新按钮。

## 📚 详细文档

- **README.md**: 完整的项目说明
- **BUILD.md**: 详细的构建指南
- **代码注释**: 每个文件都有详细注释

## ⚠️ 常见问题

### 1. npm install 失败

**解决方案：**
```bash
# 清除缓存
npm cache clean --force

# 使用国内镜像
npm config set registry https://registry.npmmirror.com

# 重新安装
npm install
```

### 2. 找不到星标按钮

**检查步骤：**
1. 确认扩展已加载（`chrome://extensions/`）
2. 刷新 ChatGPT 页面
3. 打开浏览器控制台（F12）查看是否有错误
4. 确认 URL 是 `chat.openai.com` 或 `chatgpt.com`

### 3. 数据丢失

**原因：**
- 浏览器清除数据时会删除 IndexedDB
- 使用隐私模式会导致数据不持久

**解决方案：**
- 使用正常模式（非隐私模式）
- 定期导出数据备份

### 4. 构建错误

**检查 Node.js 版本：**
```bash
node --version  # 需要 v18 或更高
```

**删除重建：**
```bash
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

## 🎉 成功标志

如果看到以下内容，说明项目已经成功运行：

- ✅ Chrome 扩展列表中显示 "Sidecar"
- ✅ ChatGPT 页面 AI 回复旁边有星标按钮
- ✅ 点击扩展图标能打开 Side Panel
- ✅ 点击星标能保存 Prompt
- ✅ Side Panel 能看到保存的 Prompt
- ✅ 点击 Prompt 能查看详情

## 📞 获取帮助

遇到问题？

1. 查看 **BUILD.md** 详细构建指南
2. 查看 **README.md** 功能说明
3. 检查浏览器控制台错误信息
4. 查看 Chrome 扩展页面的错误提示

---

**准备好了吗？开始构建你的第一个 Prompt 管理工具吧！** 🚀
