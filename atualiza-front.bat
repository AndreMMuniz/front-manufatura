@echo off
title Front Manufatura - Atualizar e Iniciar

cd /d C:\node\front-manufatura

echo ==========================================
echo Front Manufatura
echo ==========================================
echo.

echo [1/4] Atualizando codigo do GitHub...
git pull origin main

if errorlevel 1 (
    echo.
    echo ERRO no git pull.
    pause
    exit /b 1
)

echo.
echo [2/4] Instalando dependencias...
call npm install

if errorlevel 1 (
    echo.
    echo ERRO no npm install.
    pause
    exit /b 1
)

echo.
echo [3/4] Gerando build...
call npm run build

if errorlevel 1 (
    echo.
    echo ERRO no build.
    pause
    exit /b 1
)

echo.
echo [4/4] Iniciando servidor com .env...
node --env-file=.env dist/plano-de-controle/server/server.mjs

if errorlevel 1 (
    echo.
    echo ERRO ao iniciar o servidor.
    pause
    exit /b 1
)

pause