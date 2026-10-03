# TransitLab HK - play the metro demo (used by the desktop shortcut and start-game.cmd).
# Starts the backend (port 8000) only if it is not running yet, waits until it answers, then opens /game.
# Safe to run again at any time; works side by side with start-dev.ps1 (same backend).
# A backend started before the game existed (without --reload) answers 404 on /game: it is restarted.
param([string]$Page = '')   # e.g. 'alien/' opens /game/alien/
$root = Split-Path -Parent $PSScriptRoot
$gameUrl = 'http://127.0.0.1:8000/game/'

function Test-Listening([int]$port) {
    [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Get-GameStatus {
    try { return (Invoke-WebRequest -Uri ($gameUrl + 'api/boot') -UseBasicParsing -TimeoutSec 5).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

if ((Test-Listening 8000) -and ((Get-GameStatus) -eq 404)) {
    foreach ($id in (Get-NetTCPConnection -State Listen -LocalPort 8000).OwningProcess | Select-Object -Unique) {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").CommandLine
        if ($cmd -match 'uvicorn backend\.main:app') { Stop-Process -Id $id -Confirm:$false }
    }
    Start-Sleep -Seconds 1
}

if (-not (Test-Listening 8000)) {
    Start-Process powershell -WorkingDirectory $root -WindowStyle Minimized -ArgumentList '-NoExit', '-Command',
        "`$host.UI.RawUI.WindowTitle = 'TransitLab 计算引擎 - 玩的时候不要关'; uv run uvicorn backend.main:app --reload --port 8000"
}

# The first start after a reboot can take a while.
$deadline = (Get-Date).AddSeconds(90)
$ok = $false
while ((Get-Date) -lt $deadline) {
    if ((Get-GameStatus) -eq 200) { $ok = $true; break }
    Start-Sleep -Milliseconds 700
}

if ($ok) {
    Start-Process ($gameUrl + $Page)
} else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "游戏网页没有打开。`n`n请关掉任务栏里所有「TransitLab」的黑色窗口，再双击桌面的「TransitLab 修地铁」。",
        'TransitLab 修地铁') | Out-Null
}
