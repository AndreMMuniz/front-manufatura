@echo off
setlocal
title Front Manufatura - Deploy

cd /d "%~dp0"

echo ==========================================
echo Front Manufatura - Deploy com rollback
echo ==========================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy-front.ps1"
set "DEPLOY_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%DEPLOY_EXIT_CODE%"=="0" (
    echo DEPLOY FALHOU. A versao anterior foi preservada ou restaurada quando possivel.
    pause
    exit /b %DEPLOY_EXIT_CODE%
)

echo Deploy concluido. O servico fma service permanece ativo e inicia com o Windows.
pause
exit /b 0
