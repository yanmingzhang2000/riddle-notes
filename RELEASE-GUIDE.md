# 🚀 如何发布新版本（无需本地安装 Node.js）

## 方法：使用 GitHub Actions 自动构建

### 步骤 1: 提交 GitHub Actions 配置

```bash
cd "c:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp"
git add .github/workflows/release.yml
git commit -m "feat: add GitHub Actions auto-build"
git push
```

### 步骤 2: 在 GitHub 上创建 Release

1. 访问 https://github.com/yanmingzhang2000/sidecar/releases
2. 点击 **"Create a new release"**
3. 点击 **"Choose a tag"**
4. 输入版本号，如：`v0.1.0`
5. 点击 **"Create new tag"**
6. 填写 Release 信息：
   - **Title**: `Sidecar MVP v0.1.0 - First Release 🎉`
   - **Description**: 从 RELEASE.md 复制内容
7. 点击 **"Publish release"**

### 步骤 3: 等待自动构建（约 2-3 分钟）

GitHub Actions 会自动：
- ✅ 设置 Node.js 环境
- ✅ 安装依赖
- ✅ 构建项目
- ✅ 运行测试
- ✅ 打包为 `sidecar-extension.zip`
- ✅ 自动上传到 Release

### 步骤 4: 验证构建成功

1. 在 Release 页面查看 `sidecar-extension.zip`
2. 点击下载并测试

---

## 📦 用户如何安装

### 对于用户

1. 访问 https://github.com/yanmingzhang2000/sidecar/releases
2. 下载最新的 `sidecar-extension.zip`
3. 解压到任意目录
4. 在 Chrome 中加载解压后的文件夹

**用户完全不需要 Node.js！**

---

## 🎯 优势

✅ **你不需要安装 Node.js**
✅ **不需要本地构建**
✅ **GitHub 自动完成所有工作**
✅ **每次发布自动生成 ZIP**
✅ **用户下载即可使用**

---

## 📝 示例 Release 流程

```bash
# 1. 提交所有更改
git add .
git commit -m "feat: new feature"
git push

# 2. 创建 tag
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0

# 3. GitHub 自动构建并发布！
# 4. 访问 Releases 页面查看 ZIP 文件
```

---

## ⚠️ 注意事项

1. **Tag 格式必须以 `v` 开头**：`v0.1.0`, `v0.2.0` 等
2. **GitHub Actions 权限**：确保仓库设置中启用了 Actions
3. **构建失败**：查看 Actions 标签页的错误日志

---

## 🎊 就这么简单！

你只需要：
1. 提交代码更改
2. 在 GitHub 创建 Release
3. 等待 2-3 分钟
4. ZIP 文件自动生成！

**用户直接下载使用，无需任何技术要求！**
