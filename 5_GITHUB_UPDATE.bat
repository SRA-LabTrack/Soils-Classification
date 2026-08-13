@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ================================================
echo   SOILS v1.10.31 - GitHub / Vercel Update
echo ================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git is not installed or is not available in PATH.
  echo Install Git for Windows, then run this file again.
  pause
  exit /b 1
)

echo [PRECHECK] Building the production app before publishing...
npm.cmd run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED. GitHub was not changed. Fix the build error first.
  pause
  exit /b 1
)

rem Never publish local secrets or generated folders.
findstr /x /c:".env" .gitignore >nul 2>&1 || echo .env>>.gitignore
findstr /x /c:"node_modules/" .gitignore >nul 2>&1 || echo node_modules/>>.gitignore
findstr /x /c:"dist/" .gitignore >nul 2>&1 || echo dist/>>.gitignore

if not exist ".git\" (
  echo [1/6] Initializing Git repository...
  git init || goto :fail
  git branch -M main || goto :fail

  git remote add origin https://github.com/SRA-LabTrack/Soils-Classification.git 2>nul
  echo [2/6] Checking existing GitHub history...
  git fetch origin main >nul 2>&1
  git show-ref --verify --quiet refs/remotes/origin/main
  if not errorlevel 1 (
    git reset --mixed origin/main || goto :fail
  )
) else (
  echo [1/6] Existing Git repository detected.
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin https://github.com/SRA-LabTrack/Soils-Classification.git || goto :fail
)

git branch -M main || goto :fail

echo [3/6] Staging project changes...
git add -A || goto :fail
rem Extra guard: .env must never be included in a commit.
git reset -- .env >nul 2>&1

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No new project changes are waiting to be committed.
  echo Trying to push the current main branch anyway...
  git push -u origin main || goto :fail
  goto :success
)

echo [4/6] Checking Git author settings...
git config user.name >nul 2>&1
if errorlevel 1 (
  set /p GIT_NAME=Enter your GitHub name: 
  git config user.name "!GIT_NAME!" || goto :fail
)
git config user.email >nul 2>&1
if errorlevel 1 (
  set /p GIT_EMAIL=Enter your GitHub email: 
  git config user.email "!GIT_EMAIL!" || goto :fail
)

echo [5/6] Committing v1.10.31...
git commit -m "Update Soils Classification v1.10.31" || goto :fail

echo [6/6] Pushing to GitHub main...
git push -u origin main || goto :fail

goto :success

:success
echo.
echo ================================================
echo   GitHub updated successfully.
echo   If Vercel is connected to the main branch,
echo   a new deployment will start automatically.
echo ================================================
echo.
pause
exit /b 0

:fail
echo.
echo ================================================
echo   GitHub update FAILED.
echo   Read the error above. Nothing will be hidden.
echo ================================================
echo.
pause
exit /b 1
