@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
set "NODE_OPTIONS="
set "NODE_PATH="
if exist "%~dp0resources\app\src\providers\codex\record-hook.js" (
  "%~dp0Agent Inbox.exe" "%~dp0resources\app\src\providers\codex\record-hook.js"
) else (
  "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0..\src\providers\codex\record-hook.js"
)
