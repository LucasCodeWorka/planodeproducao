@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\uninstall_sync_mp_cadastro_startup.ps1"
pause
