#!/bin/bash
# TransitLab HK - play the demo on macOS / Linux: starts the engine (port 8000) and opens /game.
# 在 Mac / Linux 上开玩：启动计算引擎（8000 端口）并打开 /game。Ctrl+C 停止 / stops it.
cd "$(dirname "$0")/.."
(sleep 6; (command -v open >/dev/null && open http://127.0.0.1:8000/game/) || echo "打开浏览器 / open http://127.0.0.1:8000/game/") &
uv run uvicorn backend.main:app --port 8000
