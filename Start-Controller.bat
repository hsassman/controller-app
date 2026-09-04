@echo off
setlocal enabledelayedexpansion
title Controller Host

REM One double-click to play. Builds whatever is missing, then launches the
REM host -- which serves the phone page itself, so this is the only thing
REM that needs to run.
REM
REM The name is hyphenated on purpose. Called "Start Controller.bat", the
REM command `cmd /c "Start Controller.bat"` is parsed as cmd's own START
REM builtin with "Controller.bat" as its argument, so the script silently
REM never runs. One token, no collision.
REM
REM This script is for BUILDING FROM SOURCE (developers). If you just want
REM to play and don't have Node.js/Rust installed, use the portable release
REM instead -- see README.md's "Just want to play?" section. That path
REM needs nothing but the ViGEmBus driver.

cd /d "%~dp0"

REM ---- Refresh PATH from the registry before checking anything ----
REM
REM This is the #1 cause of "I installed it and it still says missing":
REM a freshly-run installer updates the PATH environment variable in the
REM registry, but every process that was already running -- including
REM File Explorer, and therefore every cmd.exe it spawns when you
REM double-click a .bat -- keeps the PATH it started with. Windows does
REM not push environment changes into running processes; only a new
REM logon (or a reboot) normally picks them up. Re-reading it here means
REM a script launched from a stale Explorer session still sees tools
REM installed five minutes ago, with no reboot required.
REM
REM Read through PowerShell's Environment API, not `reg query` directly:
REM the registry stores PATH as REG_EXPAND_SZ with unexpanded references
REM like %SystemRoot%, and reg.exe returns them as literal text. Copying
REM that raw string into PATH replaces the real System32 folder with the
REM literal, nonexistent path "%SystemRoot%\system32" -- which breaks
REM WHERE.EXE ITSELF, so every lookup after that fails regardless of what
REM is actually installed. .NET's GetEnvironmentVariable expands these
REM for us, which is the whole reason to go through it instead.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"

set "HOST_EXE=host\src-tauri\target\debug\controller-host.exe"

REM ---- Verify the tools are actually reachable before using them ----
REM Doing this up front, with a specific message per tool, replaces a
REM generic "build failed, maybe reinstall?" with the real reason.
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on PATH.
  echo.
  echo If you just installed it: close this window, open a NEW Command
  echo Prompt or double-click this file again ^(installers update PATH,
  echo but only new processes see the update^). If it still fails,
  echo restart your PC once -- that always picks it up.
  echo.
  echo Otherwise, install it from: https://nodejs.org ^(LTS is fine^)
  echo.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo Rust's cargo was not found on PATH.
  echo.
  echo If you just installed it: close this window, open a NEW Command
  echo Prompt or double-click this file again. If it still fails,
  echo restart your PC once -- that always picks it up.
  echo.
  echo Otherwise, install it from: https://rustup.rs
  echo.
  pause
  exit /b 1
)

REM ---- Always rebuild, don't just check whether the output exists ----
REM Checking only "does dist/exe exist at all" meant a developer who fixed
REM a bug and re-ran this script would silently launch the stale binary
REM from before the fix, with no rebuild and no warning -- both npm and
REM cargo are already incremental, so re-running costs a couple of
REM seconds when nothing changed and is never wrong.
echo Building the phone app...
if not exist "client\node_modules" (
  pushd client && call npm install
  if errorlevel 1 (
    popd
    echo.
    echo npm install failed. Scroll up for the actual error above --
    echo common causes are no internet connection or a corporate proxy
    echo blocking the npm registry.
    echo.
    pause
    exit /b 1
  )
  popd
)
pushd client && call npm run build
if errorlevel 1 (
  popd
  echo.
  echo The phone app failed to build. Scroll up for the error.
  echo.
  pause
  exit /b 1
)
popd

echo Building the host...
pushd host\src-tauri && call cargo build
if errorlevel 1 (
  popd
  echo.
  echo The host failed to build. Scroll up for the error. On Windows,
  echo Rust needs the "Desktop development with C++" workload from the
  echo Visual Studio Build Tools to link -- rustup normally prompts to
  echo install this the first time you build; if you skipped it, get
  echo it from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
  echo.
  pause
  exit /b 1
)
popd

echo.
echo Starting Controller Host...
echo The window that opens shows the address to type on your phone.
echo.
"%HOST_EXE%"
