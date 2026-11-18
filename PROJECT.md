# Agent Inbox

Agent Inbox is a lightweight, local-first Windows desktop companion for Codex
Desktop. It gives developers one place to see which Codex Worker sessions are
active, need attention, or have unread results, and to return to the relevant
conversation or project through supported shortcuts.

## Users and workflow

Agent Inbox is for developers running several workflows in parallel. They use
ChatGPT Planners in Chrome for planning and review, and Codex Desktop Workers
for implementation. The inbox makes it easier to keep track of those Workers
across projects without cycling through conversations.

## Product principles

- Keep the inbox compact and make sessions that need attention easy to find.
- Monitor Codex locally with read-only access and respect its native unread state.
- Show uncertainty when local evidence is missing or unreliable.
- Complement Codex Desktop, VS Code, and Windows tools such as FancyZones.

## Technical direction and stage

The Phase 1 prototype follows the Graphite Figma design and uses Electron with
HTML, CSS, and JavaScript. On the tested Windows installation, it follows live
Codex sessions through the local `codex-ipc` pipe. It shows **User input** for
pending asynchronous option cards and manual command approvals. Each Inbox card
shows one status badge. **Pin** keeps a session in Inbox after it becomes idle
and read. Pins are stored locally by session ID and survive an Agent Inbox
restart.

In PowerShell on Windows with Node.js 24 or newer, run `npm.cmd ci`, then
`npm.cmd start` to read local sessions or `npm.cmd run demo` to try the app
with sample sessions. See the [feasibility report](docs/FEASIBILITY.md) for
the verified integrations and remaining limits.

Codex monitoring is encapsulated by `src/providers/codex/index.js`. See the
[provider interface](docs/PROVIDERS.md) for source boundaries and future-provider
contribution guidance. This currently supports Codex only.

## Local configuration

The app works without a `.env` file. If automatic detection needs an override,
copy `.env.example` to `.env` in the project root and fill only the required
values. `.env` is ignored by Git. Restart Agent Inbox after changing settings.

- `AGENT_INBOX_CODEX_HOME`: absolute Codex data directory. Otherwise use the
  inherited `CODEX_HOME`, then the current user's `.codex` directory.
- `AGENT_INBOX_VSCODE_PATH`: absolute path to `Code.exe`. Otherwise search the
  standard installations and `PATH`. An explicit unavailable path reports an
  error when opening VS Code rather than silently choosing another installation.
- `AGENT_INBOX_CODEX_PIPE`: optional local Windows pipe override. Defaults to
  `\\.\pipe\codex-ipc`; this name contains no personal account information.
- `AGENT_INBOX_VERIFIED_CODEX_LINKS`: `1` enables Codex deep links (default);
  `0` uses manual session lookup.

For each setting, a non-empty process environment value takes precedence over
the `.env` value. Empty values use the next source or the default. Paths must
be absolute; `%VARIABLE%` and `~` are not expanded. Use single quotes for Windows
paths, for example `AGENT_INBOX_CODEX_HOME='C:\new\Codex # local'`. Double quotes
can interpret backslash-n as a newline; control characters in paths are rejected.
The `.env` file is resolved beside this project's `package.json`, independently
of the working directory. Only recognized settings are used, and `.env` values
are not copied into the process environment. No account credentials are needed.

Run `npm.cmd test` to verify configuration and simulated runtime behavior.
On Windows, `npm.cmd run test:error-ui` verifies Error badges, filtering,
runtime resynchronization, recovery and disconnect behavior in the real Electron app using an isolated
database, app profile and mock pipe. It does not require Codex Desktop or
connect to its real pipe. This validates simulated events, not a reproduced
native Codex error.

With Codex Desktop open,
run `npm.cmd run check:local` to check session discovery and listen for native
state for eight seconds. The command prints aggregate counts only, then
disconnects. It fails if no sessions or verifiable native state are available.

See the [MVP functional specification](docs/FEATURES.md) for requirements,
acceptance criteria, feasibility questions, and delivery phases.
