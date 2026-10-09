@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\install_sync_mp_cadastro_startup.ps1"
pause
