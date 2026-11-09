@echo off
setlocal
cd /d "%~dp0"
set "VENV_PY=.venv\Scripts\python.exe"
if not exist "%VENV_PY%" goto create
"%VENV_PY%" -c "import sys; sys.exit(sys.version_info < (3, 11))" >nul 2>&1
if errorlevel 1 goto incompatible
goto run

:create
if not "%~1"=="" (
  "%~1" -m venv .venv
) else (
  py -3.12 -m venv .venv 2>nul
  if errorlevel 1 py -3.11 -m venv .venv
)
if errorlevel 1 goto failed

:run
"%VENV_PY%" -c "import sys; sys.exit(sys.version_info < (3, 11))"
if errorlevel 1 goto incompatible
"%VENV_PY%" -m pip install -r api\requirements.txt
if errorlevel 1 goto failed
if exist ".env" (
  "%VENV_PY%" -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env
) else (
  "%VENV_PY%" -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
)
exit /b %errorlevel%

:incompatible
echo This .venv needs Python 3.11 or 3.12. Rename .venv and rerun run.bat.
exit /b 1

:failed
echo HomeScope setup failed. Check the error above and make sure Python 3.11 or 3.12 is installed.
exit /b 1
