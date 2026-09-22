@echo off
setlocal
if "%~1"=="" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Source-EOC.ps1" -Action Launch -Profile production
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Source-EOC.ps1" %*
)
exit /b %ERRORLEVEL%
