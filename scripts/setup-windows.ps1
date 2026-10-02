# TransitLab HK - one-click setup for Windows. Double-click scripts\setup-windows.cmd (it runs this file).
# 一键配置 Windows 环境：双击 scripts\setup-windows.cmd 即可（它会运行本文件）。
#
# What it does / 做什么：
#   1. Installs Git, uv (Python manager) and Node.js LTS with winget if they are missing
#      没有 Git、uv（Python 管理工具）、Node.js 的，用 winget 自动安装
#   2. If your Windows user folder has non-English characters, points uv and GDAL at an English-only folder
#      Windows 用户名含中文等字符时，把 uv 和 GDAL 用的目录改到纯英文路径（否则部分地理库会出错）
#   3. uv sync (Python 3.12 + every library), npm install (website), creates .env
#      安装 Python 3.12 和全部库、网站依赖，生成 .env
#   4. Checks that the key libraries work, then tells you what to do next
#      检查关键库能用，告诉你下一步
# Safe to run again at any time. Everything it prints is also saved to data\cache\setup-log.txt.
# 可以重复运行。输出同时存在 data\cache\setup-log.txt，出问题把这个文件发给项目负责人。

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force (Join-Path $root 'data\cache') | Out-Null
$log = Join-Path $root 'data\cache\setup-log.txt'
Start-Transcript -Path $log -Append | Out-Null

function Say($zh, $en) { Write-Host ''; Write-Host "== $zh" -ForegroundColor Cyan; Write-Host "   $en" -ForegroundColor DarkCyan }
function Ok($msg) { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Fail($zh, $en) {
    Write-Host "   [!!] $zh" -ForegroundColor Red
    Write-Host "        $en" -ForegroundColor Red
    Write-Host "   日志 / log: $log"
    Stop-Transcript | Out-Null
    exit 1
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host 'TransitLab HK 环境安装 / environment setup' -ForegroundColor White
Write-Host "项目文件夹 / project folder: $root"

# The project folder itself must be English-only: geospatial libraries and Java cannot read other paths.
if ($root -notmatch '^[\x20-\x7E]*$') {
    Fail '项目放在了含中文或特殊字符的文件夹里。请把整个 transitlab-hk 文件夹移到纯英文路径（例如 D:\projects\transitlab-hk），再重新双击 setup-windows.cmd' `
         'The project folder path has non-English characters. Move the whole transitlab-hk folder to an English-only path (e.g. D:\projects\transitlab-hk) and double-click setup-windows.cmd again'
}
$asciiProfile = $env:USERPROFILE -match '^[\x20-\x7E]*$'
$toolRoot = (Split-Path -Qualifier $root) + '\transitlab-tools'
if (-not $asciiProfile) {
    # MSI installers (e.g. Node.js) also fail on non-English temp folders.
    New-Item -ItemType Directory -Force "$toolRoot\tmp" | Out-Null
    $env:TEMP = "$toolRoot\tmp"; $env:TMP = "$toolRoot\tmp"
}

Say '第 1 步：检查 / 安装 Git、uv、Node.js' 'Step 1: check / install Git, uv, Node.js'
$tools = @(
    @{ cmd = 'git';  id = 'Git.Git';           name = 'Git' },
    @{ cmd = 'uv';   id = 'astral-sh.uv';      name = 'uv' },
    @{ cmd = 'node'; id = 'OpenJS.NodeJS.LTS'; name = 'Node.js LTS' }
)
foreach ($t in $tools) {
    if (Has $t.cmd) { Ok "$($t.name) 已安装 / already installed"; continue }
    if (-not (Has 'winget')) {
        Fail "找不到 winget。请在 Microsoft Store 安装「应用安装程序」(App Installer)，或手动安装 $($t.name) 后再运行" `
             "winget not found. Install 'App Installer' from the Microsoft Store, or install $($t.name) yourself, then run again"
    }
    Write-Host "   正在安装 / installing $($t.name) ..."
    winget install --id $t.id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
    if (-not (Has $t.cmd)) {
        Fail "$($t.name) 装完后仍找不到。请关掉这个窗口，重新双击 setup-windows.cmd" `
             "$($t.name) still not found after installing. Close this window and double-click setup-windows.cmd again"
    }
    Ok "$($t.name) 安装完成 / installed"
}

Say '第 2 步：英文路径设置' 'Step 2: English-only paths'
if ($asciiProfile) {
    Ok '用户文件夹是英文路径，不用处理 / your user folder is English-only, nothing to do'
} else {
    $pairs = @(@('UV_CACHE_DIR', "$toolRoot\uv-cache"), @('UV_PYTHON_INSTALL_DIR', "$toolRoot\uv-python"), @('CPL_TMPDIR', "$toolRoot\gdal-tmp"))
    foreach ($pair in $pairs) {
        $name, $value = $pair
        $current = [Environment]::GetEnvironmentVariable($name, 'User')
        if ($current) { Set-Item "env:$name" $current; Ok "$name 已设置 / already set: $current"; continue }
        New-Item -ItemType Directory -Force $value | Out-Null
        [Environment]::SetEnvironmentVariable($name, $value, 'User')
        Set-Item "env:$name" $value
        Ok "$name = $value"
    }
}

Say '第 3 步：安装 Python 3.12 和全部库（第一次约 3-10 分钟）' 'Step 3: Python 3.12 and every library (first time about 3-10 minutes)'
if (-not (Test-Path (Join-Path $root '.env'))) {
    Copy-Item (Join-Path $root '.env.example') (Join-Path $root '.env')
    Ok '已生成 .env（以后需要 AI 密钥时再填）/ created .env (fill in AI keys later if needed)'
}
uv sync | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'Python 库安装失败' 'uv sync failed' }
Ok 'Python 环境就绪 / Python environment ready'

Say '第 4 步：安装网站依赖（约 1-3 分钟）' 'Step 4: website dependencies (about 1-3 minutes)'
Push-Location (Join-Path $root 'frontend')
npm install --no-fund --no-audit | Out-Host
$npmCode = $LASTEXITCODE
Pop-Location
if ($npmCode -ne 0) { Fail '网站依赖安装失败' 'npm install failed' }
Ok '网站依赖就绪 / website dependencies ready'

Say '第 5 步：检查关键库' 'Step 5: check the key libraries'
$check = "import pandas, geopandas, pyogrio, rasterio, scipy, aequilibrae, fastapi, PIL; " +
         "from pyproj import Transformer; x, y = Transformer.from_crs(2326, 4326, always_xy=True).transform(836000, 819000); " +
         "assert 114.1 < x < 114.3 and 22.2 < y < 22.4, (x, y); print('all libraries OK')"
uv run python -c $check | Out-Host
if ($LASTEXITCODE -ne 0) { Fail '关键库检查没通过' 'library check failed' }
Ok '全部通过 / all checks passed'

Write-Host ''
Write-Host '================ 装好了 / All set ================' -ForegroundColor Green
Write-Host '  打开网站 / open the website:       双击 double-click  scripts\start-dev.cmd'
Write-Host '  玩小游戏 / play the mini-games:    双击 double-click  game-demo\metro.html  或 or  game-demo\index.html'
Write-Host '  上手指南 / getting started:        docs\onboarding.md （English: docs\onboarding.en.md）'
Write-Host '  只有重算公交时间矩阵（第 18 步）才需要 Java，一般用不到 / Java is only needed for pipeline step 18'
Write-Host "  日志 / log: $log"
Stop-Transcript | Out-Null
