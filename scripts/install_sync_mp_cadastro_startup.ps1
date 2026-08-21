$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$vbsPath = Join-Path $projectRoot "scripts\start_sync_mp_cadastro_hidden.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDir "LiebeMPCadastroSync.vbs"

if (!(Test-Path $vbsPath)) {
  throw "Arquivo nao encontrado: $vbsPath"
}

Copy-Item -Path $vbsPath -Destination $startupFile -Force
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`"" -WindowStyle Hidden

Write-Host "Instalado no inicio do usuario: $startupFile"
Write-Host "Log: $projectRoot\logs\sync_mp_cadastro.log"
