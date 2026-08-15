@echo off
REM ============================================================
REM  掌中灵 TV 游戏厅 —— 本地开发服务器
REM ------------------------------------------------------------
REM  用途：在开发机上启动一个静态服务器，让同一局域网的电视设备
REM        通过「开发机 IP:端口」直接访问 h5-games 下的游戏做调试。
REM
REM  用法：
REM    1) 双击本文件（或在 h5-games 目录里执行 start-server.bat）
REM    2) 终端会打印出本机局域网 IP，例如 http://192.168.2.100:8000
REM    3) 在电视上用下面任意一种方式打开启动器（二选一）：
REM         a) 正式安装的 App：adb shell am start -n com.wjwjw.tvlauncher/.MainActivity ^
REM              -e url "http://192.168.2.100:8000/tv-h5-app/index.html"
REM         b) 浏览器/文件管理器打开 http://192.168.2.100:8000/tv-h5-app/index.html
REM    4) 启动器会以「本地开发机」模式加载游戏：
REM         http://192.168.2.100:8000/h5-games/maze-challenge/index.html
REM
REM  注意：服务器根目录是「仓库根」（这样 tv-h5-app 和 h5-games 同源，
REM        启动器注入的 TV 遥控增强脚本才能生效）。若只想暴露 h5-games，
REM        把下面第 2 处 cd 改成保持当前目录即可（但启动器需走 GitHub）。
REM ============================================================

cd /d "%~dp0.."

REM 打印本机局域网 IP，方便填到电视 / config.js
python -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print('本机局域网 IP => http://%s:8000' % s.getsockname()[0])" 2>nul

echo.
echo 正在启动本地服务器：http://0.0.0.0:8000  （根目录 = 仓库根）
echo 按 Ctrl+C 停止。
echo.

REM 优先 python，其次 py / python3
where python >nul 2>nul && (python -m http.server 8000 --bind 0.0.0.0) || ^
where py >nul 2>nul && (py -m http.server 8000 --bind 0.0.0.0) || ^
python3 -m http.server 8000 --bind 0.0.0.0

pause
