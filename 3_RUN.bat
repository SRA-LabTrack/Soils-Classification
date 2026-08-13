@echo off
cd /d "%~dp0"
echo ================================================
echo   Starting SOILS v1.10.26
 echo   Integrated API + Vite on localhost:5173
echo   Clean generation: old Sensor / Plot / Drone inputs stay archived
 echo ================================================
npm.cmd run dev
pause
