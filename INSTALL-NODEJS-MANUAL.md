# 🔧 手动安装 Node.js 指南

由于自动安装遇到问题，请按以下步骤手动安装：

---

## 方法 1: 官网下载（最可靠）

### 步骤 1: 下载 Node.js

1. 打开浏览器，访问: **https://nodejs.org/**

2. 点击 **"20.18.0 LTS"** 按钮（或最新的 LTS 版本）

3. 下载完成后，运行安装文件 `node-v20.18.0-x64.msi`

4. 安装向导中一直点击 **"Next"**（使用默认设置即可）

5. 最后点击 **"Install"**

6. 安装完成后点击 **"Finish"**

### 步骤 2: 验证安装

1. **关闭所有打开的 PowerShell 窗口**（重要！）

2. 按 `Win + X`，选择 **"Windows PowerShell"**

3. 输入以下命令验证：
   ```bash
   node --version
   npm --version
   ```

4. 应该显示版本号，如：
   ```
   v20.18.0
   10.8.2
   ```

---

## 方法 2: 使用 Chocolatey（如果已安装）

如果你已经安装了 Chocolatey：

```powershell
choco install nodejs-lts
```

---

## 方法 3: 使用 Scoop（如果已安装）

如果你已经安装了 Scoop：

```bash
scoop install nodejs-lts
```

---

## ✅ 安装完成后

安装 Node.js 后，打开新的 PowerShell 窗口，然后运行：

```bash
cd "c:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp"
.\install.bat
```

或手动执行：

```bash
cd "c:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp"
npm install
npm run build
```

---

## 🎯 预计时间

- 下载 Node.js: 2-3 分钟
- 安装 Node.js: 1-2 分钟
- 构建项目: 2-3 分钟
- **总计**: 约 5-8 分钟

---

## ❓ 遇到问题？

### 问题 1: 无法访问 nodejs.org

**解决**: 使用国内镜像
- 访问: https://npmmirror.com/mirrors/node/
- 下载最新的 LTS 版本

### 问题 2: 安装后命令不识别

**解决**:
1. 重启 PowerShell
2. 重启电脑
3. 检查环境变量 PATH 是否包含 Node.js 路径

### 问题 3: 权限不足

**解决**: 以管理员身份运行 PowerShell

---

## 📞 需要帮助？

如果安装过程中遇到问题，可以：
1. 截图错误信息
2. 告诉我具体的错误提示
3. 我会帮你解决

---

**下载地址**: https://nodejs.org/

**选择版本**: LTS (Long Term Support)

**安装时间**: 约 5 分钟
