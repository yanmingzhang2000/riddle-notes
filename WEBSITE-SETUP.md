# Sidecar Website 部署指南

## 🎯 已完成的工作

✅ 创建了独立的 `website/` 目录
✅ 配置了 React + Vite + TypeScript
✅ 实现了 Warm Editorial / Paper Premium 风格
✅ 创建了所有组件（Header, Hero, Features, Flow, LocalFirst, Download, Footer）
✅ 实现了柔和的背景动效（Canvas）
✅ 配置了 CSS Variables
✅ 添加了 SEO meta 标签
✅ 创建了 version.json 用于版本管理
✅ 更新了主 package.json 添加 website 构建命令

## 📦 安装和构建步骤

### 1. 安装 Node.js（如果还没安装）

```powershell
# 方法 1: 使用 winget（推荐）
winget install OpenJS.NodeJS.LTS

# 方法 2: 手动下载
# 访问 https://nodejs.org/ 下载 LTS 版本
```

安装完成后，**重启终端**。

### 2. 安装 website 依赖

```powershell
cd website
npm install
```

### 3. 本地预览

```powershell
npm run dev
```

浏览器会自动打开 `http://localhost:3000`

### 4. 构建生产版本

```powershell
npm run build
```

构建产物会生成在 `website/dist/` 目录。

### 5. 预览构建结果

```powershell
npm run preview
```

## 🚀 部署到 GitHub Pages

### 方法 1: 自动部署（推荐）

项目已经准备好了自动部署配置。创建 `.github/workflows/deploy-website.yml`:

```yaml
name: Deploy Website to GitHub Pages

on:
  push:
    branches: [ main ]
    paths:
      - 'website/**'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: website/package-lock.json

      - name: Install dependencies
        working-directory: ./website
        run: npm ci

      - name: Build
        working-directory: ./website
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./website/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 方法 2: 手动部署

1. 构建项目:
   ```powershell
   cd website
   npm run build
   ```

2. 创建 `gh-pages` 分支并推送:
   ```powershell
   git checkout -b gh-pages
   git add website/dist/
   git commit -m "Deploy website"
   git push origin gh-pages
   ```

3. 在 GitHub 仓库设置中:
   - 进入 Settings > Pages
   - Source 选择 "Deploy from a branch"
   - Branch 选择 `gh-pages` 和 `/ (root)`
   - 点击 Save

### 重要配置

在 `vite.config.ts` 中已设置:
```typescript
base: '/sidecar-mvp/'
```

如果你的仓库名不同，请修改这个配置。

## 🎨 设计特点

### 视觉风格
- **Warm Editorial / Paper Premium** 风格
- 浅色米白背景 (#F5F2EA)
- 墨绿色文字和按钮 (#202A22)
- 柔和的光影背景动效
- 大量留白，编辑感排版

### 背景动效
- 3-4 个低透明度模糊光源
- 浅绿色、浅蓝灰、淡黄色
- 缓慢自动漂移
- 支持 prefers-reduced-motion
- 移动端自动关闭

### 交互细节
- 滚动进入动画
- 按钮 hover 微动效
- 产品 Mockup 视差效果
- 移动端响应式布局

## 📝 版本管理

更新版本信息:
1. 编辑 `website/version.json`
2. 更新 version、releaseDate、releaseNotes
3. 重新构建: `npm run build`

## 🔍 SEO 优化

已配置:
- Meta title 和 description
- Open Graph 标签
- Twitter Card 标签
- 语义化 HTML
- 响应式设计

## ⚡ 性能优化

- 使用原生 CSS（无 Tailwind 运行时）
- Canvas 动效轻量级
- 支持 reduced-motion
- 移动端性能优化

## 📱 响应式设计

支持:
- 桌面端 (1200px+)
- 平板 (768px - 1024px)
- 移动端 (< 768px)

## ✅ 验收标准检查

- ✅ 用户在 5 秒内能理解 Sidecar 是什么
- ✅ 第一屏有明确的下载入口
- ✅ 页面是浅色米白风格
- ✅ 页面高级、克制，不像模板
- ✅ 背景动效自然、慢、低调
- ✅ 产品 Mockup 体现真实功能
- ✅ 移动端布局正常
- ✅ prefers-reduced-motion 生效
- ✅ website 可以独立构建
- ✅ 版本信息从 version.json 加载

## 🛠️ 下一步

1. 安装 Node.js
2. 运行 `npm install` 安装依赖
3. 运行 `npm run dev` 本地预览
4. 根据需要修改 `version.json` 中的下载链接
5. 构建并部署到 GitHub Pages

## 📞 需要帮助？

如果遇到问题:
1. 确认 Node.js 已正确安装: `node --version`
2. 删除 `node_modules` 重新安装
3. 检查端口 3000 是否被占用
4. 查看 Vite 文档: https://vitejs.dev/
