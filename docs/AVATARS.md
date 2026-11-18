# Avatar themes

## Selection

Use the **Avatar** menu at the top right of the window. **Personal (auto)** uses
the complete local personal theme; **Open source** uses the bundled public
avatars. Changes apply immediately to session avatars,
without restarting, while keeping the current view, filter and collapsed groups.
The menu supports native keyboard selection and fits the 350px minimum window.

The choice is saved as `avatar-preference.json` in Electron's local `userData`
directory, outside the repository. It is restored at the next launch and takes
precedence over the `.env` or process startup default. A failed preference write
leaves the previous theme active and displays a retry message.

With no saved choice, `AVATAR_THEME` supplies the startup default; process values
take precedence over `.env`. The default is `auto`.

| Value | Behavior |
| --- | --- |
| `auto` | Use the complete local personal theme when present; otherwise use open-source. |
| `open-source` | Always use the bundled open-source session avatars. |

Available themes are checked at startup. A missing, unreadable or incomplete local
theme falls back as a whole and logs an `[avatar]` diagnostic. The menu then shows
only **Open source**, with selection disabled. Restart after adding or replacing
local theme resources. Themes are never mixed file by file. Runtime status,
unread state and monitoring are independent of this setting.

The application identity always uses the teal Running Pebble, including the
window header and Windows taskbar. It stays the same when session avatars use
the personal theme. Windows receives a content-versioned ICO path in local
`userData/icons/` to avoid reusing a cached icon after the artwork changes.

## Files and rendering

- `src/avatar/index.js`: stable session identity, expression mapping and DOM rendering.
- `src/avatar/theme.js`: main-process selection and complete-resource checks.
- `src/avatar/preferences.js`: local preference persistence and available-theme asset lookup.
- `src/avatar/open-source/`: public manifest, stylesheet, 21 tintable SVG variants,
  and PNG/ICO application icons derived from the Running Pebble in teal (`#00BCA6`).
- `.local/avatar/personal/`: ignored local manifest, stylesheet, original layered
  SVGs and application icons. Back this directory up separately; Git does not
  retain it in future snapshots.

The private theme has `manifest.json`, `theme.css`, `app-icon.png`, `app-icon.ico`,
one `shape-<name>.svg` per shape, and `face-working.svg`, `face-waiting.svg` plus
the neutral faces referenced by the manifest. Its manifest uses version `1`,
render mode `layered`, an ordered `shapes` array and a `neutralFaces` mapping.
The local theme is data and assets; no private JavaScript is executed.

The renderer uses theme-specific application URLs, so live switching does not
reuse another theme's cached stylesheet or icons. Only validated theme files are
served; local filesystem paths stay in the main process. The public theme keeps
the approved body and face paths, with a shared body-centered crop for each
shape's three expressions. Removing the Running rays and Waiting question marks
allows the body to occupy about 95% of its 46px or 28px slot along its longest
dimension, instead of reserving space above it. Personal layered sizing and its
narrow Waiting-face offset retain the original behavior.

The public shapes are Squircle, Pebble, Bloom, Mallow, Triangle, Hexagon and
Circle; Robot has been removed. Both themes use the existing session-ID hash:
shape index modulo seven and color index modulo eight. All 56 shape/color pairs
are available, and identity remains stable across state and unread changes.
Session colors retain the original eight-color order. Removing Robot can change
the open-source shape assigned to an existing session; personal assignments are
unchanged.

Public SVG bodies use `currentColor` while faces keep their dark paint. The image
URL carries the selected palette color; the main process validates it against
the eight allowed colors and applies it to the SVG's root color. This adds no
new user-facing mode or setting. The application icon remains the teal Running
Pebble without rays; it is independent of session avatar colors and the native number overlay.

| Runtime | Expression |
| --- | --- |
| `running` | Running |
| `approval`, `input` | Waiting |
| `idle`, `error`, `unknown` | Idle |

Unread is an independent flag and does not change the expression. Existing
status badges remain the primary status indication.

## Verification and future distribution

Run `npm test` for state mapping, configuration and whole-theme fallback checks.
Run `npm run test:avatar-ui` for hidden Electron checks of `auto` and
`open-source`, live switching, preference restoration in a separate process,
both list views and every shape/expression at 46px and 28px. It also checks a
350px window and a source copy without personal assets, using temporary profiles.
The public color matrix covers all 56 pairs at both sizes, with actual pixel
checks for each of its 112 previews and protocol checks for all three expressions.
Screenshots are saved to the ignored `.local/avatar-qa/` directory. The UI check
also runs `npm pack --dry-run --json --ignore-scripts` to verify that the public
file list contains all 21 avatar SVGs and excludes Robot, local settings and personal assets.
It does not create an archive or publish anything.

The package file allowlist excludes `.local/`. Removing the original private
asset paths from the current source tree does not erase them from existing Git
history. A future public repository must start from a reviewed clean export,
without copying this repository's `.git` directory. Public repository creation
and licensing remain separate release steps.
