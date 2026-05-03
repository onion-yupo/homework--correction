#!/bin/bash
# 一键启动前后端开发服务
# 用法: ./dev.sh

cd "$(dirname "$0")"

# 先杀掉可能残留的旧进程
lsof -ti:3300 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

# 检查 node_modules 是否完整
if [ ! -d "node_modules/@vitejs" ]; then
  echo "⚠️  前端依赖缺失，正在安装..."
  npm ci
fi
if [ ! -d "server/node_modules/hono" ]; then
  echo "⚠️  后端依赖缺失，正在安装..."
  cd server && npm ci && cd ..
fi

# 启动后端（后台）
echo "🚀 启动后端 (port 3300)..."
cd server && npm run start &
BACKEND_PID=$!
cd ..

# 等后端就绪
sleep 2

# 启动前端（前台，Ctrl+C 退出时一起关掉后端）
echo "🚀 启动前端 (port 5173)..."
trap "kill $BACKEND_PID 2>/dev/null; exit" INT TERM
npm run dev
