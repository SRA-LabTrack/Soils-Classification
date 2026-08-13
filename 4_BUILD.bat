@echo off
cd /d "%~dp0"
echo Building production version...
npm.cmd run build
pause
