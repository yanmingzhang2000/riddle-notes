# Sidecar MVP 构建指南

## 前置要求

在构建此项目之前，需要安装以下工具：

### 1. 安装 Node.js

#### Windows 系统

**选项 1: 使用 winget (推荐)**
```powershell
winget install OpenJS.NodeJS.LTS
```

**选项 2: 使用 Chocolatey**
```powershell
choco install nodejs-lts
```

**选项 3: 手动下载**
1. 访问 https://nodejs.org/
2. 下载 LTS 版本 (推荐 18.x 或更高)
3. 运行安装程序

安装完成后，**重启终端** 或重新打开命令提示符，然后验证安装：
```bash
node --version
npm --version
```

### 2. 验证安装

```bash
node --version  # 应该显示 v18.x.x 或更高
npm --version   # 应该显示 9.x.x 或更高
```

## 构建步骤

### 1. 安装依赖

在项目根目录下运行：

```bash
npm install
```

这将安装所有必要的依赖包，包括：
- React 和 React DOM
- Vite 和构建工具
- TypeScript
- Tailwind CSS
- Dexie (IndexedDB 封装)
- 其他开发依赖

### 2. 开发模式

启动开发服务器：

```bash
npm run dev
```

这会：
- 启动 Vite 开发服务器
- 监听文件变化并自动重新构建
- 在 `dist` 目录生成开发版本

### 3. 生产构建

构建生产版本：

```bash
npm run build
```

这会：
- 编译 TypeScript 代码
- 打包所有资源
- 优化代码大小
- 在 `dist` 目录生成生产版本

### 4. 运行测试

```bash
npm run test
```

或在 UI 模式下运行：

```bash
npm run test:ui
```

## 加载扩展到 Chrome

### 方法 1: 加载已解压的扩展

1. 打开 Chrome 浏览器
2. 在地址栏输入 `chrome://extensions/` 并回车
3. 在右上角开启"开发者模式"
4. 点击左上角的"加载已解压的扩展程序"按钮
5. 浏览到项目的 `dist` 目录并选择它
6. 扩展将出现在工具栏中

### 方法 2: 打包扩展（生产环境）

1. 在 `chrome://extensions/` 页面
2. 点击"打包扩展程序"按钮
3. 扩展根目录选择 `dist` 目录
4. 私有密钥文件首次可留空（会自动生成）
5. 点击"打包扩展程序"
6. 会生成 `.crx` 文件和 `.pem` 私钥文件

## 开发工作流

### 推荐的开发流程

1. **启动开发服务器**
   ```bash
   npm run dev
   ```

2. **在 Chrome 中加载扩展**
   - 首次加载：加载 `dist` 目录
   - 后续更新：点击扩展卡片上的刷新按钮

3. **开发调试**
   - Background Script: 在 `chrome://extensions/` 点击"Service Worker"
   - Content Script: 在目标页面打开开发者工具
   - Side Panel: 右键点击 Side Panel 选择"检查"

4. **实时更新**
   - 修改代码后，Vite 会自动重新构建
   - 在扩展页面点击刷新按钮应用更改

### 调试技巧

#### 查看 Service Worker 日志
1. 访问 `chrome://extensions/`
2. 找到 Sidecar 扩展
3. 点击"Service Worker"链接
4. 查看 Console 输出

#### 查看 Content Script 日志
1. 打开 ChatGPT 网站
2. 按 F12 打开开发者工具
3. 查看 Console 输出（前缀 `[Sidecar]`）

#### 查看 Side Panel 日志
1. 打开 Side Panel
2. 右键点击 Side Panel 内容区域
3. 选择"检查"
4. 查看 Console 输出

## 常见问题

### npm install 失败

**问题**: 权限错误
**解决**: 
- Windows: 以管理员身份运行 PowerShell
- Mac/Linux: 使用 `sudo npm install`

**问题**: 网络错误
**解决**: 
- 使用国内镜像: `npm config set registry https://registry.npmmirror.com`
- 或使用 pnpm/yarn

### 构建失败

**问题**: TypeScript 错误
**解决**: 
- 检查 Node.js 版本是否符合要求
- 删除 `node_modules` 和 `package-lock.json`，重新安装

### 扩展加载失败

**问题**: "Manifest file is invalid"
**解决**: 
- 检查 `public/manifest.json` 格式
- 确保构建成功且 `dist` 目录存在

**问题**: 找不到图标文件
**解决**: 
- 确保 `public/icons` 目录中有图标文件
- 或暂时使用默认图标

### 星标按钮未显示

**问题**: ChatGPT 页面上看不到星标按钮
**解决**: 
1. 刷新页面
2. 检查 Content Script 是否加载（开发者工具 → Console）
3. 检查是否有 JavaScript 错误
4. 确认 URL 匹配 `chat.openai.com` 或 `chatgpt.com`

## 下一步

构建成功后：

1. ✅ 在 ChatGPT 中测试星标收藏功能
2. ✅ 查看 Side Panel 是否正常显示
3. ✅ 测试 Prompt 保存和管理
4. ✅ 验证数据持久化（关闭浏览器后数据不丢失）

## 生产部署

准备发布时：

1. 更新 `public/manifest.json` 中的版本号
2. 准备正式的图标文件（16x16, 32x32, 48x48, 128x128）
3. 运行 `npm run build`
4. 打包扩展为 `.crx` 文件
5. 提交到 Chrome Web Store（可选）

## 支持

遇到问题？

1. 查看 README.md
2. 检查 GitHub Issues
3. 查看浏览器控制台错误日志
