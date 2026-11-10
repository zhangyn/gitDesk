@echo off
rem Build GitDesk installer. Avoids unset rustup default toolchain and missing cargo PATH.
rem Usage: scripts\build-app.bat  (or double-click)
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
if not defined RUSTUP_TOOLCHAIN set "RUSTUP_TOOLCHAIN=stable"
cd /d "%~dp0.."

echo [1/2] frontend + rust release + nsis ...
call npx tauri build %*
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

echo.
echo [2/2] artifacts:
if exist "src-tauri\target\release\gitdesk.exe" (
  for %%F in ("src-tauri\target\release\gitdesk.exe") do echo   exe: %%~nxF %%~zF bytes
)
for %%F in ("src-tauri\target\release\bundle\nsis\*.exe") do echo   installer: %%~nxF %%~zF bytes
endlocal
