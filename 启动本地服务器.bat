@echo off
cd /d "%~dp0"
echo ============================================
echo   坦克大战 - 本地服务器模式（完整体验）
echo ============================================
echo.
echo 浏览器即将自动打开游戏，本黑窗口请保持开启。
echo 玩完直接关闭本窗口即停止服务器。
echo.
start "" "http://127.0.0.1:8090/index.html"
where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server 8090
  goto end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -m http.server 8090
  goto end
)
echo [提示] 未找到 Python。直接双击 index.html 也能玩，
echo        仅第一人称视角下的照片底图需要服务器模式。
:end
pause