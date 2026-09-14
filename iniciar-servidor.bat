@echo off
cd /d "%~dp0"
start "Orden de llegada" http://localhost:8000/index.html
where py >nul 2>&1
if %errorlevel% equ 0 (
  py server.py
  goto :end
)
where python >nul 2>&1
if %errorlevel% equ 0 (
  python server.py
  goto :end
)
echo Python no esta instalado en esta PC.
echo Instala Python desde https://www.python.org/downloads/
pause
:end
