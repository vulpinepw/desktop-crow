param(
  [string]$Distro = "",
  [switch]$Deb
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$stage = Join-Path $env:TEMP "desktop-crow-src"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
$skip = @("node_modules", "dist", "app-dist", "qa", ".git") | ForEach-Object { Join-Path $root $_ }
robocopy $root $stage /E /XD @skip /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the sources to $stage failed (robocopy $LASTEXITCODE)" }

$drive = $stage.Substring(0, 1).ToLower()
$wslPath = "/mnt/$drive" + ($stage.Substring(2) -replace '\\', '/')
$wslArgs = @()
if ($Distro) { $wslArgs += @("-d", $Distro) }
$wslArgs += @("--cd", "~", "--", "bash", "$wslPath/scripts/wsl-build.sh", $wslPath)
if ($Deb) { $wslArgs += "--deb" }
Write-Host "Building in WSL from $wslPath"
& wsl.exe @wslArgs
if ($LASTEXITCODE -ne 0) { throw "WSL build failed ($LASTEXITCODE)" }

$out = Join-Path $root "dist"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem (Join-Path $stage "dist") -File | Where-Object { $_.Extension -in ".AppImage", ".deb" } | ForEach-Object {
  Copy-Item $_.FullName $out -Force
  Write-Host ("{0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB))
}
Remove-Item -Recurse -Force $stage
