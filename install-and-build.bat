@echo off
REM Sidecar MVP - 安装和构建脚本 (批处理版本)

echo ========================================
echo Sidecar MVP - 自动安装和构建
echo ========================================
echo.

REM 步骤 1: 检查 Node.js
echo 步骤 1: 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Node.js 已安装
    node --version
    npm --version
) else (
    echo [ERROR] Node.js 未安装
    echo.
    echo 请手动安装 Node.js:
    echo   方法 1: 运行 'winget install OpenJS.NodeJS.LTS'
    echo   方法 2: 访问 https://nodejs.org/ 下载安装
    echo   方法 3: 运行 'choco install nodejs-lts' (需要 Chocolatey)
    pause
    exit /b 1
)

echo.

REM 步骤 2: 安装依赖
echo 步骤 2: 安装项目依赖...
call npm install
if %errorlevel% equ 0 (
    echo [OK] 依赖安装成功！
) else (
    echo [ERROR] 依赖安装失败
    echo 尝试清除缓存后重新安装...
    call npm cache clean --force
    call npm install
    if %errorlevel% equ 0 (
        echo [OK] 依赖安装成功！
    ) else (
        echo [ERROR] 依赖安装失败，请检查网络连接或使用国内镜像
        echo 提示: 运行 'npm config set registry https://registry.npmmirror.com' 使用国内镜像
        pause
        exit /b 1
    )
)

echo.

REM 步骤 3: 运行测试
echo 步骤 3: 运行测试...
call npm run test
if %errorlevel% equ 0 (
    echo [OK] 测试通过！
) else (
    echo [WARNING] 部分测试失败，但不影响构建
)

echo.

REM 步骤 4: 构建
echo 步骤 4: 构建项目...
call npm run build
if %errorlevel% equ 0 (
    echo [OK] 构建成功！
) else (
    echo [ERROR] 构建失败
    echo 请检查错误信息并修复
    pause
    exit /b 1
)

echo.
echo ========================================
echo 构建完成！
echo ========================================
echo.
echo 下一步操作：
echo 1. 打开 Chrome 浏览器
echo 2. 访问 chrome://extensions/
echo 3. 开启右上角的'开发者模式'
echo 4. 点击'加载已解压的扩展程序'
echo 5. 选择项目的 'dist' 目录
echo.
pause
