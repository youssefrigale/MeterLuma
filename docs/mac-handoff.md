# Continue MeterLuma on Mac

**October 27 local Mac checkpoint:** this checkout has uncommitted issue-audit/provider work newer than GitHub. Preserve it; do not reset or replace it with the historical checkout commands below. The current debug bundle builds and runs, and **182 Chromium tests pass**. Native logic is unchanged since the earlier **143 native tests passed, 2 opt-in ignored** checkpoint; that suite was not rerun for the layout refinements. Connections now uses compact provider rows and expandable account/help sections; native height is 476 points closed, 795 with account setup open, and 476 after closing. All three provider actions and the footer fit in the compact view. Overview cards now collapse independently; native testing confirmed automatic height of 418 → 326 → 418 logical pixels with meters/footer retained and both cards restored expanded. Layout-only restore/Undo has browser coverage; native Settings was checked only in its default disabled state. The [notification guide](notifications.md) and [issue audit](openusage-issue-audit.md) record the 42 extra integrations, two tracking-unavailable providers and remaining feature/live/platform gaps. Native notification status remains NotDetermined/default off; no OS authorization or banner delivery was exercised. No new connection or system-login setting was enabled. Provider groups now support saved drag/keyboard reordering; the new sidebar-height regression also passes in the 25 focused follow-up checks. Core logo frames are removed, Codex renders without scale enlargement, Antigravity uses a crisp vector variant and Warp uses a 196-pixel source. Additional providers use compact logo rows with checkbox-style controls; current native inspection of that follow-up timed out, while browser checks passed in both themes. The rebuilt app is installed at `~/Applications/MeterLuma.app`. These local changes have not been pushed or released.

**Settings-height follow-up:** Mac Settings now requests 850 logical pixels and scrolls internally, with native display-area clamping and a pinned footer. All other Mac pages retain content-based height; Windows retains its fixed panel behavior. Native screenshots confirmed 360 × 850 before and after scrolling. The frontend/Mac debug build and 40 focused UI checks pass; the 182-test full suite and 25 focused follow-up checks include this behavior. No connection or system preference was changed.

Windows checkpoint: [2026-10-25](windows-qa-2026-10-25.md), version 0.1.2. Continue on branch `restore-provider-logos` in `youssefrigale/MeterLuma`. Recent changes add automatic local-provider discovery, fix cancellation of a scheduled rate-limit retry, keep the panel size stable across pages and simplify the Costs layout. The checkpoint distinguishes completed Windows tests from optional live-token, tool-blocked and hardware-dependent checks.

## Get the code

On October 26 the owner deleted the old GitHub repository, and a new private repository was created at the same `youssefrigale/MeterLuma` URL. Both `main` and `restore-provider-logos` contain the latest app. Old pull requests were not migrated. Use a fresh clone when continuing on Mac; keep any local work from an older checkout separately and do not push its old branches or history. GitHub Actions is disabled in the replacement while the allowance is exhausted.

Git history was rewritten on October 26 to remove AI co-author trailers. For an older checkout, save any uncommitted work and local commits first, then use `git fetch origin` and `git reset --hard origin/restore-provider-logos` on that branch, or make a fresh clone. Do not merge the old history back. The normal fast-forward commands below apply to checkouts made after the rewrite.

The latest Codex page also shows subscription details from the existing CLI quota lookup. Verify plan formatting, credits, available resets, missing fields, cached labels and the expanded section on Mac; older snapshot files must still load.

Claude now explicitly labels its subscription status unavailable. Local history does not detect paused billing; verify the notice on Mac without treating it as live account-status support.

In an existing checkout, save any local Mac work before updating:

```sh
git fetch origin
git switch restore-provider-logos
git pull --ff-only
npm ci
```

For a new checkout:

```sh
git clone --branch restore-provider-logos https://github.com/youssefrigale/MeterLuma.git
cd MeterLuma
npm ci
```

Use Node.js 22.22 or newer, stable Rust, and the Xcode command-line tools. See the [development prerequisites](development.md).

## Build and check locally

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:dev
```

The panel starts hidden in the menu bar. For a local DMG for this Mac's architecture:

```sh
npm run desktop:build -- --bundles dmg
```

For browser checks, install the engines once, then run the suites sequentially:

```sh
npx playwright install chromium webkit
npm test -- --output=test-results/chromium
npm run test:webkit -- --output=test-results/webkit
npm run test:release -- --output=test-results/release
```

Run `npm run build` before the release UI suite. The project supports a universal Mac build; see [release-process.md](release-process.md) for release targets and signing. This handoff is a development checkpoint, not a published release.

## First Mac work

- Start with the default local workflow: after privacy revision 6 consent, Claude Code history, the signed-in Codex CLI and the Cursor desktop profile should appear automatically without a MeterLuma login or token entry. Test startup from Finder, detection after Refresh, missing/expired local sign-ins, explicit disconnect persistence, hidden providers and paused custom profiles. Verify the Cursor default-profile Keychain fallback. Claude remains history-only until live usage is explicitly enabled in Connections (privacy revision 7). Verify Session/Weekly values and retained local history after enabling; old revision-6 consent alone must never authorize credential access.
- Compile and exercise the new macOS Keychain account-token path in `src-tauri/src/providers/tokens.rs`. Windows checks cannot verify this native code. Test saving, replacement, restart, disconnect, access denial and a locked Keychain without exposing tokens in screenshots or logs.
- Verify Codex external-token quotas using an up-to-date official CLI, including when MeterLuma starts from Finder. Token mode uses a separate temporary Codex home and must never fall back to local sign-ins or history. Expired tokens need replacement inside MeterLuma.
- Verify Cursor account-token limits and its Unofficial disclosures. Successful real manual-token QA remains pending on both platforms; previous Windows local-sign-in checks covered a separate path.
- Check menu-bar placement on multiple displays, full-screen Spaces, an auto-hidden menu bar, scale changes and physical sleep/wake. Test on macOS 13 or later, with Apple silicon and Intel coverage where available.
- Retain the approved Levels Clean graphite logo, no focus outlines, hidden provider/Costs icons before selecting a provider, and the footer with version left and next update minutes right. `AGENTS.md` records owner decisions.

Account-token connections above are optional advanced functionality; they are not the default onboarding workflow. Claude live usage is enabled separately in Connections. On macOS, expired access is renewed automatically by the installed official native Claude Code CLI in a private empty workspace, with no prompt or workspace-trust acceptance. Claude Code owns credential rotation and storage. Do not collect Claude.ai browser session credentials. Windows builds remain intentionally unsigned; that policy does not waive macOS release signing/notarization requirements.

## What is included

Source, lockfiles, regenerated native icons, logo exploration, third-party notices, tests, release workflow changes and project memory are committed. Private Windows installers, backups, WebView profiles, local QA reports, toolchains and provider credentials are excluded. The private evidence paths in the documentation refer to the Windows machine, so their files will not appear after cloning.

Latest Windows follow-up passed 28 focused Chromium checks, 14 focused WebKit checks, three production UI checks and 11 native checks. Earlier 0.1.2 checks passed 77 native unit tests, with two local-data checks ignored, and the Rust/npm production audits reported zero vulnerabilities at that checkpoint. These results do not establish Mac readiness; see [launch.md](launch.md) and [beta-testing.md](beta-testing.md).

GitHub Actions minutes are exhausted until the recorded November 1 reset. Use local Mac builds and tests for now; do not manually trigger native CI or publish/tag a release as part of this handoff.
