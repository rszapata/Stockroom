@echo off
REM ════════════════════════════════════════════════════════════
REM  STOCKROOM — Lanzador (servidor + cloudflared tunnel)
REM ════════════════════════════════════════════════════════════
cd /d "%~dp0"

if not exist auth.json (
  echo.
  echo  [X] Falta auth.json
  echo      Copia auth.example.json a auth.json y completa los valores.
  echo.
  pause
  exit /b 1
)

echo.
echo  Iniciando Stockroom...
echo.

REM Servidor (ventana propia)
start "Stockroom Server" cmd /k "node server.js"

REM Esperar a que el servidor levante
timeout /t 3 /nobreak >nul

REM Tunnel cloudflared + notificacion Telegram
start "Stockroom Tunnel" cmd /k "node tunnel.js"

echo.
echo  Listo. Revisa Telegram para la URL publica.
echo.
exit /b 0
