@echo off
title PX Monitorias - criar atalho
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-atalho-windows.ps1" %*
pause
