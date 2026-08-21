$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $projectRoot "logs"
$installLog = Join-Path $logDir "install_sync_mp_cadastro_service.log"
$serviceScript = Join-Path $projectRoot "scripts\mp_cadastro_windows_service.py"

if (!(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Log($message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
  Write-Host $line
  Add-Content -Path $installLog -Value $line
}

function RunStep($label, $exe, [string[]]$arguments) {
  Log $label
  Log "CMD: $exe $($arguments -join ' ')"
  $output = & $exe @arguments 2>&1
  $code = $LASTEXITCODE
  if ($output) {
    $output | ForEach-Object {
      Write-Host $_
      Add-Content -Path $installLog -Value $_
    }
  }
  if ($code -ne 0) {
    throw "Falha em: $label (exit code $code)"
  }
}

try {
  Set-Location $projectRoot
  Set-Content -Path $installLog -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Iniciando instalacao"

  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
  if (!$isAdmin) {
    throw "Execute como administrador."
  }
  Log "Administrador OK"

  Log "Removendo inicializacao antiga"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\uninstall_sync_mp_cadastro_startup.ps1") 2>&1 |
    ForEach-Object {
      Write-Host $_
      Add-Content -Path $installLog -Value $_
    }

  $python = (Get-Command python.exe -ErrorAction Stop).Source
  Log "Python: $python"

  RunStep "Verificando pywin32" $python @("-c", "import win32serviceutil, win32service, win32event; print('pywin32 OK')")
  RunStep "Instalando servico Windows" $python @($serviceScript, "install-direct")
  RunStep "Iniciando servico Windows" $python @($serviceScript, "start-direct")
  RunStep "Consultando status" "sc.exe" @("query", "LiebeMPCadastroSync")

  Log "Instalacao finalizada"
  Log "Servico: Liebe MP Cadastro Sync"
  Log "Log do servico: $logDir\sync_mp_cadastro_service.log"
} catch {
  Log "ERRO: $($_.Exception.Message)"
  throw
}
