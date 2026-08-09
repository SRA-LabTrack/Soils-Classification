@echo off
cd /d "%~dp0"
echo Creating Appwrite database and tables...
npm.cmd run setup:appwrite
pause
