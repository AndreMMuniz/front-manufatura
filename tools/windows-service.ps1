# Shared by deployment and the standalone service installer. PowerShell 5.1+.
$FmaServiceId = 'FmaService'
$FmaServiceDisplayName = 'fma service'
$WinSwSha256 = 'B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F'

function Assert-ServiceAdministrator {
  if ($env:OS -ne 'Windows_NT') { throw 'Este comando requer Windows.' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute o BAT ou PowerShell como Administrador para gerenciar o servico Windows.'
  }
}

function Get-FmaServicePaths([string] $Root) {
  $directory = Join-Path $Root '.deploy\service'
  return @{
    Directory = $directory
    Executable = Join-Path $directory 'FmaService.exe'
    Config = Join-Path $directory 'FmaService.xml'
    Logs = Join-Path $directory 'logs'
  }
}

function Get-OwnedFmaService([string] $Root) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$FmaServiceId'"
  if ($null -ne $service) {
    $expected = (Get-FmaServicePaths $Root).Executable
    if (-not [string]::Equals(([string] $service.PathName).Trim().Trim('"'), $expected,
        [StringComparison]::OrdinalIgnoreCase)) {
      throw "O servico $FmaServiceDisplayName pertence a outra instalacao. Nada foi alterado."
    }
  }
  return $service
}

function New-FmaServiceXml([string] $Root, [string] $NodePath) {
  # XmlDocument escapes spaces, accents and XML metacharacters in installation paths.
  $doc = New-Object System.Xml.XmlDocument
  $service = $doc.CreateElement('service')
  [void] $doc.AppendChild($service)
  $values = [ordered]@{
    id = $FmaServiceId
    name = $FmaServiceDisplayName
    description = 'Servidor Node.js do Plano de Controle e APIs Datasul.'
    executable = $NodePath
    arguments = '--env-file="' + (Join-Path $Root '.env') + '" "' + (Join-Path $Root 'dist\plano-de-controle\server\server.mjs') + '"'
    workingdirectory = $Root
    startmode = 'Automatic'
    delayedAutoStart = 'true'
    stoptimeout = '30 sec'
    logpath = (Get-FmaServicePaths $Root).Logs
  }
  foreach ($key in $values.Keys) {
    $element = $doc.CreateElement($key)
    $element.InnerText = $values[$key]
    [void] $service.AppendChild($element)
  }
  $failure = $doc.CreateElement('onfailure')
  $failure.SetAttribute('action', 'restart')
  $failure.SetAttribute('delay', '10 sec')
  [void] $service.AppendChild($failure)
  $account = $doc.CreateElement('serviceaccount')
  $domain = $doc.CreateElement('domain')
  $domain.InnerText = 'NT AUTHORITY'
  [void] $account.AppendChild($domain)
  $user = $doc.CreateElement('user')
  $user.InnerText = 'LocalService'
  [void] $account.AppendChild($user)
  [void] $service.AppendChild($account)
  $log = $doc.CreateElement('log')
  $log.SetAttribute('mode', 'roll-by-size')
  foreach ($pair in @(@('sizeThreshold', '10240'), @('keepFiles', '8'))) {
    $child = $doc.CreateElement($pair[0]); $child.InnerText = $pair[1]
    [void] $log.AppendChild($child)
  }
  [void] $service.AppendChild($log)
  return $doc.OuterXml
}

function Invoke-ServiceNative([string] $Program, [string[]] $Arguments) {
  & $Program @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Falha em $Program (codigo $LASTEXITCODE)." }
}

function Assert-WinSwBinary([string] $Path) {
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $WinSwSha256) {
    throw "Hash WinSW invalido: $Path. Use WinSW.NET461.exe v2.12.0 oficial."
  }
}

function Install-FmaService([string] $Root) {
  Assert-ServiceAdministrator
  $existing = Get-OwnedFmaService $Root
  $paths = Get-FmaServicePaths $Root
  if ($null -ne $existing) {
    Assert-WinSwBinary $paths.Executable
    if (-not (Test-Path -LiteralPath $paths.Config)) { throw 'Configuracao XML do servico ausente.' }
    # Keep the installed account and configuration, including administrator customizations.
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Root '.env'))) { throw 'Arquivo .env ausente.' }
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null
  $appLogs = Join-Path $Root 'logs'
  New-Item -ItemType Directory -Path $appLogs -Force | Out-Null
  if (-not (Test-Path -LiteralPath $paths.Executable)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $download = $paths.Executable + '.download'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe' -OutFile $download
      Assert-WinSwBinary $download
      Move-Item -LiteralPath $download -Destination $paths.Executable
    } finally {
      if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
    }
  }
  Assert-WinSwBinary $paths.Executable
  $xml = New-FmaServiceXml $Root $nodePath
  [IO.File]::WriteAllText($paths.Config, $xml, (New-Object Text.UTF8Encoding($false)))
  # LocalService may read the build/.env, but only write application and wrapper logs.
  Invoke-ServiceNative 'icacls.exe' @($Root, '/grant', '*S-1-5-19:(OI)(CI)RX')
  Invoke-ServiceNative 'icacls.exe' @($appLogs, '/grant', '*S-1-5-19:(OI)(CI)M')
  Invoke-ServiceNative 'icacls.exe' @($paths.Logs, '/grant', '*S-1-5-19:(OI)(CI)M')
  Invoke-ServiceNative $paths.Executable @('install')
  Write-Host "Servico $FmaServiceDisplayName instalado com inicio automatico."
}

function Stop-FmaService([string] $Root) {
  if ($null -eq (Get-OwnedFmaService $Root)) { return }
  $service = Get-Service -Name $FmaServiceId -ErrorAction Stop
  if ($service.Status -ne 'Stopped') {
    Stop-Service -InputObject $service -ErrorAction Stop
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
  }
}

function Start-FmaService([string] $Root) {
  if ($null -eq (Get-OwnedFmaService $Root)) { throw 'Servico fma service nao instalado.' }
  Start-Service -Name $FmaServiceId -ErrorAction Stop
  (Get-Service -Name $FmaServiceId).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}
