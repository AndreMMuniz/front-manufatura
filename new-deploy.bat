@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Plano de Controle - Novo deploy

set "REPOSITORY_URL=https://github.com/AndreMMuniz/plano-de-controle.git"
set "ENV_CREATED=0"
for %%I in ("%~dp0.") do set "INSTALL_DIR=%%~fI"

echo ============================================================
echo  Plano de Controle - Instalacao em um novo servidor
echo ============================================================
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERRO] PowerShell 5.1 ou posterior nao foi encontrado no PATH.
  echo        Instale o requisito, feche este Prompt e tente novamente.
  goto :failure
)
for /f "usebackq delims=" %%V in (`powershell.exe -NoLogo -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"`) do set "POWERSHELL_VERSION=%%V"
echo [OK] PowerShell: %POWERSHELL_VERSION%
powershell.exe -NoLogo -NoProfile -Command "if ($PSVersionTable.PSVersion -lt [version]'5.1') { exit 1 }"
if errorlevel 1 (
  echo [ERRO] PowerShell 5.1 ou posterior e obrigatorio.
  goto :failure
)

where git.exe >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Git for Windows nao foi encontrado no PATH.
  echo        Instale o requisito, feche este Prompt e tente novamente.
  goto :failure
)
for /f "usebackq delims=" %%V in (`git.exe --version 2^>^&1`) do set "GIT_VERSION=%%V"
echo [OK] %GIT_VERSION%

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH.
  echo        Instale Node.js 24.x, feche este Prompt e tente novamente.
  goto :failure
)
for /f "usebackq delims=" %%V in (`node.exe --version 2^>^&1`) do set "NODE_VERSION=%%V"
echo [OK] Node.js: %NODE_VERSION%
powershell.exe -NoLogo -NoProfile -Command "$v=[version](& node.exe -p process.versions.node); $ok=($v.Major -eq 20 -and $v.Minor -ge 19) -or ($v.Major -eq 22 -and $v.Minor -ge 12) -or ($v.Major -ge 24); if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERRO] Versao do Node.js incompativel.
  echo        Instale Node.js 24.x ou use 20.19+/22.12+.
  goto :failure
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao foi encontrado no PATH.
  echo        Reinstale o Node.js, feche este Prompt e tente novamente.
  goto :failure
)
for /f "usebackq delims=" %%V in (`npm.cmd --version 2^>^&1`) do set "NPM_VERSION=%%V"
echo [OK] npm: %NPM_VERSION%
echo.

echo.
echo Repositorio: %REPOSITORY_URL%
echo Diretorio:   %INSTALL_DIR%
echo.

if exist "%INSTALL_DIR%\.git\" goto :existing_repository

for /f "delims=" %%F in ('dir /b /a "%INSTALL_DIR%" 2^>nul') do if /i not "%%F"=="%~nx0" goto :directory_not_empty

set "CLONE_DIR=%TEMP%\plano-de-controle-new-deploy-%RANDOM%-%RANDOM%"
echo [1/4] Clonando a branch main do repositorio publico...
git.exe clone --branch main --single-branch "%REPOSITORY_URL%" "%CLONE_DIR%"
if errorlevel 1 (
  rmdir /S /Q "%CLONE_DIR%" 2>nul
  echo [ERRO] Nao foi possivel clonar o repositorio.
  echo        Verifique a conexao com o GitHub.
  goto :failure
)

echo Movendo o repositorio para a pasta deste BAT...
robocopy "%CLONE_DIR%" "%INSTALL_DIR%" /E /MOVE /XF "%~nx0" /R:1 /W:1 /NFL /NDL /NP
if errorlevel 8 (
  echo [ERRO] Nao foi possivel mover o clone para %INSTALL_DIR%.
  goto :failure
)
rmdir /S /Q "%CLONE_DIR%" 2>nul
goto :prepare_environment

:existing_repository
for /f "usebackq delims=" %%R in (`git.exe -C "%INSTALL_DIR%" remote get-url origin 2^>nul`) do set "EXISTING_REMOTE=%%R"
if /i not "%EXISTING_REMOTE%"=="%REPOSITORY_URL%" (
  echo [ERRO] O destino ja contem outro repositorio Git.
  echo        Origin encontrado: %EXISTING_REMOTE%
  goto :failure
)
echo [1/4] Repositorio correto ja existe; ele sera atualizado pelo deploy.

:prepare_environment
if not exist "%INSTALL_DIR%\.env.example" (
  echo [ERRO] O clone nao contem o arquivo .env.example.
  goto :failure
)
if not exist "%INSTALL_DIR%\tools\deploy-front.ps1" (
  echo [ERRO] O clone nao contem tools\deploy-front.ps1.
  goto :failure
)

echo [2/4] Preparando o arquivo de configuracao...
if exist "%INSTALL_DIR%\.env" (
  echo [OK] O .env existente sera preservado.
) else (
  copy /Y "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel criar o .env a partir do exemplo.
    goto :failure
  )
  set "ENV_CREATED=1"
  echo [OK] .env criado a partir de .env.example.
)

echo [3/4] Instalando dependencias e gerando o build...
echo [4/4] Publicando, iniciando e validando a aplicacao...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%\tools\deploy-front.ps1"
if errorlevel 1 goto :failure

echo.
echo ============================================================
echo  NOVO DEPLOY CONCLUIDO
echo ============================================================
echo Projeto: %INSTALL_DIR%
echo Config:  %INSTALL_DIR%\.env
echo.
if "%ENV_CREATED%"=="1" (
  echo [ATENCAO] Foi criado um .env de exemplo.
  echo Copie para ele os valores do .env do servidor antigo.
  echo A URL do Datasul pode ficar vazia por enquanto, mas login e APIs
  echo nao funcionarao ate a configuracao ser preenchida.
  echo Depois de alterar o .env, execute:
  echo   %INSTALL_DIR%\atualiza-front.bat
) else (
  echo O .env existente foi mantido. Confira seus valores antes de liberar o acesso.
)
echo.
pause
exit /b 0

:directory_not_empty
echo [ERRO] A pasta deste BAT contem outros arquivos e ainda nao e um repositorio.
echo        Coloque new-deploy.bat sozinho em uma pasta vazia e execute novamente.
goto :failure

:failure
echo.
echo ============================================================
echo  DEPLOY INTERROMPIDO - VEJA O ERRO ACIMA
echo ============================================================
echo Corrija o problema e execute new-deploy.bat novamente.
echo O .env existente nunca e sobrescrito por este instalador.
echo.
pause
exit /b 1
