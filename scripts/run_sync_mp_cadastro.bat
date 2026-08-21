@echo off
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
:loop
python -u scripts\sync_mp_cadastro.py --loop --interval 300
echo [%date% %time%] sync_mp_cadastro encerrou. Reiniciando em 30s... >> logs\sync_mp_cadastro.log
timeout /t 30 /nobreak >nul
goto loop
