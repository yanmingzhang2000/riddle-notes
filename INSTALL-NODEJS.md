# Node.js 安装指南

由于您的系统未安装 Node.js，请按照以下步骤安装：

## 方法 1: 使用 winget (推荐)

```powershell
# 以管理员身份运行 PowerShell
winget install OpenJS.NodeJS.LTS
```

安装完成后，**关闭并重新打开终端**。

## 方法 2: 使用 Chocolatey

如果您已安装 Chocolatey：

```powershell
choco install nodejs-lts
```

## 方法 3: 手动下载安装

1. 访问 https://nodejs.org/
2. 下载 LTS 版本（推荐 18.x 或更高）
3. 运行安装程序
4. 安装完成后重启终端

## 验证安装

```bash
node --version   # 应显示 v18.x.x 或更高
npm --version    # 应显示 9.x.x 或更高
```

## 安装后操作

安装 Node.js 后，请运行：

```bash
# Windows 用户可以运行批处理文件
install-and-build.bat

# 或者手动运行以下命令
npm install
npm run build
```

## 使用国内镜像（可选）

如果 npm 安装速度慢，可以使用国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
```

## 常见问题

### 1. 找不到 node 命令

**原因**: Node.js 未正确安装或环境变量未设置

**解决**: 
- 重新安装 Node.js
- 重启终端
- 检查 PATH 环境变量是否包含 Node.js 路径

### 2. npm install 失败

**原因**: 网络问题或权限问题

**解决**:
- 使用管理员权限运行终端
- 使用国内镜像：`npm config set registry https://registry.npmmirror.com`
- 清除缓存：`npm cache clean --force`

### 3. winget 命令不可用

**原因**: Windows 版本过低或未安装 App Installer

**解决**:
- 更新 Windows 到最新版本
- 从 Microsoft Store 安装 "App Installer"
- 使用方法 3 手动安装

## 仍然无法安装？

如果您仍然无法安装 Node.js，可以：

1. 联系系统管理员协助安装
2. 使用便携版 Node.js（无需安装）
3. 使用 nvm-windows 管理 Node.js 版本

下载 nvm-windows: https://github.com/coreybutler/nvm-windows/releases
