@echo off
REM Startet Frojach Drive unter Windows. Doppelklick genuegt.
REM Beim ersten Mal werden die Abhaengigkeiten geholt und gebaut, das dauert
REM eine Minute. Danach geht es sofort los.

cd /d "%~dp0"
title Frojach Drive

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js ist nicht installiert.
  echo   Bitte von https://nodejs.org herunterladen ^(LTS-Fassung^), installieren
  echo   und diese Datei danach erneut doppelklicken.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Einmalige Einrichtung, bitte kurz warten ...
  echo.
  call npm install || goto :fehler
)

if not exist "dist\index.html" (
  echo.
  echo   Spiel wird gebaut ...
  echo.
  call npm run build || goto :fehler
)

node scripts\serve.mjs
exit /b 0

:fehler
echo.
echo   Da ist etwas schiefgegangen. Die Meldung steht oben.
echo.
pause
exit /b 1
