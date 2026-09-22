@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy-front.ps1" -InstallServiceOnly
set "SERVICE_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %SERVICE_EXIT_CODE%
