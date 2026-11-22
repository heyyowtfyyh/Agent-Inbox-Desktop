# Agent Inbox feature specification

This document defines the MVP for the standalone Windows app.

| Priority | Scope |
| --- | --- |
| P0 | Session discovery, agent status, native unread detection, main window, Open in Codex, and Open in VS Code |
| P1 | Windows system tray |
| P2 | Windows notifications, basic preferences, and usability improvements |

## P0 features

### Session discovery

Automatically discover local Codex sessions and identify each by session ID.
Show the session title, associated project, and last activity when available.
Group sessions by project and keep concurrent sessions distinct, including
sessions with the same title. Use clear placeholders for missing fields and an
unassigned group for sessions whose project is unknown. Keep identifiable
sessions with incomplete metadata available in **All sessions**.

**Acceptance criteria**

- With three identifiable local sessions across at least two projects, the app
  discovers all three automatically. **All sessions** shows their titles,
  projects, and last activity wherever available. Session IDs are available
  for manual lookup when needed.
- Two sessions with the same title remain distinct. A session missing its title,
  project, or timestamp remains visible with the missing fields indicated.

### Agent status

Track runtime status independently of native unread state. A running session
can also have an unread result. Classify runtime using the following evidence.

- **Running** means there is reliable evidence of an active agent turn.
- **Waiting for Approval** means there is reliable evidence of a pending
  approval. The prototype detects manual command approvals in the
  `codex-ipc` request list using `item/commandExecution/requestApproval`.
- **Waiting for User Input** means there is reliable evidence that the agent is
  waiting for a user response. For asynchronous native option cards, the
  prototype checks for unanswered questions in the active turn in the
  `codex-ipc` turn history.
- **Idle** means reliable evidence shows no active turn or pending request.
- **Error** means there is reliable evidence of a session or agent turn failure.
  The prototype maps the desktop stream's explicit `systemError` runtime type
  to this state. A failed command item alone does not establish this state.
  Simulated events and the Electron UI have been verified; a real Codex
  `systemError` has not yet been reproduced.
- **Unknown** means runtime evidence is missing, stale, or inconclusive. Elapsed
  time since last activity alone cannot establish another state.

The two waiting states share the **Needs attention** summary and amber styling.
Inbox cards show **User input** for pending questions and **Waiting for approval**
for pending approvals. The native **Unread** state is tracked independently.
Turn completion describes one agent turn and leaves overall task progress
unspecified.

While the stream reports an active runtime, request a current snapshot every
10 seconds and when its native read-state notification or unread value changes.
If a requested snapshot does not arrive within 5 seconds, clear the cached
runtime and unread evidence to Unknown/unavailable and retry periodically.
Reading a conversation or receiving an unread flag alone does not establish
Idle; the current runtime snapshot remains the source of truth.

**Acceptance criteria**

- Classify runtime as **Unknown** when the source is unavailable or only an
  inactivity timestamp is available. Use the card badge rules below to display
  runtime and unread evidence.
- With an asynchronous option card or manual command approval pending in a
  background chat, reconnect and verify that **User input** or **Waiting for
  approval**, respectively, is restored. Answer the question or decline the
  approval, then verify that the waiting badge clears as soon as the request
  is resolved.
- Each **Inbox** card displays exactly one status badge. Show **Running**,
  **Waiting for approval**, **User input**, or **Error** when applicable. For
  an **Idle** or **Unknown** session with verified unread activity, show
  **Unread**. The unread count and filter use the native unread state
  independently of the displayed badge.

### Native unread detection

Use Codex Desktop's native unread state as the source of truth wherever it can be
read reliably. Reflect changes made in Codex Desktop during automatic refresh.
Keep native unread records read-only and avoid a separate read-state model for
the MVP. If the schema is incompatible or the data is unavailable, indicate
that native unread status is unavailable in the summary or fallback notice. If
a future fallback infers or tracks unread state locally, label it separately
from verified native state.

