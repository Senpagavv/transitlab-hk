# TransitLab HK launcher (used by the desktop shortcut and start-dev.cmd).
# Starts the backend (port 8000) and frontend (port 5173) only if they are not running yet,
# waits until both are listening, then opens the site. Safe to run again at any time.
$root = Split-Path -Parent $PSScriptRoot
$siteUrl = 'http://localhost:5173'

function Test-Listening([int]$port) {
    [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

if (-not (Test-Listening 8000)) {
    Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-Command',
        "`$host.UI.RawUI.WindowTitle = 'TransitLab backend - keep open while using the site'; uv run uvicorn backend.main:app --reload --port 8000"
}

if (-not (Test-Listening 5173)) {
    Start-Process powershell -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList '-NoExit', '-Command',
        "`$host.UI.RawUI.WindowTitle = 'TransitLab frontend - keep open while using the site'; npm run dev"
}

# The first start after a reboot can take a while.
$deadline = (Get-Date).AddSeconds(90)
while (-not ((Test-Listening 8000) -and (Test-Listening 5173)) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
}

Start-Process $siteUrl
