@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PX Beedoo - agente de envio (pode minimizar)
rem Abra uma vez. Depois ele abre sozinho, minimizado, sempre que voce entrar no Windows,
rem e fica enviando as mensagens confirmadas na PX Monitorias. Se parar, reabre sozinho.

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY (
  echo Python nao encontrado. Instale o Python 3 ^(python.org ou Portal da Empresa^) e abra este arquivo de novo.
  pause
  exit /b 1
)

%PY% -c "import playwright, truststore" >nul 2>nul
if errorlevel 1 (
  echo Instalando os componentes do agente ^(so na primeira vez^)...
  %PY% -m pip install --user --quiet playwright truststore
)

:inicio
%PY% px_beedoo_agente.py
if "%errorlevel%"=="3" exit /b 0
echo.
echo O agente parou. Abrindo de novo em 15 segundos (feche esta janela para parar de vez)...
timeout /t 15 /nobreak >nul
goto inicio
