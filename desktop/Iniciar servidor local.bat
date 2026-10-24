@echo off
title PX Monitorias - servidor local
cd /d "%~dp0.."
if not exist node_modules (echo Instalando dependencias... & call npm install --omit=dev)
start "" http://localhost:3000
node server/index.js
