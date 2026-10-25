@echo off
title AI 面试官
setlocal
cd /d "%~dp0"

echo ============================================
echo   AI 面试官 启动中...
echo ============================================
echo.

echo [1/4] 检查运行环境...
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 找不到 python 命令。请先安装 Python 3.12 并勾选 "Add to PATH"。
    pause
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 找不到 npm 命令。请先安装 Node.js（LTS 版）并重启电脑。
    pause
    exit /b 1
)
echo       环境OK。
echo.

echo [2/4] 检查端口占用（9000 / 5173）...
netstat -ano | findstr ":9000 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [警告] 9000 端口已被占用——多半是上一次的服务窗口还开着。
    echo        请先关闭标题为 AIInterviewer-后端 的旧窗口（直接点 X），再重新双击本文件。
    pause
    exit /b 1
)
echo       端口空闲。
echo.

if not exist "backend\.venv\Scripts\python.exe" (
    echo [3/4] 首次运行：创建虚拟环境并安装后端依赖（几分钟）...
    python -m venv backend\.venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败。
        pause
        exit /b 1
    )
    backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        echo [错误] 后端依赖安装失败，请检查网络。
        pause
        exit /b 1
    )
) else (
    echo [3/4] 后端环境已就绪。
)
echo.

if not exist "frontend\node_modules" (
    echo [首次运行] 安装前端依赖（几分钟）...
    pushd frontend
    call npm install
    if errorlevel 1 (
        popd
        echo [错误] 前端依赖安装失败，请检查网络。
        pause
        exit /b 1
    )
    popd
)
echo       前端环境已就绪。
echo.

echo [4/4] 启动后端(9000)与前端(5173)...
echo       如弹出 Windows 防火墙提示，请选「允许访问」（手机同 WiFi 访问需要）。
del backend\backend.log >nul 2>nul
start "AIInterviewer-后端" cmd /k "backend\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 9000 >> backend\backend.log 2>&1"
start "AIInterviewer-前端" cmd /k "cd frontend && npm run dev"

echo       等待后端就绪...
set /a tries=0

:wait_backend
curl -s -m 2 -o nul http://127.0.0.1:9000/api/health
if not errorlevel 1 goto backend_ok
set /a tries+=1
if %tries% geq 20 goto backend_fail
timeout /t 2 /nobreak >nul
goto wait_backend

:backend_fail
echo.
echo [错误] 后端 40 秒内未能启动。最近日志如下（完整日志见 backend\backend.log）：
echo --------------------------------------------------
powershell -NoProfile -Command "Get-Content -Tail 25 'backend\backend.log'" 2>nul
echo --------------------------------------------------
echo 常见原因：9000端口被旧窗口占用 / 杀毒软件拦截 python 联网。
echo 若端口没被占用仍失败：可能是 Windows 保留端口段圈占（Hyper-V/WSL），
echo 管理员运行 netsh interface ipv4 show excludedportrange protocol=tcp 查看换可用端口。
echo 请把上面的错误信息发给 AI 助手协助排查。
pause
exit /b 1

:backend_ok
echo       后端已就绪。等待前端就绪...
set /a tries=0

:wait_frontend
curl -s -m 2 -o nul http://127.0.0.1:5173
if not errorlevel 1 goto open_browser
set /a tries+=1
if %tries% geq 15 goto open_browser
timeout /t 2 /nobreak >nul
goto wait_frontend

:open_browser
start http://localhost:5173

echo.
echo ============================================
echo   启动完成！浏览器将自动打开。
echo   电脑访问  http://localhost:5173
echo   后端日志  backend\backend.log（排错用）
echo   两个服务窗口请保持打开，用完直接关窗口即可。
echo ============================================
echo   本窗口 5 秒后自动关闭。
timeout /t 5 /nobreak >nul
endlocal
rem ============================================================
rem v2.6-2 最小回归测试（改完代码跑，全绿再交付）：
rem   后端单测: cd backend ^&^& .venv\Scripts\python.exe -m pytest tests/ -q
rem   前端冒烟: cd frontend ^&^& npx playwright test
rem ============================================================
