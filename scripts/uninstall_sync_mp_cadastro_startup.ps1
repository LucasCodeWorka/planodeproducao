$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDir "LiebeMPCadastroSync.vbs"

Remove-Item -LiteralPath $startupFile -Force -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -in @("python.exe", "cmd.exe", "wscript.exe")) -and
    (
      $_.CommandLine -like "*scripts\sync_mp_cadastro.py*" -or
      $_.CommandLine -like "*scripts\run_sync_mp_cadastro.bat*" -or
      $_.CommandLine -like "*scripts\start_sync_mp_cadastro_hidden.vbs*"
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "Removido do inicio do usuario: $startupFile"