**Acceptance criteria**

- With a supported native source, changing a session's unread state in Codex
  Desktop updates the matching inbox indicator automatically, without the inbox
  writing to official records.
- With missing or incompatible native data, affected sessions remain accessible
  in **All sessions**. The summary or fallback notice identifies unavailable
  data. Locally inferred or independently tracked information, if present, is
  visibly distinct from verified native state.

### Main application window

Use the dark Graphite design for the compact, resizable Windows dashboard. Keep
the **Running**, **Needs attention**, and **Unread** counts, view tabs, and
status filter above the vertically scrolling session area. Support expandable
project groups and automatic updates. Display unavailable counts as a dash.

The top-right badge reports overall monitoring health. Show green **Monitoring**
after a supported native snapshot, amber **Connecting…** or **Reconnecting…**
while establishing or recovering monitoring, and a red warning icon with
**Monitoring unavailable** for permission or compatibility failures. Explain
the current failure and next action in a full-width message between the heading
and summary counts. Remove the message automatically after recovery. Individual
Unknown or Error sessions do not establish a monitoring failure. Demo mode and
an empty local session list use neutral **Sample data** and **No local sessions**
badges. Source errors remain visible even when cached sessions are still listed.

- **Inbox** is the default view. Include sessions that are running, need
  attention, have an error that still needs attention, or have verified unread
  results. Also include pinned sessions. Each qualifying session appears once.
- **All sessions** shows the full discovered list, including Idle and Unknown
  sessions without known unread results. Use two-line rows grouped by project.
- **Recent sessions** is the Inbox fallback when live status and unread data are
  unavailable and there are no qualifying Inbox sessions. Show the most recent
  sessions in the Inbox grid and explain which data is unavailable. Use
  **Unknown** for sessions whose runtime cannot be verified.

Inbox uses borderless, transparent cards grouped by project. Use three columns
at the default width and two when space is limited. Center any partial last row.
Each card has a centered clickable avatar, a top-right **More actions** menu,
the session title, and status and last activity beneath it. The avatar's small
external-link icon identifies the Codex action. In **All sessions**, use the
visible **Open in Codex** row link. Put **Pin** or **Unpin** above **Open in
VS Code** in **More actions** in both views. Store pins locally by session ID.
Use the same project grouping, activity order, and status filters for pinned
sessions. The current pin state is indicated by the menu action. Give icon
controls descriptive accessible names, keyboard access, and tooltips.

Keep project groups in their first-discovered order for the current app window,
shared across views and filters. Append newly discovered projects; a hidden or
temporarily absent project returns to its previous position. Activity updates
only reorder sessions within each project. Project order is not saved across
app restarts.

In both views, place status badges before the last activity time. Use a spinner
for **Running** and a colored dot before each other status label. Render
**Unread** in blue. When reduced motion is enabled, keep the spinner static.

**Acceptance criteria**

- Launch the Windows app directly and view at least three concurrent Worker
  sessions in one window, with the required session fields and summary visible
  or clearly indicated when unavailable. With five eligible sessions in one
  project, the default Inbox grid shows three above two centered cards.
- A session that needs attention and has unread results appears once in Inbox.
  Idle and Unknown sessions without known unread results are available in
  **All sessions**. When live status and unread data are both unavailable and
  no sessions qualify, **Recent sessions** uses the Inbox grid and explains
  the gap.
- Expand and collapse a project group and apply a status filter. With a session
  waiting for approval or input, use the filter or status label to find it.
- Change a supported field in the local source and observe the corresponding
  session and summary counts update automatically. With more sessions than fit
  in the window, scroll the session area while the summary and controls stay
  visible.
- Simulate an unsupported protocol or database schema and verify that the
  monitoring badge and inline reason appear above the counts. Recover the source
  and verify that the warning clears; a later failure must appear again. Check
  that the message wraps without overlapping the heading at 350px width.
