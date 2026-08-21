@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\install_sync_mp_cadastro_service.ps1"
echo.
echo Fim do instalador. Se houve erro, veja logs\install_sync_mp_cadastro_service.log
pause
