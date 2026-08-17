@echo off
title PEAQ Modul-Konfigurator
cd /d "%~dp0"
echo Starte lokalen Server auf http://localhost:8123/app/ ...
start "" http://localhost:8123/app/
node server.js
pause
