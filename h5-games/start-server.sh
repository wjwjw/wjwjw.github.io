#!/usr/bin/env bash
# 本地开发服务器（Linux / macOS / Git Bash）
# 用法：bash h5-games/start-server.sh   （在仓库根目录下执行亦可）
cd "$(dirname "$0")/.." || exit 1

echo "本机局域网 IP => http://$(hostname -I | awk '{print $1}'):8000"
echo
echo "正在启动本地服务器：http://0.0.0.0:8000  （根目录 = 仓库根）"
echo "按 Ctrl+C 停止。"
echo

exec python3 -m http.server 8000 --bind 0.0.0.0
