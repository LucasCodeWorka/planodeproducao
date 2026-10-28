@echo off
pushd "%~dp0"
python .agents\totvs_agent_minimo\scripts\continuar_orcamento_2026_10_16.py --fase completo
set "CODIGO_SAIDA=%ERRORLEVEL%"
popd
if not "%CODIGO_SAIDA%"=="0" (
  echo.
  echo O fluxo parou em uma verificacao. Envie esta mensagem ao Codex.
  pause
)
exit /b %CODIGO_SAIDA%
