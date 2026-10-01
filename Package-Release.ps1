# Builds the two things you hand to someone who just wants to play:
#
#   release\PhoneController.exe
#       Portable. One file, nothing to unzip: the phone page is compiled into
#       it. Double-click and go -- its window offers to install the gamepad
#       driver and fix the firewall with one click each.
#
#   release\Phone Controller_<version>_x64-setup.exe
#       Installer. Adds Start menu / desktop shortcuts, opens the firewall to
#       the local network and installs the ViGEmBus driver, all behind one
#       Windows permission prompt.
#
# Neither needs Node.js or Rust on the PC you play on -- only on the PC that
# runs this script. (Don't have them? Push to GitHub: the "Windows build"
# workflow in .github/workflows builds both for you.)
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\Package-Release.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

$vigemUrl = "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe"

Write-Host "==> Building the phone app (client)..." -ForegroundColor Cyan
Push-Location "$root\client"
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Pop-Location

$drivers = "$root\host\src-tauri\drivers"
$vigem = "$drivers\ViGEmBus_Setup.exe"
if (-not (Test-Path $vigem)) {
    Write-Host "==> Downloading the ViGEmBus driver installer (bundled into the installer)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $drivers | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $vigemUrl -OutFile $vigem
}

Write-Host "==> Building the host and installer (release, this can take a few minutes)..." -ForegroundColor Cyan
Push-Location "$root\host\src-tauri"
npx --yes @tauri-apps/cli@2 build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
Pop-Location

$outDir = "$root\release"
Write-Host "==> Collecting into $outDir ..." -ForegroundColor Cyan
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir | Out-Null
Copy-Item "$root\host\src-tauri\target\release\controller-host.exe" "$outDir\PhoneController.exe"
Copy-Item "$root\host\src-tauri\target\release\bundle\nsis\*.exe" $outDir

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Get-ChildItem $outDir | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host ""
Write-Host "Give someone either file. The installer does every setup step at once;" -ForegroundColor Yellow
Write-Host "the portable exe walks them through the driver from its own window." -ForegroundColor Yellow
