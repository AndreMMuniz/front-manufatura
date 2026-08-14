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
REM MODO TEMPORARIO DE TESTE VIA HTTP/IP:
REM Este build habilita fallbacks somente para o ambiente interno sem HTTPS.
REM Quando o servidor receber HTTPS, troque a linha abaixo por: call npm run build
call npm run build:http-test

if errorlevel 1 (
    echo.
    echo ERRO no build.
    pause
    exit /b 1
)

echo.
echo [4/4] Iniciando servidor com .env...
REM LOGS DO SERVIDOR:
REM Por padrao, os eventos de API e do Datasul ficam em C:\node\front-manufatura\logs.
REM Se APP_LOG_DIR estiver definido no .env, consulte esse valor para localizar os arquivos.
REM Nao exiba o conteudo do .env no terminal, pois ele possui credenciais e segredos.
REM Para voltar ao comportamento sem arquivos no futuro, remova as variaveis APP_LOG_ do .env
REM somente depois de remover/reverter a instrumentacao de logging no codigo.
echo Logs do servidor: pasta logs ^(ou APP_LOG_DIR configurado no .env^)
node --env-file=.env dist/plano-de-controle/server/server.mjs

if errorlevel 1 (
    echo.
    echo ERRO ao iniciar o servidor.
    pause
    exit /b 1
)

pause
