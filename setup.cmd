REM Created by The Angelo Umali.
REM PowerShell 7 hands its module path down, and Windows PowerShell then cannot load Get-FileHash.
@setlocal
@set "PSModulePath="
@powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
