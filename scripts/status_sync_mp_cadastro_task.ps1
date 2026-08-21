$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $projectRoot "logs\sync_mp_cadastro.log"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDir "LiebeMPCadastroSync.vbs"

if (!(Test-Path $startupFile)) {
  Write-Host "Inicio do Windows: NAO INSTALADO"
} else {
  Write-Host "Inicio do Windows: INSTALADO"
  Write-Host "Arquivo: $startupFile"
}

$pythonProcesses = Get-Process python -ErrorAction SilentlyContinue
if ($pythonProcesses) {
  Write-Host "Processo Python: EXISTE"
  $pythonProcesses | Select-Object Id, ProcessName | Format-Table -AutoSize
} else {
  Write-Host "Processo Python: NAO ENCONTRADO"
}

Write-Host ""
Write-Host "Log:"
if (Test-Path $logPath) {
  Get-Content $logPath -Tail 20
} else {
  Write-Host "Log ainda nao criado: $logPath"
}
