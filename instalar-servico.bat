@echo off
setlocal
title Front Manufatura - Instalar ou atualizar fma service
cd /d "%~dp0"

echo ==========================================
echo Front Manufatura - fma service
echo ==========================================
echo Este passo publica o candidato, para o Node anterior e inicia o servico.
echo Execute este BAT como Administrador.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy-front.ps1" -InstallServiceOnly
set "SERVICE_EXIT_CODE=%ERRORLEVEL%"
if not "%SERVICE_EXIT_CODE%"=="0" echo INSTALACAO/ATUALIZACAO DO SERVICO FALHOU. Veja o erro acima.
pause
exit /b %SERVICE_EXIT_CODE%
