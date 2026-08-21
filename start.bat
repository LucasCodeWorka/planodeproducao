@echo off
echo === Encerrando processos existentes ===

REM Mata processos nas portas 3000, 8000, 8010
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8010 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo.
echo === Iniciando Backend (porta 8000) ===
start "Backend" cmd /k "cd /d %~dp0 && node src/index.js"

echo.
echo === Aguardando backend iniciar... ===
timeout /t 3 /nobreak >nul

echo.
echo === Iniciando Frontend (porta 3000) ===
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo === Projeto iniciado! ===
echo Backend: http://localhost:8000
echo Frontend: http://localhost:3000
echo.
pause
