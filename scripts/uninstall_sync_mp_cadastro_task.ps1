$ErrorActionPreference = "Stop"

$taskName = "Liebe MP Cadastro Sync"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Host "Tarefa nao encontrada: $taskName"
  exit 0
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

Write-Host "Removido: $taskName"
