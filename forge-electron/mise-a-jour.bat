@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set REPO=King-Obal/Nexus
set BRANCH=master
set BASE_URL=https://raw.githubusercontent.com/%REPO%/%BRANCH%

echo.
echo  =====================================
echo    Nexus -- Mise a jour
echo  =====================================
echo.

:: Verifier si l'appli tourne
tasklist /FI "IMAGENAME eq Nexus.exe" 2>nul | find /I "Nexus.exe" >nul
if not errorlevel 1 (
  echo  [!] Nexus.exe est en cours d'execution.
  echo      Fermez l'application avant de continuer.
  echo.
  pause
  exit /b 1
)

:: Recherche recursive de renderer.js
set RENDERER=
for /f "delims=" %%F in ('dir /s /b "%~dp0renderer.js" 2^>nul') do (
  if "!RENDERER!"=="" set RENDERER=%%F
)

:: Recherche recursive de forge-api.jar
set JAR=
for /f "delims=" %%F in ('dir /s /b "%~dp0forge-api.jar" 2^>nul') do (
  if "!JAR!"=="" set JAR=%%F
)

if "%RENDERER%"=="" (
  echo  [!] renderer.js introuvable. Assurez-vous que mise-a-jour.bat
  echo      est dans le meme dossier que Nexus.exe.
  echo.
  pause
  exit /b 1
)
if "%JAR%"=="" (
  echo  [!] forge-api.jar introuvable.
  echo.
  pause
  exit /b 1
)

:: Deriver index.html et styles.css depuis le dossier de renderer.js
for %%F in ("%RENDERER%") do set RENDERER_DIR=%%~dpF
set INDEX_HTML=%RENDERER_DIR%index.html
set STYLES_CSS=%RENDERER_DIR%styles.css

echo  renderer.js  : %RENDERER%
echo  index.html   : %INDEX_HTML%
echo  styles.css   : %STYLES_CSS%
echo  forge-api.jar: %JAR%
echo.

echo  Telechargement de renderer.js...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-electron/src/renderer.js' -OutFile '%RENDERER%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo  Telechargement de index.html...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-electron/src/index.html' -OutFile '%INDEX_HTML%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo  Telechargement de styles.css...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-electron/src/styles.css' -OutFile '%STYLES_CSS%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo  Telechargement de forge-api.jar (40 Mo, patience)...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-api/forge-api.jar' -OutFile '%JAR%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo.
echo  Mise a jour reussie !
echo  Relancez Nexus.exe.
echo.
pause
exit /b 0

:error
echo.
echo  La mise a jour a echoue. Verifiez votre connexion internet.
echo  Si le probleme persiste, re-telechargez le zip complet depuis GitHub.
echo.
pause
exit /b 1
