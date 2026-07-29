@echo off
REM ---------------------------------------------------------------------
REM  Despensa Inteligente - inicializar el repositorio
REM
REM  Doble click para ejecutar. Crea el repo local y arma la historia
REM  inicial agrupada POR TEMA en vez de un unico commit con todo.
REM
REM  Nota honesta: estos commits van a quedar fechados hoy. No simulan
REM  meses de trabajo y no hay que pretender que lo hagan. El valor esta
REM  en que a partir de aca commitees cada avance: para la entrega vas a
REM  tener semanas de historia real, que es lo que el docente evalua.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   Despensa Inteligente - repositorio git
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [X] Git no esta instalado.
  echo     Descargalo de https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)
echo [OK] Git encontrado.
git --version
echo.

if exist ".git" call :yaexiste
if exist ".git" exit /b 0

REM --- Identidad: sin esto git rechaza el primer commit ---
REM Va en una subrutina a proposito: dentro de un bloque if(), las variables
REM que se leen con `set /p` no se pueden usar en la misma linea de bloque
REM ^(cmd expande %VAR% al PARSEAR el bloque, cuando todavia esta vacia^).
git config user.name >nul 2>nul
if errorlevel 1 call :identidad

echo Inicializando...
git init -b main
if errorlevel 1 (
  REM Git viejo no soporta -b: se crea y se renombra
  git init
  git checkout -b main
)
echo.

echo Armando la historia por temas...
echo.

call :commit ".gitignore README.md" "Estructura inicial del proyecto y documentacion"
call :commit "index.html css icons manifest.json" "Interfaz de la PWA: pantallas, estilos e identidad visual"
call :commit "js/db.js" "Memoria persistente sobre localStorage con exportar e importar"
call :commit "js/recipes.js js/illustrations.js" "Base de 27 recetas clasificadas e ilustraciones"
call :commit "js/agents/inventario.js js/agents/vencimientos.js" "Agentes de Inventario y Vencimientos: semaforo por urgencia"
call :commit "js/agents/hogar.js js/agents/cocinero.js" "Agentes de Hogar y Cocinero: alergias como filtro duro"
call :commit "js/agents/evaluador.js js/agents/aprendizaje.js" "Agentes Evaluador y de Aprendizaje: ajuste por conducta"
call :commit "js/agents/impacto.js js/agents/compras.js" "Metricas de impacto y Agente de Compras: que comprar y que no"
call :commit "js/agents/captura.js" "Agente de Captura: escaneo de codigo de barras y OCR de fecha"
call :commit "js/agents/conversacional.js js/agents/orquestador.js" "Agente Conversacional y Orquestador del ciclo de decision"
REM Sin acentos a proposito: cmd lee este archivo con la codepage del sistema
REM (CP850 en Windows en castellano), no como UTF-8, y cualquier no-ASCII
REM termina corrupto DENTRO del mensaje de commit, que es justo lo que el
REM docente va a leer al abrir el repositorio.
call :commit "js/agents/generador.js" "Agente Generador: recetas con LLM local y veto deterministico"
call :commit "js/main.js" "Capa de interfaz: navegacion, formularios y render de agentes"
call :commit "sw.js" "Service worker: la app abre sin conexion"
call :commit "tests" "Suites de prueba: fechas, recomendacion, estilo y generacion"
call :commit "PLAN_ENTREGA_FINAL.md PLAN_MEJORAS.md INSTALAR_EN_CELULAR.md" "Plan de entrega y guias de instalacion"
call :commit "android-build probar-ollama.bat iniciar-git.bat" "Empaquetado Android y utilidades de desarrollo"

REM Cualquier cosa que haya quedado suelta
git add -A
git diff --cached --quiet || git commit -q -m "Archivos restantes del proyecto"

echo.
echo ============================================
echo   Historia creada
echo ============================================
git log --oneline
echo.
echo ---------------------------------------------------------------
echo  AHORA, PARA SUBIRLO:
echo.
echo  1. Entra a https://github.com/new
echo  2. Nombre sugerido:  despensa-inteligente
echo  3. Marcalo PUBLICO ^(si es privado el docente no lo puede ver^)
echo  4. NO marques "Add a README" ^(ya tenes uno^)
echo  5. Copia la URL que te da y corre estos dos comandos aca:
echo.
echo       git remote add origin https://github.com/pablomonsalvo76/despensa-inteligente.git
echo       git push -u origin main
echo.
echo  6. Despues, en el repo: Settings - Pages - Source: main - carpeta /
echo     Eso publica la app con HTTPS, que la camara necesita si o si.
echo ---------------------------------------------------------------
echo.
pause
exit /b 0

:yaexiste
echo [!] Esta carpeta YA es un repositorio git. Estado actual:
echo.
git log --oneline -n 20
echo.

REM Si ya hay un remoto, se subio a GitHub: rehacer la historia romperia el
REM repositorio publicado. En ese caso ni se ofrece.
git remote get-url origin >nul 2>nul
if not errorlevel 1 (
  echo Ya tiene un remoto configurado, asi que no se toca nada.
  echo Para subir cambios nuevos:
  echo    git add -A
  echo    git commit -m "lo que hiciste"
  echo    git push
  echo.
  pause
  exit /b 0
)

echo No hay remoto configurado ^(todavia no se subio a GitHub^).
echo.
echo Se puede REHACER la historia desde cero. Sirve si algun mensaje de
echo commit quedo mal escrito. Es seguro: no hay nada publicado que romper.
echo.
set /p REHACER="Rehacer la historia? (escribi SI para confirmar): "
if /i not "%REHACER%"=="SI" goto :sinTocar
echo Borrando la historia local...
rmdir /s /q .git
echo Listo. Volve a ejecutar este archivo para crearla de nuevo.
echo.
pause
exit /b 0
:sinTocar
echo No se toco nada.
echo.
pause
exit /b 0

:identidad
echo Git necesita saber quien sos ^(queda registrado en cada commit^).
set /p GITNAME="  Tu nombre y apellido: "
set /p GITMAIL="  Tu email de GitHub: "
git config --global user.name "%GITNAME%"
git config --global user.email "%GITMAIL%"
echo.
exit /b 0

:commit
git add %~1 2>nul
git diff --cached --quiet
if errorlevel 1 (
  git commit -q -m "%~2"
  echo   [+] %~2
) else (
  echo   [-] sin cambios: %~2
)
exit /b 0
