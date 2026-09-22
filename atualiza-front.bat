@echo off
setlocal
title Front Manufatura - Preparar atualizacao

cd /d "%~dp0"

echo ==========================================
echo Front Manufatura - Preparar atualizacao
echo ==========================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy-front.ps1" -PrepareOnly
set "DEPLOY_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%DEPLOY_EXIT_CODE%"=="0" (
    echo PREPARACAO FALHOU. O servico atual nao foi alterado.
    pause
    exit /b %DEPLOY_EXIT_CODE%
)

echo Build candidato preparado. O servico atual nao foi alterado.
echo Execute instalar-servico.bat como Administrador para publicar e reiniciar.
pause
exit /b 0
