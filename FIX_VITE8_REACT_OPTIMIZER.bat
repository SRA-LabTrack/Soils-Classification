@echo off
setlocal
title SOILS v1.10.31 - Vite 8 React Optimizer Fix

echo ============================================================
echo   SOILS v1.10.31 - VITE 8 REACT OPTIMIZER FIX
echo ============================================================
echo.
echo This patch uses npm.cmd only.
echo.

if not exist package.json (
  echo ERROR: package.json is not in this folder.
  echo Put this BAT and vite.config.js in:
  echo D:\Soils-Classification-Ready-v1.10.31-OVERHAUL
  pause
  exit /b 1
)

echo [1/4] Stopping Vite/Node...
taskkill /F /T /IM node.exe >nul 2>&1

echo [2/4] Clearing ONLY Vite optimized dependency caches...
if exist node_modules\.vite rmdir /s /q node_modules\.vite
if exist node_modules\.vite-temp rmdir /s /q node_modules\.vite-temp

echo [3/4] Verifying dependency tree...
call npm.cmd ls react react-dom react-router react-router-dom
if errorlevel 1 (
  echo.
  echo ERROR: npm.cmd dependency verification failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Starting SOILS with stable prebundling...
echo.
call npm.cmd run dev