- Open the **Open in Codex** action and the **More actions** menu by keyboard.
  Verify that the menu exposes **Open in VS Code** for the same session.
- Pin a read, idle session in **All sessions** and verify that it appears in
  **Inbox** and survives an app restart. Unpin it from **Inbox** and verify that
  it leaves that view.

### Avatar identity and expression

Use the bundled public avatar theme in `src/avatar/open-source/`. It contains
seven shapes and three expressions per shape, for 21 SVG variants. Use a fixed,
unsigned FNV-1a hash of the UTF-8 Codex session ID. Select the shape with
`hash % 7` and color with `hash % 8` using the index order below, matching the
public manifest and shared palette. Within this theme, a session keeps its color
and shape across app restarts, title changes, view switches, and state updates.

| Index | Shape | Color |
| --- | --- | --- |
| 0 | Mallow | Blue `#1084FE` |
| 1 | Hexagon | Orange `#FF6700` |
| 2 | Triangle | Teal `#00BCA6` |
| 3 | Bloom | Red `#FF263C` |
| 4 | Squircle | Pink `#FF309B` |
| 5 | Circle | Purple `#9159FE` |
| 6 | Pebble | Amber `#FF9800` |
| 7 | — | Green `#45A738` |

The shape and color columns are indexed independently, giving 56 combinations;
the table does not bind a shape to the color on the same row. Robot is not part
of the public theme.

| Runtime | Expression | Appearance |
| --- | --- | --- |
| `running` | Running | Inward-pointing chevron eyes and a smile. |
| `approval`, `input` | Waiting | Open eyes and a small round mouth. |
| `idle`, `error`, `unknown` | Idle | Open eyes and a smile. |

All three expressions of each shape share the same body contour and centered
crop. The public artwork has no Running rays or Waiting question marks, keeping
the body prominent at both 46px in Inbox and 28px in All sessions. Unread is an
independent flag and does not change the expression. Status and unread
information remain visible as text. See [Avatar themes](AVATARS.md) for rendering
and theme configuration details.

**Acceptance criteria**

- Reopen the app or switch views for a known session. Its shape and color stay
  the same. After a verified runtime change, its expression matches the new
  state with the same shape and color.
- Verify all seven shapes in all eight colors, without fixed shape/color pairs.
- Preview all 21 shape/expression variants at 46px and 28px. Each shape keeps the
  same body contour across expressions, without rays or question marks.
- Toggle only the unread flag and verify that the avatar expression does not
  change. Error and Unknown continue to use the Idle expression.

### Open Codex session

Activate the avatar in **Inbox** or the **Open in Codex** link in **All
sessions** to open the exact conversation in the existing Codex Desktop GUI.
Prefer `codex://threads/<thread-id>` where precise navigation is verified. If
the target is unavailable or precise navigation cannot be verified, keep the
user in Agent Inbox, explain the limitation, and show the session title and ID
for manual lookup in Codex. Document the limitation for affected environments.

**Acceptance criteria**

- On the supported Windows environment, clicking **Open in Codex** reliably
  opens the selected session's exact conversation in Codex Desktop. Verify the
  selected conversation in the GUI. URI dispatch alone leaves this criterion open.
- When the target is missing or precise navigation is unsupported, show the
  limitation and provide the title and ID for manual lookup. The exact-navigation
  criterion remains open even if the fallback works.

### Open project in VS Code

Select **Open in VS Code** from a session's **More actions** menu to open its
verified working directory.
Respect Windows paths and preserve the session's Git worktree directory when
applicable. Reuse a VS Code window when appropriate. If the directory is missing,
VS Code is unavailable, or launch fails, explain the reason and show the known
path. The shortcut requires no VS Code extension or additional account linking.

**Acceptance criteria**

- Clicking **Open in VS Code** opens the intended project directory. For a Git
  worktree, verify that the editor opens the session's worktree directory.
