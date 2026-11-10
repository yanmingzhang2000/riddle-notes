# Sidecar Website

这是 Sidecar 产品落地页，一个 Local-first Prompt Workspace。

## 开发

```bash
cd website
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 部署到 GitHub Pages

### 方法 1: 自动部署（推荐）

项目根目录已配置 GitHub Actions，push 到 main 分支会自动部署。

### 方法 2: 手动部署

1. 构建项目:
   ```bash
   npm run build
   ```

2. 将 `dist` 目录内容推送到 `gh-pages` 分支

3. 在 GitHub 仓库设置中启用 GitHub Pages，选择 `gh-pages` 分支

## 技术栈

- React 18
- TypeScript
- Vite
- CSS Variables
- Canvas API (背景动画)

## 风格

- Warm Editorial / Paper Premium 风格
- 浅色米白背景
- 编辑感排版
- 高级但不冷漠

## 版本信息

版本信息存储在 `version.json` 文件中，可以根据实际发布情况更新。
