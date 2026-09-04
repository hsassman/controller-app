# Builds a portable, dependency-free distribution of the app: a folder
# containing only controller-host.exe and a `web` folder of static files.
# Anyone can copy that folder to any Windows PC and double-click the exe --
# no Node.js, no Rust, no npm install, no cargo build. Only requirement on
# the target machine is the ViGEmBus driver (see README.md).
#
# This is what "run node/cargo build once, then hand the app to someone
# else" should have meant from the start: they were never supposed to need
# a dev toolchain just to play. Run this after making changes, then copy
# (or zip) the output folder to the other device.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\Package-Release.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "==> Building the phone app (client)..." -ForegroundColor Cyan
Push-Location "$root\client"
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Pop-Location

Write-Host "==> Building the host (release, this can take a minute or two)..." -ForegroundColor Cyan
Push-Location "$root\host\src-tauri"
cargo build --release
if ($LASTEXITCODE -ne 0) { throw "cargo build --release failed" }
Pop-Location

$outDir = "$root\PhoneController-Portable"
Write-Host "==> Assembling $outDir ..." -ForegroundColor Cyan
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path "$outDir\web" | Out-Null

Copy-Item "$root\host\src-tauri\target\release\controller-host.exe" "$outDir\controller-host.exe"
Copy-Item "$root\client\dist\*" "$outDir\web" -Recurse

$readme = @"
Phone Controller — portable build
==================================

1. Install the ViGEmBus driver (one-time, only needed once per PC):
   https://github.com/ViGEm/ViGEmBus/releases

2. Double-click controller-host.exe.
   Windows may show a "Windows protected your PC" SmartScreen prompt the
   first time, because this exe isn't code-signed. Click "More info", then
   "Run anyway" -- that's expected for an app built and shared this way,
   not a sign anything is wrong.

3. A window opens showing an address like http://192.168.1.42:8789.
   Open that address in your phone's browser -- it connects itself.

That's the whole setup. No Node.js, no Rust, nothing else to install.
"@
Set-Content -Path "$outDir\README.txt" -Value $readme

$zipPath = "$root\PhoneController-Portable.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$outDir\*" -DestinationPath $zipPath

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Folder: $outDir"
Write-Host "  Zip:    $zipPath"
Write-Host ""
Write-Host "Copy either one to another Windows PC. All that PC needs is" -ForegroundColor Yellow
Write-Host "ViGEmBus installed -- no Node.js, no Rust, no build step." -ForegroundColor Yellow
