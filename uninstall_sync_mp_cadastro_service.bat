@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Removedor do servico Liebe MP Cadastro Sync
echo Pasta: %CD%
echo ============================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Permissao de administrador nao detectada.
  echo Abrindo novamente como administrador...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  pause
  exit /b
)

echo [1/2] Parando servico...
python scripts\mp_cadastro_windows_service.py stop-direct
echo [2/2] Removendo servico...
python scripts\mp_cadastro_windows_service.py remove-direct
echo.
echo Remocao finalizada.
pause
