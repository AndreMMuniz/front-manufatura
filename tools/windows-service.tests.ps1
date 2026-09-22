# Run: powershell.exe -NoProfile -File tools/windows-service.tests.ps1
# No administrator rights, network, npm, or real Windows service mutations.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'windows-service.ps1')

function Assert-Equal($Actual, $Expected, [string] $Label) {
  if ($Actual -ne $Expected) { throw "$Label : expected [$Expected], got [$Actual]" }
}
function Assert-Throws([scriptblock] $Action, [string] $Pattern) {
  try { & $Action } catch {
    if ($_.Exception.Message -notlike "*$Pattern*") { throw }
    return
  }
  throw "Expected failure containing: $Pattern"
}

# Parse all scripts, then import deployment functions without executing its entrypoint.
foreach ($file in @('windows-service.ps1', 'deploy-front.ps1')) {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref] $tokens, [ref] $errors)
  if ($errors.Count) { throw ($errors | Out-String) }
  if ($file -eq 'deploy-front.ps1') {
    foreach ($definition in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
      . ([scriptblock]::Create($definition.Extent.Text))
    }
  }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('bff-service-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  $root = Join-Path $fixture 'Plano & Controle'
  New-Item -ItemType Directory -Path $root | Out-Null
  [xml] $config = New-FmaServiceXml $root (Join-Path $root 'node.exe')
  Assert-Equal $config.service.id 'FmaService' 'Windows service id'
  Assert-Equal $config.service.name 'fma service' 'Windows service display name'
  Assert-Equal $config.service.workingdirectory $root 'XML path round trip'
  Assert-Equal $config.service.startmode 'Automatic' 'automatic startup'
  Assert-Equal $config.service.serviceaccount.user 'LocalService' 'unprivileged account'
  Assert-Equal $config.service.onfailure.action 'restart' 'recovery'
  Assert-Equal $config.service.log.keepFiles '8' 'bounded logs'
  Assert-Equal ($config.service.arguments.Contains('--env-file="')) $true 'quoted env path'
  Assert-Equal ($config.service.arguments.Contains('server.mjs"')) $true 'quoted bundle path'
  Write-Host 'PASS XML paths, account, startup, recovery and logs'

  $script:registered = $null
  function Get-CimInstance { param($ClassName, $Filter) return $script:registered }
  Assert-Equal (Get-OwnedFmaService $root) $null 'absent service'
  $script:registered = [pscustomobject]@{ PathName = '"other-installation.exe"' }
  Assert-Throws { Get-OwnedFmaService $root } 'outra instalacao'
  $script:registered = [pscustomobject]@{ PathName = '"' + (Get-FmaServicePaths $root).Executable + '"' }
  Assert-Equal ((Get-OwnedFmaService $root).PathName) $script:registered.PathName 'owned service'
  Write-Host 'PASS foreign service rejected and owned service recognized'

  $badBinary = Join-Path $fixture 'bad.exe'
  [IO.File]::WriteAllText($badBinary, 'not WinSW')
  Assert-Throws { Assert-WinSwBinary $badBinary } 'Hash WinSW invalido'
  Write-Host 'PASS corrupted binary rejected'

  $script:events = New-Object 'System.Collections.Generic.List[string]'
  $script:controller = [pscustomobject]@{ Status = 'Running' }
  $script:controller | Add-Member ScriptMethod WaitForStatus { param($status, $timeout) $script:events.Add("wait:$status") }
  function Get-Service { param($Name) return $script:controller }
  function Stop-Service { param($InputObject) $script:events.Add('stop') }
  function Start-Service { param($Name) $script:events.Add('start') }
  Stop-FmaService $root
  Start-FmaService $root
  Assert-Equal ($script:events -join ',') 'stop,wait:Stopped,start,wait:Running' 'SCM lifecycle order'
  $script:events.Clear()
  $script:controller.Status = 'Stopped'
  Stop-FmaService $root
  Assert-Equal $script:events.Count 0 'idempotent stop'
  Write-Host 'PASS waits for SCM stop/start and tolerates stopped service'

  # Install must not touch an existing service's XML/account.
  function Assert-ServiceAdministrator { }
  $paths = Get-FmaServicePaths $root
  New-Item -ItemType Directory -Path $paths.Directory -Force | Out-Null
  [IO.File]::WriteAllText($paths.Config, 'custom configuration')
  function Assert-WinSwBinary { param($Path) $script:events.Add('hash') }
  function Invoke-ServiceNative { param($Program, $Arguments) throw 'Must not reinstall existing service' }
  Install-FmaService $root
  Assert-Equal ([IO.File]::ReadAllText($paths.Config)) 'custom configuration' 'preserved config'
  Write-Host 'PASS repeated installation preserves service configuration'

  $script:registered = $null
  [IO.File]::WriteAllText((Join-Path $root '.env'), 'PORT=4000')
  [IO.File]::WriteAllText($paths.Executable, 'cached binary (hash boundary mocked)')
  function Get-Command { param($Name) return @{ Source = (Join-Path $root 'node.exe') } }
  function Invoke-ServiceNative {
    param($Program, $Arguments)
    $script:events.Add(($Arguments -join '|'))
  }
  $script:events.Clear()
  Install-FmaService $root
  [xml] $installed = [IO.File]::ReadAllText($paths.Config)
  Assert-Equal $installed.service.executable (Join-Path $root 'node.exe') 'installed node path'
  Assert-Equal $script:events[1] ($root + '|/grant|*S-1-5-19:(OI)(CI)RX') 'read-only project ACL'
  Assert-Equal $script:events[4] 'install' 'install after ACL setup'
  Assert-Equal ($script:events.Contains('start')) $false 'installation does not start before publication'
  $script:registered = [pscustomobject]@{ PathName = '"' + $paths.Executable + '"' }
  Write-Host 'PASS first installation writes configuration and ACLs before registering service'

  # Exercise real rollback filesystem operations with mocked Windows/HTTP boundaries.
  $ProjectRoot = $root
  $DeployRoot = Join-Path $root '.deploy'
  $CurrentPath = Join-Path $root 'dist/plano-de-controle'
  $PreviousPath = Join-Path $DeployRoot 'previous'
  $ServerRelativePath = 'dist/plano-de-controle/server/server.mjs'
  $ServerPath = Join-Path $root $ServerRelativePath
  $PidFile = Join-Path $DeployRoot 'server.pid'
  New-Item -ItemType Directory -Path (Join-Path $CurrentPath 'server') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $PreviousPath 'server') -Force | Out-Null
  [IO.File]::WriteAllText($ServerPath, 'broken candidate')
  [IO.File]::WriteAllText((Join-Path $PreviousPath 'server/server.mjs'), 'previous healthy build')
  function Get-ListeningProcessId { param($Port) return $null }
  function Invoke-WebRequest { param($Uri, $Method, [switch] $UseBasicParsing, $TimeoutSec) return @{ StatusCode = 204 } }
  $script:controller.Status = 'Running'
  $script:events.Clear()
  Restore-PreviousVersion 4000
  Assert-Equal ([IO.File]::ReadAllText($ServerPath)) 'previous healthy build' 'restored bundle'
  Assert-Equal ($script:events -join ',') 'stop,wait:Stopped,start,wait:Running' 'rollback service order'
  Assert-Throws { Restore-PreviousVersion 4000 } 'Nao existe build anterior'
  Write-Host 'PASS rollback restores files and uses SCM; missing backup fails clearly'

  # Initial transition must stop SCM before checking/killing legacy Node.
  function Get-ListeningProcessId { param($Port) $script:events.Add('port'); return 123 }
  function Assert-ManagedNodeProcess { param($ProcessId, $Port) return $true }
  function Stop-Process { param($Id, [switch] $Force) $script:events.Add('legacy-stop') }
  function Wait-Process { param($Id, $Timeout) $script:events.Add('legacy-wait') }
  $script:events.Clear()
  Stop-CurrentServer 4000
  Assert-Equal ($script:events -join ',') 'stop,wait:Stopped,port,legacy-stop,legacy-wait' 'legacy migration'
  function Assert-ManagedNodeProcess { param($ProcessId, $Port) throw 'foreign process' }
  $script:events.Clear()
  Assert-Throws { Stop-CurrentServer 4000 } 'foreign process'
  Assert-Equal ($script:events.Contains('legacy-stop')) $false 'foreign process preserved'
  Write-Host 'PASS legacy transition and foreign process protection'
  Write-Host 'All Windows service script tests passed.'
} finally {
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
