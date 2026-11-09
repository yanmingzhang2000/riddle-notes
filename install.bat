@echo off
REM Sidecar MVP - 快速安装脚本
REM 此脚本需要 Node.js 环境

echo ========================================
echo Sidecar MVP - 快速安装
echo ========================================
echo.

REM 检查 Node.js
echo [步骤 1/4] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Node.js 未安装
    echo.
    echo 请先安装 Node.js:
    echo   方法 1: 运行 'winget install OpenJS.NodeJS.LTS'
    echo   方法 2: 访问 https://nodejs.org/ 下载
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js 已安装
node --version
echo.

REM 安装依赖
echo [步骤 2/4] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    echo.
    echo 尝试使用国内镜像:
    echo   npm config set registry https://registry.npmmirror.com
    echo   npm install
    echo.
    pause
    exit /b 1
)

echo [OK] 依赖安装成功
echo.

REM 构建
echo [步骤 3/4] 构建项目...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    echo 请查看错误信息
    pause
    exit /b 1
)

echo [OK] 构建成功
echo.

REM 完成
echo [步骤 4/4] 安装完成！
echo.
echo ========================================
echo 下一步操作:
echo ========================================
echo.
echo 1. 打开 Chrome 浏览器
echo 2. 访问: chrome://extensions/
echo 3. 开启右上角的"开发者模式"
echo 4. 点击"加载已解压的扩展程序"
echo 5. 选择项目的 'dist' 目录
echo.
echo 项目文档:
echo   - INSTALLATION.md: 安装指南
echo   - README.md: 项目说明
echo   - QUICKSTART.md: 快速开始
echo.
echo 项目地址: https://github.com/yanmingzhang2000/sidecar
echo.
pause
