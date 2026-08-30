@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo    坦克大战 - GitHub 一键上传脚本
echo ============================================
echo.

rem ===== 1. 定位 Git =====
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Git\cmd\git.exe" (
    set "GIT=C:\Program Files\Git\cmd\git.exe"
  ) else if exist "C:\Program Files (x86)\Git\cmd\git.exe" (
    set "GIT=C:\Program Files (x86)\Git\cmd\git.exe"
  ) else if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
    set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
  ) else (
    echo [错误] 没找到 Git，请先安装：https://git-scm.com/download/win
    pause
    exit /b 1
  )
)

rem ===== 2. 初始化仓库 =====
if not exist ".git" (
  echo [1/5] 初始化 Git 仓库...
  "%GIT%" init -b main
) else (
  echo [1/5] 已在 Git 仓库中。
)

rem ===== 3. 提交身份（仅本机未配置时兜底，只影响本仓库） =====
"%GIT%" config user.email >nul 2>nul
if errorlevel 1 (
  "%GIT%" config user.name "LYD"
  "%GIT%" config user.email "lyd-tank@users.noreply.github.com"
  echo       未检测到 Git 身份，已用默认身份 LYD。
)

rem ===== 4. 提交所有文件 =====
echo [2/5] 提交游戏文件...
"%GIT%" add -A
"%GIT%" rev-parse HEAD >nul 2>nul
if errorlevel 1 (
  "%GIT%" commit -m "坦克大战游戏首次发布"
) else (
  "%GIT%" diff --cached --quiet
  if errorlevel 1 (
    "%GIT%" commit -m "更新游戏 %date%"
  ) else (
    echo       没有文件变化，跳过提交。
  )
)

rem ===== 5. 配置远程仓库（首次运行需要） =====
"%GIT%" remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [3/5] 请先在 GitHub 创建一个空仓库：
  echo   - 浏览器即将打开 https://github.com/new
  echo   - Repository name 建议填: tankedazhan
  echo   - 选择 Private（私有）
  echo   - 【不要】勾选 Add README / .gitignore / license
  echo   - 点 Create repository 后，复制浏览器地址栏里的仓库地址
  echo.
  start https://github.com/new
  set /p "REPO_URL=粘贴仓库地址（形如 https://github.com/用户名/tankedazhan.git）后回车: "
  if "!REPO_URL!"=="" (
    echo [错误] 未输入地址，已取消。重新运行本脚本即可。
    pause
    exit /b 1
  )
  "%GIT%" remote add origin "!REPO_URL!"
) else (
  echo [3/5] 远程仓库已配置。
)

rem ===== 6. 推送 =====
echo [4/5] 推送到 GitHub...
echo       首次推送会自动弹出浏览器要求登录 GitHub 并授权，请按提示完成。
"%GIT%" branch -M main
"%GIT%" push -u origin main
if errorlevel 1 (
  echo.
  echo [失败] 推送未成功，请把窗口里的红色错误信息截图发我。
  pause
  exit /b 1
)

echo.
echo [5/5] ============================================
echo   上传成功！
echo.
echo   想让朋友直接在浏览器玩（可选）：
echo   1. 打开 GitHub 上你的仓库页面 - Settings - Pages
echo   2. Source 选 "Deploy from a branch"
echo   3. Branch 选 main / (root)，点 Save
echo   4. 等约 1 分钟刷新页面，即可得到网址：
echo      https://你的用户名.github.io/tankedazhan/
echo ============================================
echo.
pause
