@echo off
setlocal
cd /d "%~dp0"
cls
echo ======================================================
echo   SOILS v1.10.26 - RESET ALL PIN INPUTS
echo ======================================================
echo.
echo This will permanently delete from Appwrite:
echo   - All Sensors and Sensor Readings
echo   - All Soil Plots and Soil Analyses
echo   - All Drone Mappings
echo   - Spatial change journal rows
echo.
echo It will KEEP Farmer accounts, Farms, Farm Boundaries,
echo Profiles, and Support Chat messages.
echo.
set /p CONFIRM=Type RESET to continue: 
if /I not "%CONFIRM%"=="RESET" (
  echo.
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 0
)
echo.
echo Clearing spatial inputs...
call npm.cmd run reset:pins
if errorlevel 1 goto :fail
echo.
echo Done. All pin inputs are now cleared.
echo Start SOILS with 3_RUN.bat or npm.cmd run dev.
pause
exit /b 0
:fail
echo.
echo RESET FAILED. Read the error above. No additional cleanup will run.
pause
exit /b 1
