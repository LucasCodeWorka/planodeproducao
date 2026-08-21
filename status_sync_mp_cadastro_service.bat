@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Status do servico Liebe MP Cadastro Sync
echo ============================================================
echo.

sc query LiebeMPCadastroSync
if %errorlevel% neq 0 (
  echo.
  echo Servico nao encontrado. Execute install_sync_mp_cadastro_service.bat como administrador.
  echo.
  echo Log do instalador:
  if exist logs\install_sync_mp_cadastro_service.log (
    powershell.exe -NoProfile -Command "Get-Content logs\install_sync_mp_cadastro_service.log -Tail 80"
  )
  pause
  exit /b 1
)

echo.
echo Log do servico:
if exist logs\sync_mp_cadastro_service.log (
  powershell.exe -NoProfile -Command "Get-Content logs\sync_mp_cadastro_service.log -Tail 20"
) else (
  echo Log ainda nao criado.
)
pause