- With a missing directory or unavailable VS Code installation, the action
  explains the limitation and makes any known path available.

Phase 1 manual testing confirmed Codex session selection and ordinary VS Code
project navigation on the tested Windows installation. Codex deep links are
enabled by default in the prototype. See the
[feasibility report](FEASIBILITY.md#phase-1-p0-整合驗證) for the current
navigation and native unread verification results.

## P1 desktop integration

- **Windows system tray.** Provide tray access to reopen the inbox.

### Windows taskbar badge

Show a native lower-right number overlay on the running app's taskbar icon.
Count unique conversations that are unread or waiting for input/approval, once
per session even when both conditions apply. Ignore the current view, filter,
pin state and project collapse state. Show 1–99, use `99+` above 99, and remove
the overlay at zero. The native description retains the exact count.

Update from runtime events and a main-process five-second metadata refresh,
including while the renderer pauses polling or the app is minimized. Use only
confirmed state; clear the overlay when the source is stale or unavailable.
Overlay failures must not make session data unavailable. Keep the fixed teal
application icon and desktop shortcut unchanged.

`npm run test:taskbar` exercises the real native API with an isolated database,
mock desktop stream and separate taskbar grouping. It verifies count changes,
deduplication, zero removal, `99+`, filter/menu independence and disconnects.
Preview badges and the verification record stay in ignored `.local/taskbar-qa/`.

## P2 and post-MVP options

- **P2.** Windows notifications, basic preferences, and usability improvements
  informed by actual use.
- **Post-MVP.** Advanced session sorting, including drag reordering.

## Architecture constraints

- Target Windows first and keep monitoring local and read-only.
- Keep official Codex session and unread state untouched. Do not read
  authentication credentials or require Codex account linking, OAuth, or API keys.
- Keep the app independent of cloud backends. Telemetry is off by default and
  session content is never uploaded automatically.
- Local storage may contain app preferences and non-sensitive cached metadata.
- Prefer a simple desktop implementation. Avoid a complex backend, a database
  service, or infrastructure the MVP does not need.

## Open feasibility questions

1. Which additional approval types and runtime failures can the Windows
   desktop stream expose reliably?
2. How does the desktop stream behave across Codex Desktop restarts, abrupt
   exits, and stream version changes?
3. Are Codex lifecycle hooks available and reliable for GUI-originated sessions?
4. How does `codex://threads/<thread-id>` behave on cold start and when multiple
   Codex Desktop windows are open?

The tested Windows prototype uses local session metadata and the internal
`codex-ipc` desktop stream. See the
[verification record](FEASIBILITY.md#phase-1-近期變更驗收) for the tested cases
and limits. Access to the running GUI's session state through a separately
launched App Server remains unverified.

## Delivery phases

1. **Phase 0 — Feasibility.** Verify metadata discovery, native unread state,
   runtime evidence, and deep-link navigation with real Codex Desktop sessions
   on Windows. Check what remains observable after a restart or source failure.
2. **Phase 1 — Minimum usable app.** Build the desktop window, session list,
   project grouping, unread indicators, and status reporting supported by the
   available evidence. Include both P0 navigation actions. A partial prototype
   can use **Unknown** for unverifiable runtime states and offer manual lookup
   when precise Codex navigation is unavailable. Exact Codex navigation remains
   an open P0 requirement until its acceptance criterion passes.
3. **Phase 2 — Desktop integration.** Add system tray access and reliability
   improvements.
4. **Phase 3 — Optional improvements.** Add notifications, preferences, and UX
   refinements based on actual use.

## Out of scope

- ChatGPT Planner integration or multi-provider support.
- Agent execution, agent orchestration, embedded conversations, or handling or
  executing approvals. Pending approvals are visible as status only.
- Cloud synchronization, account management, or a plugin architecture.
- Custom window tiling or replacing FancyZones.
- Commercial requirements or productization work beyond this project scope.
