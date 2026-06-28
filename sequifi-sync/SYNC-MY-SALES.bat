@echo off
title Sequifi Sync
color 0b
cd /d "%~dp0"
echo.
echo  ========================================================
echo    SYNC MY SEQUIFI SALES
echo  ========================================================
echo.
echo  Type your Sequifi login below, then press Enter.
echo  (Your password does NOT show as you type - that's normal.)
echo.

set /p SEQUIFI_EMAIL=Email:
set "psCommand=powershell -Command "$p=read-host 'Password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($b)""
for /f "usebackq delims=" %%p in (`%psCommand%`) do set "SEQUIFI_PASSWORD=%%p"

echo.
echo  Connecting to Sequifi...
echo.
node sync.js

echo.
echo  --------------------------------------------------------
echo  If it said "Done", your accounts.json is ready!
echo  --------------------------------------------------------
pause
exit
