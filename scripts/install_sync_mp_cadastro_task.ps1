$ErrorActionPreference = "Stop"

$taskName = "Liebe MP Cadastro Sync"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$scriptPath = Join-Path $projectRoot "scripts\sync_mp_cadastro.py"
$pythonPath = (Get-Command python.exe -ErrorAction Stop).Source

if (!(Test-Path $scriptPath)) {
  throw "Arquivo nao encontrado: $scriptPath"
}

$action = New-ScheduledTaskAction `
  -Execute $pythonPath `
  -Argument "-u `"$scriptPath`" --loop --interval 300" `
  -WorkingDirectory $projectRoot

$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $triggerLogon `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host "Instalado e iniciado: $taskName"
Write-Host "Python: $pythonPath"
Write-Host "Log: $projectRoot\logs\sync_mp_cadastro.log"
