@echo off
setlocal
cd /d "C:\Users\ce_lu\OneDrive\Documentos\Nova pasta (4)\planodeproducao"
if errorlevel 1 (
  echo Nao foi possivel acessar a pasta do projeto.
  pause
  exit /b 1
)

if not exist ".agents\totvs_agent_minimo\main.py" (
  echo O agente TOTVS nao foi encontrado na pasta do projeto.
  pause
  exit /b 1
)

python ".agents\totvs_agent_minimo\main.py" abrir-fluxo FCRFP018
if errorlevel 1 (
  echo.
  echo Falha ao abrir o FCRFP018. Copie a mensagem acima para o Codex.
  pause
  exit /b 1
)

echo.
echo FCRFP018 aberto. Avise o Codex para preparar a selecao dos titulos.
echo Este arquivo nao gera remessa.
pause
