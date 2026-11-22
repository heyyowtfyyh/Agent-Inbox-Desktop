Agent Inbox for Windows x64

Extract the ZIP and keep the whole Agent Inbox folder together. Open Codex
Desktop first, then double-click Agent Inbox.exe. Closing the Inbox window
stops monitoring. The ZIP includes the runtime needed to launch Agent Inbox.

To create a desktop shortcut, move the extracted folder to its final location.
Right-click Agent Inbox.exe in File Explorer, then select Show more options
if it appears. Choose Send to > Desktop (create shortcut). If you move the app
folder later, recreate the shortcut from the new location.

Pins and avatar preferences are saved under %APPDATA%\agent-inbox. If you use
local overrides, copy .env.example to .env next to Agent Inbox.exe. Keep a copy
of your .env when replacing the extracted folder with a newer version.

Optional Codex Hooks can provide live session status when the local Codex
monitoring pipe is unavailable. The receiver is record-codex-hook.cmd next to
Agent Inbox.exe. See "Codex Hooks setup" in the repository README for a
hooks.json example and steps to review and trust the Hooks yourself in Codex.
If you move the folder after setup, update the command path in hooks.json.
