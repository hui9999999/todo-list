@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-desktop-pet.ps1"
if errorlevel 1 pause
