@echo off
REM ---------------------------------------------------------------------
REM  Despensa Inteligente - preparar Ollama para la generacion de recetas
REM
REM  Doble click para ejecutar. Hace tres cosas:
REM    1. Verifica que Ollama este instalado
REM    2. Descarga el modelo si falta
REM    3. Levanta el servidor con el permiso de origen que el navegador
REM       necesita (sin OLLAMA_ORIGINS, Ollama rechaza los pedidos que
REM       vienen de una pagina web y la app no puede hablarle)
REM ---------------------------------------------------------------------
setlocal
set MODELO=llama3.2

echo.
echo ============================================
echo   Despensa Inteligente - Ollama
echo ============================================
echo.

where ollama >nul 2>nul
if errorlevel 1 (
  echo [X] Ollama no esta instalado.
  echo     Descargalo de https://ollama.com/download
  echo.
  pause
  exit /b 1
)
echo [OK] Ollama encontrado.
ollama --version
echo.

echo Descargando el modelo %MODELO% ^(la primera vez tarda, son ~2 GB^)...
ollama pull %MODELO%
if errorlevel 1 (
  echo [X] No se pudo descargar el modelo.
  pause
  exit /b 1
)
echo [OK] Modelo listo.
echo.

echo Probando el modelo con una pregunta del proyecto...
echo ----------------------------------------------------
ollama run %MODELO% "Tengo zapallito que vence manana, cebolla y huevos. Deci en dos lineas que cocinarias para no desperdiciar nada."
echo ----------------------------------------------------
echo.
echo ^(Esta salida sirve como captura para la entrega^)
echo.

echo Levantando el servidor con permiso de origen para el navegador.
echo Dejá esta ventana abierta mientras usas la app.
echo.
echo   En la app: Preferencias - Generacion de recetas con IA
echo     Motor:   Ollama
echo     URL:     http://localhost:11434
echo     Modelo:  %MODELO%
echo.
echo   IMPORTANTE: abri la app desde http://localhost, NO desde una URL
echo   https://. Una pagina servida por HTTPS no puede llamar a localhost
echo   (el navegador lo bloquea por "mixed content").
echo.
set OLLAMA_ORIGINS=*
ollama serve
pause
