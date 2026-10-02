#!/bin/bash
# TransitLab HK - one-click setup for macOS / 一键配置 Mac 环境
# Run in Terminal from the project folder / 在「终端」里进入项目文件夹后运行：
#     bash scripts/setup-mac.sh
# Installs uv (Python manager) if missing, then Python 3.12 + every library, the website dependencies,
# creates .env and checks the key libraries. Safe to run again. Log: data/cache/setup-log.txt
# 没有 uv 会自动安装；然后装 Python 3.12 和全部库、网站依赖，生成 .env，并检查关键库。可重复运行。
set -e
cd "$(dirname "$0")/.."
mkdir -p data/cache
LOG="data/cache/setup-log.txt"
exec > >(tee -a "$LOG") 2>&1

say()  { printf "\n== %s\n   %s\n" "$1" "$2"; }
ok()   { printf "   [OK] %s\n" "$1"; }
fail() { printf "   [!!] %s\n        %s\n   日志 / log: %s\n" "$1" "$2" "$LOG"; exit 1; }

echo "TransitLab HK 环境安装 / environment setup — $(pwd)"

say "第 1 步：检查 Git、uv、Node.js" "Step 1: check Git, uv, Node.js"
command -v git >/dev/null 2>&1 || fail "没有 Git：运行 xcode-select --install 装好后再运行本脚本" \
                                       "Git missing: run 'xcode-select --install', then run this script again"
ok "Git"
if ! command -v uv >/dev/null 2>&1; then
  echo "   正在安装 / installing uv ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
command -v uv >/dev/null 2>&1 || fail "uv 装完后仍找不到：关掉终端重开，再运行一次" "uv still not found: reopen Terminal and run again"
ok "uv"
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    fail "没有 Node.js：到 https://nodejs.org 下载 LTS 安装包装好后再运行" \
         "Node.js missing: install the LTS package from https://nodejs.org, then run again"
  fi
fi
ok "Node.js $(node --version)"

say "第 2 步：安装 Python 3.12 和全部库（第一次约 3-10 分钟）" "Step 2: Python 3.12 and every library (first time about 3-10 minutes)"
[ -f .env ] || { cp .env.example .env; ok "已生成 .env / created .env"; }
uv sync || fail "Python 库安装失败" "uv sync failed"
ok "Python 环境就绪 / Python environment ready"

say "第 3 步：安装网站依赖（约 1-3 分钟）" "Step 3: website dependencies (about 1-3 minutes)"
(cd frontend && npm install --no-fund --no-audit) || fail "网站依赖安装失败" "npm install failed"
ok "网站依赖就绪 / website dependencies ready"

say "第 4 步：检查关键库" "Step 4: check the key libraries"
uv run python -c "import pandas, geopandas, pyogrio, rasterio, scipy, aequilibrae, fastapi, PIL
from pyproj import Transformer
x, y = Transformer.from_crs(2326, 4326, always_xy=True).transform(836000, 819000)
assert 114.1 < x < 114.3 and 22.2 < y < 22.4, (x, y)
print('all libraries OK')" || fail "关键库检查没通过" "library check failed"

echo
echo "================ 装好了 / All set ================"
echo "  打开网站 / open the website:     bash scripts/start-dev.sh"
echo "  玩小游戏 / play the mini-games:  双击 double-click game-demo/metro.html 或 or game-demo/index.html"
echo "  上手指南 / getting started:      docs/onboarding.md （English: docs/onboarding.en.md）"
echo "  日志 / log: $LOG"
