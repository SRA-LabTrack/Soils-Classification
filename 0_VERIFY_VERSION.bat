@echo off
cd /d "%~dp0"
echo.
echo ================================================
echo   SOILS Update Verification
echo ================================================
findstr /c:"\"version\": \"1.10.12\"" package.json >nul 2>&1
if errorlevel 1 (
  echo ERROR: This folder is NOT SOILS v1.10.12.
  echo You may be running or extracting into the wrong project folder.
  echo Current folder: %CD%
  echo.
  type package.json | findstr /c:"\"version\""
  pause
  exit /b 1
)
echo OK: SOILS v1.10.12 is installed in:
echo %CD%
echo.
echo Start it with:
echo npm.cmd run dev
pause
