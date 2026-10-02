#!/bin/bash
# TransitLab HK - start the website on macOS / Linux: backend (port 8000) + frontend (port 5173).
# 在 Mac / Linux 上启动网站：后端（8000 端口）+ 前端（5173 端口）。Ctrl+C 停止 / stops both.
cd "$(dirname "$0")/.."
uv run uvicorn backend.main:app --port 8000 &
BACKEND=$!
(cd frontend && npm run dev) &
FRONTEND=$!
trap 'kill $BACKEND $FRONTEND 2>/dev/null' EXIT INT TERM
sleep 8
(command -v open >/dev/null && open http://localhost:5173) || echo "打开浏览器 / open http://localhost:5173"
wait
