$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DeployRoot = Join-Path $ProjectRoot '.deploy'
$CandidatePath = Join-Path $DeployRoot 'candidate'
$PreviousPath = Join-Path $DeployRoot 'previous'
$CurrentPath = Join-Path $ProjectRoot 'dist\plano-de-controle'
$PidFile = Join-Path $DeployRoot 'server.pid'
$ServerRelativePath = 'dist\plano-de-controle\server\server.mjs'
$ServerPath = Join-Path $ProjectRoot $ServerRelativePath
$EnvFile = Join-Path $ProjectRoot '.env'

function Write-Step([string] $Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked([string] $Program, [string[]] $Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "O comando '$Program $($Arguments -join ' ')' falhou com codigo $LASTEXITCODE."
  }
}

function Get-ConfiguredPort {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Arquivo .env nao encontrado em $EnvFile."
  }

  $port = 4000
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*PORT\s*=\s*["'']?([^\s"'']+)["'']?\s*$') {
      $port = [int] $Matches[1]
    }
  }
  return $port
}

function Get-ListeningProcessId([int] $Port) {
  $tcpCommand = Get-Command 'Get-NetTCPConnection' -ErrorAction SilentlyContinue
  if ($null -ne $tcpCommand) {
    try {
      $ids = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
        Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
      $ids = @()
    }
    if ($ids.Count -gt 1) {
      throw "Mais de um processo esta escutando a porta $Port."
    }
    if ($ids.Count -eq 1) { return [int] $ids[0] }
  }

  $matchingLines = @(netstat -ano -p tcp | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$")
  $ids = @($matchingLines | ForEach-Object {
    if ($_.Matches.Count -gt 0) { [int] $_.Matches[0].Groups[1].Value }
  } | Select-Object -Unique)
  if ($ids.Count -gt 1) {
    throw "Mais de um processo esta escutando a porta $Port."
  }
  if ($ids.Count -eq 1) { return [int] $ids[0] }
  return $null
}

function Assert-ManagedNodeProcess([int] $ProcessId, [int] $Port) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if ($null -eq $processInfo) { return $false }

  $commandLine = [string] $processInfo.CommandLine
  $normalizedCommand = $commandLine.Replace('/', '\').ToLowerInvariant()
  $expectedSuffix = $ServerRelativePath.ToLowerInvariant()
  if ($processInfo.Name -notmatch '^node(\.exe)?$' -or -not $normalizedCommand.Contains($expectedSuffix)) {
    throw "A porta $Port pertence ao PID $ProcessId, mas ele nao e o servidor deste projeto. Nada foi encerrado."
  }
  return $true
}

function Stop-CurrentServer([int] $Port) {
  $processId = Get-ListeningProcessId -Port $Port
  if ($null -eq $processId) {
    Write-Host "Nenhum servidor esta escutando a porta $Port."
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  if (Assert-ManagedNodeProcess -ProcessId $processId -Port $Port) {
    Write-Host "Encerrando servidor atual (PID $processId)..."
    Stop-Process -Id $processId -Force
    Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Start-Server([int] $Port) {
  if (-not (Test-Path -LiteralPath $ServerPath)) {
    throw "Build do servidor nao encontrado em $ServerPath."
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutPath = Join-Path $DeployRoot "server-$timestamp.stdout.log"
  $stderrPath = Join-Path $DeployRoot "server-$timestamp.stderr.log"
  $process = Start-Process -FilePath 'node.exe' `
    -ArgumentList @('--env-file=.env', $ServerRelativePath) `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding Ascii
  Start-Sleep -Milliseconds 700
  if ($process.HasExited) {
    throw "O servidor encerrou durante a inicializacao. Consulte $stderrPath."
  }
  Write-Host "Servidor iniciado em segundo plano (PID $($process.Id), porta $Port)."
  return $process.Id
}

function Wait-ForHealth([int] $Port, [int] $Attempts = 15) {
  $healthUrl = "http://127.0.0.1:$Port/api/health"
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -Method Head -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 204) { return $true }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

function Restore-PreviousVersion([int] $Port) {
  Write-Host 'A nova versao nao ficou saudavel. Iniciando rollback...' -ForegroundColor Yellow
  Stop-CurrentServer -Port $Port

  if (-not (Test-Path -LiteralPath $PreviousPath)) {
    throw 'Nao existe build anterior para restaurar.'
  }
  Remove-Item -LiteralPath $CurrentPath -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $PreviousPath -Destination $CurrentPath
  Start-Server -Port $Port | Out-Null
  if (-not (Wait-ForHealth -Port $Port)) {
    throw 'Rollback executado, mas a versao anterior tambem nao respondeu ao health check.'
  }
  Write-Host 'Rollback concluido: a versao anterior esta no ar.' -ForegroundColor Yellow
}

try {
  Set-Location -LiteralPath $ProjectRoot
  New-Item -ItemType Directory -Path $DeployRoot -Force | Out-Null
  $port = Get-ConfiguredPort

  Write-Step '[1/6] Atualizando codigo da branch main'
  Invoke-Checked -Program 'git.exe' -Arguments @('pull', 'origin', 'main')

  Write-Step '[2/6] Instalando/atualizando dependencias'
  Invoke-Checked -Program 'npm.cmd' -Arguments @('install')

  Write-Step '[3/6] Gerando candidato sem interromper o servidor atual'
  Remove-Item -LiteralPath $CandidatePath -Recurse -Force -ErrorAction SilentlyContinue
  Invoke-Checked -Program 'npm.cmd' -Arguments @(
    'run', 'build:http-test', '--', '--output-path', '.deploy/candidate'
  )
  if (-not (Test-Path -LiteralPath (Join-Path $CandidatePath 'server\server.mjs'))) {
    throw 'O build terminou sem gerar candidate\server\server.mjs.'
  }

  Write-Step '[4/6] Parando o servidor atual'
  Stop-CurrentServer -Port $port

  Write-Step '[5/6] Trocando o build publicado'
  Remove-Item -LiteralPath $PreviousPath -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Split-Path -Parent $CurrentPath) -Force | Out-Null
  if (Test-Path -LiteralPath $CurrentPath) {
    Move-Item -LiteralPath $CurrentPath -Destination $PreviousPath
  }
  try {
    Move-Item -LiteralPath $CandidatePath -Destination $CurrentPath
  } catch {
    if (Test-Path -LiteralPath $PreviousPath) {
      Move-Item -LiteralPath $PreviousPath -Destination $CurrentPath
      Start-Server -Port $port | Out-Null
    }
    throw
  }

  Write-Step '[6/6] Iniciando e validando a nova versao'
  try {
    Start-Server -Port $port | Out-Null
    if (-not (Wait-ForHealth -Port $port)) {
      throw 'A nova versao nao respondeu ao health check.'
    }
  } catch {
    $startupFailure = $_.Exception.Message
    Restore-PreviousVersion -Port $port
    throw "$startupFailure A versao anterior foi restaurada e esta no ar."
  }

  Write-Host "`nDEPLOY CONCLUIDO: http://127.0.0.1:$port/api/health respondeu 204." -ForegroundColor Green
  Write-Host "Build anterior mantido em $PreviousPath para contingencia."
  exit 0
} catch {
  Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
