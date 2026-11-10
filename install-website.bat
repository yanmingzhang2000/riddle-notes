@echo off
echo ========================================
echo Sidecar Website Installation Script
echo ========================================
echo.

echo Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js first:
    echo   Option 1: Run "winget install OpenJS.NodeJS.LTS"
    echo   Option 2: Download from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Node.js is installed:
node --version
echo.

echo Installing website dependencies...
cd website
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Run "cd website"
echo   2. Run "npm run dev" to start development server
echo   3. Run "npm run build" to build for production
echo.
pause
