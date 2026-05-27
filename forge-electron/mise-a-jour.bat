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
tasklist /FI "IMAGENAME eq ForgeMTG.exe" 2>nul | find /I "ForgeMTG.exe" >nul
if not errorlevel 1 (
  echo  [!] ForgeMTG.exe est en cours d'execution.
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
  echo  [!] renderer.js introuvable dans :
  echo      %~dp0
  echo.
  echo  Verifiez que mise-a-jour.bat est dans le dossier de ForgeMTG.exe.
  pause
  exit /b 1
)
if "%JAR%"=="" (
  echo  [!] forge-api.jar introuvable dans :
  echo      %~dp0
  pause
  exit /b 1
)

echo  renderer.js : %RENDERER%
echo  forge-api.jar: %JAR%
echo.

echo  Telechargement de renderer.js...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-electron/src/renderer.js' -OutFile '%RENDERER%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo  Telechargement de forge-api.jar (40 Mo, patience)...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/forge-api/forge-api.jar' -OutFile '%JAR%' -UseBasicParsing; Write-Host '  OK' } catch { Write-Host '  ERREUR:' $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :error

echo.
echo  Mise a jour reussie !
echo  Relancez ForgeMTG.exe.
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
