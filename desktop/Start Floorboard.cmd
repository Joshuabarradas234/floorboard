@echo off
rem Opens Floorboard as a glass sidebar on the edge of your screen.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing the desktop shell. This takes a minute...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .
