@echo off
setlocal
title SOILS v1.10.31 - Stable Localhost Runtime Patch

echo ============================================================
echo   SOILS v1.10.31 - STABLE LOCALHOST RUNTIME PATCH
echo ============================================================
echo.
echo Uses npm.cmd only.
echo Run this from:
echo D:\Soils-Classification-Ready-v1.10.31-OVERHAUL
echo.

if not exist package.json (
  echo ERROR: package.json is not in this folder.
  pause
  exit /b 1
)

echo [1/6] Stopping old Node / Vite / esbuild processes...
taskkill /F /T /IM node.exe >nul 2>&1
taskkill /F /T /IM esbuild.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/6] Removing old Vite 8 dependency installation...
if exist node_modules rmdir /s /q node_modules
if exist node_modules (
  echo.
  echo ERROR: Windows is still locking node_modules.
  echo Restart Windows, then run this BAT BEFORE opening VS Code.
  pause
  exit /b 1
)

if exist package-lock.json del /f /q package-lock.json

echo [3/6] Clearing npm cache metadata...
call npm.cmd cache verify
if errorlevel 1 (
  echo ERROR: npm.cmd cache verify failed.
  pause
  exit /b 1
)

echo [4/6] Installing the stable Vite 7 dependency set...
call npm.cmd install
if errorlevel 1 (
  echo.
  echo ERROR: npm.cmd install failed.
  echo If the message says EBUSY for esbuild.exe, restart Windows and run
  echo this BAT before opening VS Code or localhost.
  pause
  exit /b 1
)

echo [5/6] Verifying runtime...
call npm.cmd exec vite -- --version
call npm.cmd ls react react-dom react-router react-router-dom
if errorlevel 1 (
  echo ERROR: dependency verification failed.
  pause
  exit /b 1
)

echo [6/6] Starting SOILS...
echo.
echo IMPORTANT:
echo Open http://127.0.0.1:5173/
echo instead of the old localhost tab for the first test.
echo.
call npm.cmd run dev
