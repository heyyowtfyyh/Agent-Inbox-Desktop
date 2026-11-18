# Monitoring providers

## Current boundary

`src/providers/codex/index.js` exports `createCodexProvider(options)`. The app and
local diagnostic use this entry point. Codex discovery, runtime projection,
unread evidence, stream lifecycle and conversation URL construction stay inside
the provider. Its implementation files are:

- `sessions.js`: read-only metadata snapshots and sample sessions.
- `runtime.js`: native stream, reconnects, patches, resynchronization and availability.
- `input.js`: unanswered input-card detection.

The main process owns Electron, snapshot IPC, local pins, VS Code navigation,
taskbar refresh scheduling and application shutdown. The renderer, grouping,
avatar selection and taskbar count consume the existing snapshot format.

Only Codex is implemented. There is no provider selector, registry, dynamic
plugin loading, multi-source aggregation or Claude integration in this change.

## Provider interface

The constructor accepts source settings and an `onChange()` callback. Changes
signal that a consumer should request a new snapshot; they do not directly
mutate UI state. Codex options reuse the existing data directory, pipe,
deep-link preference and sample mode, without changing `.env` names or defaults.

An optional `onDiagnostic({ code, message })` callback reports missing databases,
unsupported schemas or protocol versions, empty discovery results, and pipe or
permission failures. The app logs these conditions; `check:local` prints them to
stderr. Each condition is reported once per reader/runtime instance. Messages
contain no raw paths, session IDs or conversation content. Diagnostics do not
change status projection, select other database versions, or migrate Codex data.

| Member | Contract |
| --- | --- |
| `id` | Stable source name; currently `codex`. |
| `readSnapshot()` | Promise of normalized metadata and current supported native state. Refreshes the set of tracked IDs. |
| `hasSession(id)` | Promise of discovery membership, including known cached sessions. Does not start native tracking; used to validate pins. |
| `conversationTarget(snapshot, id)` | Validated URL or `null` for a known session. Returns no target in sample mode, for stale sources, disabled deep links, missing IDs or unsafe IDs. Electron opens the URL only after a user action. |
| `stop()` | Idempotently stops stream subscriptions, reconnects and resync timers. Consumers discard the instance afterward; pending metadata reads may finish. |

Reader/runtime factories and platform can be injected for boundary tests. Normal
application startup uses the real implementations. Sample mode uses its stable
seven-session fixture without creating a reader or native stream. Non-Windows
behavior keeps metadata passthrough without unsupported native monitoring.

## Snapshot contract and compatibility

The Codex observer accepts state-stream versions 11 and 13 and read-state event
version 3. Version 13 was verified against Codex Desktop 26.1111.2228.0: the
runtime, unread, approval requests and input-history fields consumed here retain
their existing structure. Other stream versions remain unsupported and clear
native evidence to Unknown; compatibility is not inferred from a version range.

Snapshots retain `source` (`ready`, `stale`, `unavailable`), `sample`,
`runtimeAvailable`, `unreadAvailable`, `attentionAvailable` where applicable,
and `sessions`. They also include `monitoring: { status, code }`: the current
source health, independent of individual session runtime. Status is `connecting`,
`connected`, `reconnecting`, `unavailable`, `idle` (no local sessions), or `sample`.
The code is a safe diagnostic identifier or `null`; the renderer maps it to
fixed user-facing text and never displays raw exceptions or conversation data.

The runtime publishes health changes through `onMonitoringChange`, which the
provider forwards to its existing `onChange` callback. Console diagnostics remain
deduplicated; current health can recover and report the same failure again.
Supported snapshots clear the matching stream error. A successful handshake
alone does not establish healthy monitoring until native state arrives.
An unloaded/Unknown session or a session's `systemError` is not a source failure.

Each session retains its raw `id`, `title`, `cwd`, `projectId`,
`project`, `lastActivity`, `runtime` and `unread`.

Runtime values remain `running`, `approval`, `input`, `idle`, `error`, `unknown`.
Unread is `true`, `false` or `null` when unverified. Missing evidence stays unknown;
unread or silence must not be used to infer completion. Source-specific
availability follows the existing evidence rules, including sample-mode flags.

Providers treat discovery records as read-only. Native projections create new
session records; the main process adds local `pinned` state. Codex IDs are not
prefixed, so existing pin filenames, project keys, avatar hashes, settings and
navigation behavior remain compatible.

## Future provider contributions

A future Claude provider should implement the same boundary from independently
verified sources and document which runtime, unread and navigation capabilities
it can actually support. Unsupported evidence must stay unavailable. Source
parsing and transport should remain inside that provider.

Provider selection and any source-specific UI wording would be added with that
contribution. If multiple sources are combined, introduce provider-qualified
identities and an explicit migration for existing pins; do not silently change
Codex IDs in this single-source implementation.

## Validation

- `npm test`: provider contracts and existing state/model/configuration tests.
- `npm run test:error-ui`: isolated real Electron status and resynchronization checks.
- `npm run test:avatar-ui`: sample mode, themes, identity, rendering and public-file checks.
- `npm run test:taskbar`: native badge updates through simulated provider events.
- `npm run check:local`: real read-only discovery and native monitoring for eight
  seconds, using the same provider as the application. Prints aggregate counts
  only and stops the provider on completion or failure.
