@echo off
setlocal
title Controller Host

REM One double-click to play. Builds whatever is missing, then launches the
REM host -- which serves the phone page itself, so this is the only thing
REM that needs to run.
REM
REM The name is hyphenated on purpose. Called "Start Controller.bat", the
REM command `cmd /c "Start Controller.bat"` is parsed as cmd's own START
REM builtin with "Controller.bat" as its argument, so the script silently
REM never runs. One token, no collision.

cd /d "%~dp0"

set "HOST_EXE=host\src-tauri\target\debug\controller-host.exe"

if not exist "client\dist\index.html" (
  echo Building the phone app ^(first run only^)...
  if not exist "client\node_modules" (
    pushd client && call npm install || goto :fail
    popd
  )
  pushd client && call npm run build || goto :fail
  popd
)

if not exist "%HOST_EXE%" (
  echo Building the host ^(first run only, this takes a few minutes^)...
  pushd host\src-tauri && call cargo build || goto :fail
  popd
)

echo.
echo Starting Controller Host...
echo The window that opens shows the address to type on your phone.
echo.
"%HOST_EXE%"
goto :eof

:fail
echo.
echo Build failed. Make sure Node.js and Rust are installed, then try again.
echo   Node.js: https://nodejs.org
echo   Rust:    https://rustup.rs
echo.
pause
exit /b 1
