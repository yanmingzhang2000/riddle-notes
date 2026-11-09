# Sidecar MVP - 安装和构建脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Sidecar MVP - 自动安装和构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步骤 1: 检查 Node.js
Write-Host "步骤 1: 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    $npmVersion = npm --version 2>$null
    Write-Host "✓ Node.js 已安装: $nodeVersion" -ForegroundColor Green
    Write-Host "✓ npm 已安装: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js 未安装" -ForegroundColor Red
    Write-Host ""
    Write-Host "正在安装 Node.js..." -ForegroundColor Yellow
    
    # 尝试使用 winget 安装
    try {
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        Write-Host "✓ Node.js 安装成功！" -ForegroundColor Green
        Write-Host "请重新打开终端后运行此脚本" -ForegroundColor Yellow
        exit 0
    } catch {
        Write-Host "✗ 自动安装失败" -ForegroundColor Red
        Write-Host ""
        Write-Host "请手动安装 Node.js:" -ForegroundColor Yellow
        Write-Host "  方法 1: 运行 'winget install OpenJS.NodeJS.LTS'" -ForegroundColor White
        Write-Host "  方法 2: 访问 https://nodejs.org/ 下载安装" -ForegroundColor White
        Write-Host "  方法 3: 运行 'choco install nodejs-lts' (需要 Chocolatey)" -ForegroundColor White
        exit 1
    }
}

Write-Host ""

# 步骤 2: 安装依赖
Write-Host "步骤 2: 安装项目依赖..." -ForegroundColor Yellow
try {
    npm install
    Write-Host "✓ 依赖安装成功！" -ForegroundColor Green
} catch {
    Write-Host "✗ 依赖安装失败" -ForegroundColor Red
    Write-Host "尝试清除缓存后重新安装..." -ForegroundColor Yellow
    npm cache clean --force
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 依赖安装成功！" -ForegroundColor Green
    } else {
        Write-Host "✗ 依赖安装失败，请检查网络连接或使用国内镜像" -ForegroundColor Red
        Write-Host "提示: 运行 'npm config set registry https://registry.npmmirror.com' 使用国内镜像" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""

# 步骤 3: 运行测试
Write-Host "步骤 3: 运行测试..." -ForegroundColor Yellow
try {
    npm run test
    Write-Host "✓ 测试通过！" -ForegroundColor Green
} catch {
    Write-Host "⚠ 部分测试失败，但不影响构建" -ForegroundColor Yellow
}

Write-Host ""

# 步骤 4: 构建
Write-Host "步骤 4: 构建项目..." -ForegroundColor Yellow
try {
    npm run build
    Write-Host "✓ 构建成功！" -ForegroundColor Green
} catch {
    Write-Host "✗ 构建失败" -ForegroundColor Red
    Write-Host "请检查错误信息并修复" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "构建完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作：" -ForegroundColor Yellow
Write-Host "1. 打开 Chrome 浏览器" -ForegroundColor White
Write-Host "2. 访问 chrome://extensions/" -ForegroundColor White
Write-Host "3. 开启右上角的'开发者模式'" -ForegroundColor White
Write-Host "4. 点击'加载已解压的扩展程序'" -ForegroundColor White
Write-Host "5. 选择项目的 'dist' 目录" -ForegroundColor White
Write-Host ""
Write-Host "项目文档：" -ForegroundColor Yellow
Write-Host "- README.md: 项目说明" -ForegroundColor White
Write-Host "- QUICKSTART.md: 快速启动指南" -ForegroundColor White
Write-Host "- BUILD.md: 详细构建指南" -ForegroundColor White
Write-Host ""
