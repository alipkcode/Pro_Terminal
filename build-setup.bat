@echo off
rem Builds the Pro Terminal Windows installer from this folder's source code.
rem The result is dist\Pro-Terminal-Setup-<version>.exe. It installs Pro Terminal fresh,
rem or upgrades an existing installation in place (settings, sessions and snippets are kept).
rem
rem Double-click it, or run "build-setup.bat /nopause" from a terminal or script.

setlocal EnableExtensions
title Pro Terminal - build setup
cd /d "%~dp0"

set "PAUSE_AT_END=1"
if /i "%~1"=="/nopause" set "PAUSE_AT_END="

echo.
echo   Pro Terminal - build the Windows installer
echo   ------------------------------------------
echo.

rem --- 1. Tools -----------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  set "FAIL=Node.js was not found. Install Node.js 22 or later from https://nodejs.org, then run this again."
  goto :failed
)
where npm >nul 2>nul
if errorlevel 1 (
  set "FAIL=npm was not found. It comes with Node.js: reinstall Node.js 22 or later from https://nodejs.org."
  goto :failed
)
for /f "usebackq delims=" %%N in (`node -p "process.versions.node.split('.')[0]"`) do set "NODE_MAJOR=%%N"
if %NODE_MAJOR% LSS 22 (
  set "FAIL=Node.js 22 or later is needed. This PC has Node.js %NODE_MAJOR%."
  goto :failed
)
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "VERSION=%%V"
if not defined VERSION (
  set "FAIL=Could not read the version from package.json."
  goto :failed
)
set "SETUP=dist\Pro-Terminal-Setup-%VERSION%.exe"
echo   Version   %VERSION%
echo   Output    %CD%\%SETUP%
echo.

rem --- 2. Dependencies (installed again only when package-lock.json changed) ---------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = 'node_modules\.package-lock.json'; if (-not (Test-Path $m) -or (Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item $m).LastWriteTime) { exit 1 }"
if errorlevel 1 (
  echo [1/4] Installing dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    set "FAIL=Installing the dependencies failed. If Pro Terminal is running from this folder, close it and try again."
    goto :failed
  )
) else (
  echo [1/4] Dependencies are up to date.
)
rem Electron downloads its binaries on first use, not on install; the installer build needs them.
if not exist "node_modules\electron\dist\electron.exe" (
  echo       Downloading Electron...
  node -e "require('electron')" >nul
)
if not exist "node_modules\electron\dist\electron.exe" (
  set "FAIL=Electron could not be downloaded. Check the internet connection and try again."
  goto :failed
)

rem --- 3. Type check ------------------------------------------------------------------------
echo.
echo [2/4] Checking the code...
call npm run typecheck --silent
if errorlevel 1 (
  set "FAIL=The type check found errors, so no installer was built. Fix the errors listed above first."
  goto :failed
)

rem --- 4. Clean the old build, so dist holds only the latest installer ---------------------
echo.
echo [3/4] Removing the previous build...
if exist dist rmdir /s /q dist
if exist dist (
  set "FAIL=Could not remove the old dist folder. Close Pro Terminal if it was started from dist\win-unpacked, and any window showing that folder, then try again."
  goto :failed
)

rem --- 5. Build -----------------------------------------------------------------------------
echo.
echo [4/4] Building the app and the installer. This takes a few minutes...
call npm run dist -- --publish never
if errorlevel 1 (
  set "FAIL=The build failed. The messages above say why."
  goto :failed
)
if not exist "%SETUP%" (
  set "FAIL=The build finished, but %SETUP% was not created."
  goto :failed
)

for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%SETUP%').Hash.ToLower()"`) do set "SHA=%%H"
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "[math]::Round((Get-Item -LiteralPath '%SETUP%').Length / 1MB)"`) do set "SIZE=%%S"

echo.
echo   ------------------------------------------
echo   Done: Pro Terminal %VERSION% installer
echo.
echo   File      %CD%\%SETUP%
echo   Size      %SIZE% MB
echo   SHA-256   %SHA%
echo.
echo   Run it to install Pro Terminal, or to upgrade the installed copy in place.
echo   Your settings, sessions, favorites and snippets are kept. If Pro Terminal is
echo   open, the installer asks to close it first.
echo.
if defined PAUSE_AT_END explorer /select,"%CD%\%SETUP%"
goto :end

:failed
echo.
echo   ------------------------------------------
echo   Build stopped: %FAIL%
echo.
if defined PAUSE_AT_END pause
endlocal
exit /b 1

:end
if defined PAUSE_AT_END pause
endlocal
exit /b 0
