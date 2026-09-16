@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Plano de Controle - Novo deploy

set "REPOSITORY_URL=https://github.com/AndreMMuniz/plano-de-controle.git"
set "DEFAULT_INSTALL_DIR=C:\apps\plano-de-controle"
set "ENV_CREATED=0"

echo ============================================================
echo  Plano de Controle - Instalacao em um novo servidor
echo ============================================================
echo.

call :require_command powershell.exe "PowerShell 5.1 ou posterior"
if errorlevel 1 goto :failure
for /f "usebackq delims=" %%V in (`powershell.exe -NoLogo -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"`) do set "POWERSHELL_VERSION=%%V"
echo [OK] PowerShell: %POWERSHELL_VERSION%
powershell.exe -NoLogo -NoProfile -Command "if ($PSVersionTable.PSVersion -lt [version]'5.1') { exit 1 }"
if errorlevel 1 (
  echo [ERRO] PowerShell 5.1 ou posterior e obrigatorio.
  goto :failure
)

call :require_command git.exe "Git for Windows"
if errorlevel 1 goto :failure
for /f "usebackq delims=" %%V in (`git.exe --version 2^>^&1`) do set "GIT_VERSION=%%V"
echo [OK] %GIT_VERSION%

call :require_command node.exe "Node.js 20.19+, 22.12+ ou 24+"
if errorlevel 1 goto :failure
for /f "usebackq delims=" %%V in (`node.exe --version 2^>^&1`) do set "NODE_VERSION=%%V"
echo [OK] Node.js: %NODE_VERSION%
powershell.exe -NoLogo -NoProfile -Command "$v=[version](& node.exe -p process.versions.node); $ok=($v.Major -eq 20 -and $v.Minor -ge 19) -or ($v.Major -eq 22 -and $v.Minor -ge 12) -or ($v.Major -ge 24); if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERRO] Versao do Node.js incompativel.
  echo        Instale Node.js 24.x ou use 20.19+/22.12+.
  goto :failure
)

call :require_command npm.cmd "npm"
if errorlevel 1 goto :failure
for /f "usebackq delims=" %%V in (`npm.cmd --version 2^>^&1`) do set "NPM_VERSION=%%V"
echo [OK] npm: %NPM_VERSION%
echo.

set "INSTALL_DIR=%DEFAULT_INSTALL_DIR%"
set /p "INSTALL_DIR=Diretorio de instalacao [%DEFAULT_INSTALL_DIR%]: "
if not defined INSTALL_DIR set "INSTALL_DIR=%DEFAULT_INSTALL_DIR%"

echo.
echo Repositorio: %REPOSITORY_URL%
echo Destino:     %INSTALL_DIR%
echo.

if exist "%INSTALL_DIR%\.git\" goto :existing_repository

echo [1/4] Clonando a branch main do repositorio publico...
git.exe clone --branch main --single-branch "%REPOSITORY_URL%" "%INSTALL_DIR%"
if errorlevel 1 (
  echo [ERRO] Nao foi possivel clonar o repositorio.
  echo        Verifique internet, acesso ao GitHub e se o destino esta vazio.
  goto :failure
)
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

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
  echo [ERRO] %~2 nao foi encontrado no PATH.
  echo        Instale o requisito, feche este Prompt e tente novamente.
  exit /b 1
)
exit /b 0

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
