$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js 20 or newer is required (https://nodejs.org)." }
Write-Host "==> Installing dependencies"
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
Write-Host "==> Running unit tests"
npm run test:quick
if ($LASTEXITCODE -ne 0) { throw "tests failed" }
Write-Host "==> Building installer"
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
Get-ChildItem dist -Filter "*.exe" | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
