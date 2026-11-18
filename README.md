# Agent Inbox

See which Codex Desktop sessions are running, waiting for you, or have unread results—all in one local window.

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-0969DA?style=for-the-badge)](https://github.com/heyyowtfyyh/Agent-Inbox-Desktop/releases/latest/download/Agent-Inbox-Windows-x64.zip)

Windows x64 portable ZIP · [Release notes](https://github.com/heyyowtfyyh/Agent-Inbox-Desktop/releases/latest)

Agent Inbox is a Windows desktop companion for working with multiple agents across projects.
It groups sessions by project so you can find work that needs attention and return to the relevant Codex conversation or VS Code workspace.

[Quick start](#quick-start) · [Install with an agent](#install-with-an-agent) · [Local configuration](#local-configuration) · [Troubleshooting](#troubleshooting) · [Adding providers](#adding-providers)

## Local operation and privacy

Agent Inbox runs on your computer and monitors Codex Desktop through its local database and Windows interprocess communication.
It requires no separate account or API key. The current application has no telemetry, analytics, or functionality for uploading session data to external servers.
The interface, fonts, and icons are bundled locally; monitoring does not depend on a cloud backend.

- Installing dependencies requires internet access. Once installed, Agent Inbox's local monitoring does not require a connection to external services.
- The original Codex database is only read. Agent Inbox creates a copy in the system temporary directory and removes it after reading, avoiding SQLite sidecar writes to the original database.
- Agent Inbox does not reply to conversations, approve actions, or mark Codex conversations as read.
- Pins and avatar preferences are stored in Electron's local user data directory. Path overrides can be stored in a Git-ignored `.env` file.
- When you use a navigation action, Agent Inbox passes a conversation link to Codex Desktop or a project path to your local VS Code installation.

These statements cover Agent Inbox itself. Codex and other agents manage their own network connections and data handling.

## Features

- **Inbox:** focus on running sessions, requests for input or approval, errors, unread results, and pinned sessions.
- **All sessions:** browse discovered local desktop sessions, grouped by project, with status filters.
- **Session counts:** see Running, Needs attention, and Unread totals.
- **Monitoring status:** a top-right badge shows the connection state. When monitoring fails, an inline message above the counts explains the cause and next step; it clears automatically after recovery.
- **Taskbar badge:** count conversations that are unread or waiting for your input or approval, counting each conversation once. The badge hides at zero or when the source is unavailable and shows `99+` above 99.
- **Quick navigation:** open the corresponding Codex conversation or project directory in VS Code.
- **Consistent avatars:** seven shapes, eight colors, and three expressions. Each session keeps its shape and color across status updates.

Unread is an independent flag and can coexist with Running. An unread result does not necessarily mean the task has finished.

| State | Meaning |
| --- | --- |
| Running | Native signals indicate that work is in progress. |
| User input / Needs attention | Waiting for an answer or action approval. |
| Idle | Native signals indicate that the session is idle. |
| Error | A native `systemError` state was received. |
| Unknown | Sufficient native state evidence has not been received, has been lost, or cannot be interpreted. |
| Unread | The native Codex unread flag is true. |

## Requirements

- Windows x64 for the portable ZIP. Live monitoring and the taskbar badge target Windows.
- Node.js 24 or newer with npm for running or building from source.
- Codex Desktop: for live monitoring, run it under the same Windows user account and have local desktop sessions available for verification.
- VS Code: optional; needed only for opening project directories in the editor.

Only the Codex provider is implemented. Claude Code and monitoring sessions on other hosts are not currently supported.
The integration depends on Codex's local data formats and IPC signals; compatibility with every version is not guaranteed.

**Codex Desktop updates may interrupt monitoring.** If statuses stop updating after an update, ask your coding agent to diagnose the connection and restore monitoring; a provider compatibility update may be needed.
See [After a Codex Desktop update](#after-a-codex-desktop-update) for a prompt you can copy.

## Quick start

### Windows x64 portable ZIP

1. Extract `Agent-Inbox-Windows-x64.zip` and keep the entire `Agent Inbox` folder together.
2. Open Codex Desktop, then double-click `Agent Inbox.exe` in the extracted folder.

The ZIP includes Electron and runs without a separate Node.js installation. Closing the Inbox window stops monitoring. Pins and avatar preferences are stored under `%APPDATA%\agent-inbox` and carry over when you replace the app folder.

To create a desktop shortcut, first move the extracted folder to the location where you want to keep it. In File Explorer, right-click `Agent Inbox.exe`, select **Show more options** if it appears, then choose **Send to** → **Desktop (create shortcut)**. Recreate the shortcut if you move the folder later. See [Microsoft's desktop shortcut instructions](https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-desktop-icons-in-windows).

### Run from source

After obtaining the source, open PowerShell in the project root:

```powershell
node --version
npm.cmd --version
npm.cmd ci
npm.cmd start
```

By default, Agent Inbox detects the Codex data directory and VS Code and uses the standard local monitoring pipe. You do not need to create a `.env` file first.
Open Codex Desktop before starting Agent Inbox.

To preview the interface with sample sessions:

```powershell
npm.cmd run demo
```

Demo mode uses simulated sessions without reading real Codex data or connecting to its monitoring pipe. Navigation is disabled for sample sessions.

## Install with an agent

After obtaining the source, open this project directory in your coding agent and give it the prompt below.
A normal installation involves checking the environment and adjusting local configuration; it should not require changes to provider source code.

<details>
<summary>Expand and copy the installation prompt</summary>

```text
Help me install and verify Agent Inbox on this Windows computer.

1. Read AGENTS.md, README.md, package.json, and .env.example first to understand the current implementation.
2. Check for Node.js >= 24 and npm. Clearly report any missing prerequisites.
3. Run npm.cmd ci from the project root.
4. Keep automatic detection enabled and check the local Codex data directory and optional VS Code path.
   Create or edit .env only if automatic detection does not work, preserving existing settings.
   Use absolute paths and single quotes around Windows paths. Do not add passwords, tokens, or API keys.
   Non-empty process environment variables override .env; do not change the global environment to bypass this precedence.
5. Run npm.cmd test.
6. Confirm that Codex Desktop is open with local desktop sessions, then run npm.cmd run check:local.
   This check monitors read-only for about eight seconds and prints aggregate counts and diagnostics.
   If sandbox restrictions, permissions, or missing verifiable sessions prevent it from passing, report the limitation rather than claiming monitoring works.
7. Run npm.cmd start and confirm that the window loads correctly.
8. Adjust .env for path problems. For unsupported database schemas or IPC versions, report the diagnostic and Codex version.
   Do not guess session states, rewrite the provider to hide a failure, or automatically switch to another database version.
9. Do not modify Codex data, mark conversations as read, or print or upload credentials, conversation content, or entire databases.
   Do not commit, push, or create a public repository.

Finish by reporting which local settings changed, the result of each check, and any unresolved limitations.
```

</details>

## Local configuration

If automatic detection does not work for your setup, copy [.env.example](.env.example) to `.env` in the project root when running from source, or next to `Agent Inbox.exe` when using the portable ZIP.
If `.env` already exists, edit it in place and preserve its other settings. Fill in only the overrides you need; empty values keep the defaults.

| Setting | Default behavior |
| --- | --- |
| `AGENT_INBOX_CODEX_HOME` | Use inherited `CODEX_HOME`, otherwise `.codex` under the current user's home directory. |
| `AGENT_INBOX_VSCODE_PATH` | Search standard installations and `PATH` for `Code.exe`. An override must be the full executable path. |
| `AGENT_INBOX_CODEX_PIPE` | Use the local Windows pipe `\\.\pipe\codex-ipc`; normally no override is needed. |
| `AGENT_INBOX_VERIFIED_CODEX_LINKS` | `1` enables Codex conversation links. Set `0` to disable them and look up conversations manually. |
| `AVATAR_THEME` | `auto`: use a complete local theme when present, otherwise the bundled public theme. `open-source`: use the bundled public theme. |

Example overrides; replace these with paths that actually exist on your computer:

```dotenv
AGENT_INBOX_CODEX_HOME='C:\Tools\Codex data'
AGENT_INBOX_VSCODE_PATH='C:\Tools\VS Code\Code.exe'
```

- Settings use this precedence: non-empty process environment variable → `.env` → default.
- Use single quotes around Windows paths. Double quotes can interpret backslash followed by `n` as a newline. Paths containing `#` also need quotes.
- Paths must be absolute. `%VARIABLE%` and `~` are not expanded.
- `.env` is read independently of the working directory. Restart Agent Inbox after changing it.
- A saved choice in the Avatar menu overrides `AVATAR_THEME`. Changes made through that menu take effect immediately.

The public source does not require private avatar assets. See [Avatar themes](docs/AVATARS.md) for theme formats and local overrides.

## Troubleshooting

Check the top-right monitoring badge first. Green **Monitoring** means native state has been received; amber indicates connection or recovery in progress. A red **Monitoring unavailable** badge and the message below the heading explain permission or compatibility failures.
An individual Unknown or Error session does not mean the monitoring source has failed. Demo mode shows **Sample data**.

Open a local conversation in Codex Desktop, then run this from the project root:

```powershell
npm.cmd run check:local
```

The check discovers sessions and monitors read-only for about eight seconds. It prints session counts, status totals, the number of sessions with native unread evidence, and update counts.
Diagnostic messages contain no raw paths, session IDs, or conversation content. The check fails if no sessions or verifiable native signals are available.

| Diagnostic or symptom | What to check |
| --- | --- |
| `DATABASE_NOT_FOUND` | Confirm that Codex Desktop has created local data and that `AGENT_INBOX_CODEX_HOME` points to the correct directory. |
| `DATABASE_ACCESS_DENIED` | Check access permissions for the data directory and system temporary directory. |
| `NO_MATCHING_SESSIONS` | Confirm that supported local desktop sessions exist. If they remain missing, report the Codex version. |
| `UNSUPPORTED_SCHEMA` / `STREAM_VERSION_UNSUPPORTED` / `READ_VERSION_UNSUPPORTED` | Report the Codex version and diagnostic code. These are format or protocol compatibility issues that require provider changes. |
| `PIPE_UNAVAILABLE` / `PIPE_CONNECT_TIMEOUT` / handshake failure | Confirm that Codex Desktop is running and check any pipe override. Timed-out connections are retried automatically. |
| `PIPE_ACCESS_DENIED` | Confirm both apps run under the same Windows user account and check sandbox or permission restrictions. |
| `DATABASE_BUSY` / `PIPE_DISCONNECTED` | The app retries automatically. Keep the diagnostic code if the problem persists. |
| Every session shows Unknown | Check diagnostics and run the local check. An individual unloaded session or one without sufficient native evidence can also show Unknown. |
| VS Code will not open | Confirm the project directory still exists. Set `AGENT_INBOX_VSCODE_PATH` for a nonstandard installation. |
| Codex conversation links do not work | Confirm the system can handle Codex links. Set `AGENT_INBOX_VERIFIED_CODEX_LINKS=0` to use manual lookup. |

Unknown runtime and unread states are not guessed to be Idle or read. A change in the unread flag alone is not treated as task completion.

### After a Codex Desktop update

An update can change Codex's local IPC protocol or data format. Agent Inbox may still list sessions while every status shows Unknown or no longer updates.
Depending on the cause, recovery may involve reconnecting, restarting Agent Inbox, or updating the provider for a changed protocol or schema.

Open this project in your coding agent and use the prompt below:

<details>
<summary>Expand and copy the monitoring repair prompt</summary>

```text
Codex Desktop was updated and Agent Inbox no longer receives live status updates. Diagnose and restore monitoring.

1. Read AGENTS.md, README.md, docs/PROVIDERS.md, and the current Codex provider before making changes.
2. Run npm.cmd run check:local and identify whether the failure is connection, permissions, schema, or protocol compatibility.
   Distinguish sandbox restrictions from an actual monitoring failure.
3. Restore the connection, or make a narrow provider fix if needed. Verify the installed Codex version and actual event formats first.
   Do not blindly increase the accepted version or disable compatibility checks; unsupported evidence must remain Unknown.
4. For provider changes, add relevant regression coverage and run npm.cmd test and the affected Electron checks.
5. Verify real monitoring with npm.cmd run check:local, then restart Agent Inbox to load any changes. Preserve pins, avatar preferences, and local settings.
6. Report the cause, changes, validation results, and any remaining limitations.
   Do not modify Codex data or unread state, expose conversation content or credentials, commit, or push.
```

</details>

## Adding providers

The current Codex entry point is [createCodexProvider](src/providers/codex/index.js). It owns session discovery,
native runtime and unread projection, connection lifecycle, and conversation navigation targets.
See [Monitoring providers](docs/PROVIDERS.md) for the interface and contribution guidance.

Developers and their coding agents are welcome to explore local data sources and events for tools such as Claude Code,
implement a corresponding provider, and connect it to the existing snapshot interface.
New sources need verified data formats, runtime and unread semantics, and tests. Capabilities without reliable evidence should remain unavailable.

Claude support is not implemented; pointing `.env` at a Claude directory is not sufficient.
Each product needs its own parsing and event handling, and may also require provider selection and UI wording changes.
There is currently no dynamic plugin loading or aggregation of multiple providers.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm.cmd test` | Unit tests for configuration, launch environment, discovery, providers, state, avatars, and badges. |
| `npm.cmd run test:error-ui` | Verify Electron status UI and recovery with an isolated database, profile, and simulated pipe. |
| `npm.cmd run test:avatar-ui` | Verify theme switching, public assets, 46px / 28px rendering, and the distribution file list. |
| `npm.cmd run test:taskbar` | Verify native Windows badge updates and hiding at zero using simulated events. |
| `npm.cmd run check:local` | Verify real local Codex data and native monitoring; requires Codex Desktop. |
| `npm.cmd run build:windows` | Build `dist/Agent-Inbox-Windows-x64.zip` on Windows x64 after `npm.cmd ci`. |

Error handling has been verified with simulated events and UI checks. A real Codex `systemError` has not yet been reproduced.
When reporting a problem, include reproduction steps, Windows / Node.js / Codex versions, and diagnostic codes. Remove private information first.

## License

Agent Inbox is licensed under **MIT with the Commons Clause License Condition v1.0**. The combined terms are in [LICENSE](LICENSE).
This is a **source-available** license, not an OSI-approved open-source license or a choice between MIT and Commons Clause.

- You may use the tool for work and freelance projects, modify it, and share it, subject to the combined terms and preservation of the required notices.
- You may not "Sell" the Software as defined in Commons Clause: this includes paid products or services whose value derives entirely or substantially from its functionality, including minor rebrands or repackaged versions.
- This does not prohibit every commercial use or every derivative product. See the [Commons Clause text and FAQ](https://commonsclause.com/) for the scope of the restriction. The full LICENSE governs; this summary does not replace it.

Separately licensed third-party components retain their own terms; this project license does not relicense them.
See the [Phosphor Icons license](src/assets/LICENSE.phosphor) for icon terms and the respective licenses supplied with fonts and other dependencies.
