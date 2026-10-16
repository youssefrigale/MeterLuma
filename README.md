# MeterLuma

All your AI usage, one glance. A tray and menu-bar tracker for macOS and Windows, free for personal, noncommercial use only. Selling and redistribution are prohibited; see [LICENSE](LICENSE).

MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor). Claude, Codex and Cursor are trademarks of their respective owners. Their official logos appear unmodified, only to identify each service, and their owners keep all rights in them (see [src/assets/providers/README.md](src/assets/providers/README.md)).

## Current status

This is an internal pre-release of version 0.1.0 with the unreleased changes listed in [CHANGELOG.md](CHANGELOG.md). It is not a public release: builds are unsigned, and macOS and installer testing are still outstanding (see [Current verification](#current-verification--2026-10-15)).

- **Claude Code**: recorded token history from local Claude Code logs only. No quotas or alerts. MeterLuma does not read Claude credentials and never contacts Anthropic (Claude's Status and Usage dashboard buttons only open Anthropic's public pages in your browser when you click them).
- **Codex**: quotas through the installed Codex CLI's app-server, plus recorded token history from local Codex session logs.
- **Cursor (Unofficial)**: the monthly allowance, read with Cursor's existing local sign-in from an undocumented Cursor endpoint. No token history.
- Free for personal use: 30/90/365-day recorded history and trends, multiple local account profiles, in-app quota alerts, and CSV/JSON exports. There is no paid edition or checkout.

Release builds use real data only. Sample data and demo controls exist only in development previews and are never mixed with live data.

## Features

The main interface is a compact tray popup, 360 logical pixels wide and up to 660 tall, with a vertical icon sidebar: overview, each provider, costs, connections, help and settings. It is MeterLuma's only window; there is no separate dashboard. The popup starts hidden in the tray, and clicking outside hides it. On Windows it docks to the taskbar edge you clicked, including auto-hidden taskbars. On macOS it opens below the menu bar of the display you clicked and also over full-screen apps.

- **Provider pages** show allowance bars and reset times (Codex and Cursor), compact usage rows, an inline token trend and the top five recorded models. Extra limits, models and data notes expand on demand. A cached quota is labeled with its original fetch time.
- **History** covers 30, 90 or 365 days, shown on each provider's page as a token trend and model shares. Days before the first recorded day are shown as hatched **Not recorded** bars, not as zero, and totals read "Since <date>" when the logs are shorter than the window.
- **Estimated API value**: recorded Claude tokens are valued at Anthropic's standard list prices, checked 2026-10-15 against the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing). Fast mode is valued at its published 2x rate on Opus 5.5 ($8/$40 per million input/output tokens), Opus 5 and Opus 4.8 ($10/$50). Tokens from models without a known price are left out and counted ("Excludes N tokens from models without a known price"). These estimates are not bills or subscription charges. Codex usage has no dollar estimate, and actual billed spending is not available.
- **Settings**: refresh every 5, 15, 30 or 60 minutes; Left or Used bars; relative or absolute reset timers; clock format; theme (follows the system by default, with Light and Dark overrides); provider visibility and order; the history window, CSV and JSON exports, and usage alerts. **Reset preferences** in Help keeps connections, local accounts, alerts and license acceptance.
- Interface icons use Remix Icon 4.9.0. The MeterLuma monogram is original artwork. Provider logos are the owners' official files: Anthropic's Claude Spark, OpenAI's Blossom and Cursor's cube.
- The tray menu shows the app version, **Open MeterLuma** and **Quit MeterLuma**.
- Provider buttons open fixed official status and usage pages in the default browser.

Not implemented: startup at login, global shortcuts, push notifications, account-wide billing, Cursor token history, and PAC/WPAD proxy scripts. An automatic updater exists as an optional build feature, but no current build has one configured (see [docs/release-process.md](docs/release-process.md)).

## Connections

In the desktop app, open **Connections**, choose **Connect** for a provider, then **Use local profile**. The browser preview cannot read local profiles or fetch live limits.

- **Claude Code**: reads `projects/` under `~/.claude` or `CLAUDE_CONFIG_DIR`, or under a profile folder you add. Only token counts, model names, dates and message identifiers are kept, in memory. MeterLuma never reads `.credentials.json`, the macOS Keychain or Claude Desktop, and makes no requests to Anthropic. Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`), so older days usually show as Not recorded.
- **Codex**: reads `sessions/` and `archived_sessions/` under `~/.codex` or `CODEX_HOME`. Quotas come from running `codex app-server --listen stdio://` with the `codex` executable found on the PATH or in common install locations (npm, nvm, fnm, Volta, bun, pnpm and Homebrew folders, among others). For npm-style installs MeterLuma runs the native binary from the Codex platform package, not the Node shim, so Node does not need to be on the PATH (for example when the app is started from Finder or the Dock). It sends only `initialize`, the `initialized` notification and `account/rateLimits/read`, never uses a shell, and stops the process after each lookup (20 s limit, 1 MiB output cap). Both windows share one successful lookup for just under 5 minutes. Sign in with the Codex CLI itself; MeterLuma does not read or copy Codex tokens.
- **Cursor (Unofficial)**: reads `cursorAuth/accessToken` read-only from `Cursor/User/globalStorage/state.vscdb`; on macOS the default profile falls back to the Keychain item `cursor-access-token`. It calls `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` with the User-Agent `MeterLuma/<version>`. This undocumented endpoint is not endorsed by Cursor and may change or stop working without notice. Requests verify TLS against the operating system's certificates plus bundled roots, follow no redirects, time out after 15 s and cap responses at 1 MiB. Proxy environment variables take precedence over the Windows or macOS manual proxy. A successful result is reused for 5 minutes, and the last good snapshot can be shown as cached for up to 24 hours. HTTP 429 starts a cooldown from Retry-After (30 s to 6 h) that applies only to that sign-in. MeterLuma never renews or writes Cursor credentials.

Add up to twelve more profiles in **Connections → Multiple local accounts**. Each folder must be inside your home folder: Claude needs `projects/`, Codex needs `auth.json`, `sessions/` or `archived_sessions/`, and Cursor needs `User/globalStorage/state.vscdb`. Profiles are labels and folders, not verified account identities; logs include every sign-in recorded there.

Per profile, the history reader keeps the 2,000 most recently modified log files in the selected period. It also examines at most 8 GiB, 5,000 folders, 16 folder levels and 200,000 files, skips lines over 8 MiB and keeps at most 100,000 unique records. Exceeding a limit or an unreadable file marks the result as partial. Results are cached for 60 seconds, and unchanged files reuse their in-memory extraction.

**Alerts**: up to twelve threshold rules in **Settings → Custom usage alerts**, for Codex and Cursor. They appear inside MeterLuma while it runs and use only quotas fetched within the last 10 minutes, or the refresh interval plus 2 minutes if that is longer. Cached, rate-limited and sample values never trigger alerts. Dismissals persist across windows and restarts.

**Exports**: in **Activity**, export CSV or JSON through the system save dialog. JSON (format version 2) includes the app version, each provider's quota type (`none`, `official` or `unofficial`), `coverageStart`, and per-day `recorded` and `unpricedTokens`. CSV columns are `mode, provider, account, date, recorded, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, total_tokens, unpriced_tokens, estimated_api_value_usd, partial, scope`. Unrecorded days have `recorded=false` and empty values. Exports omit paths, credentials and conversation content, and CSV labels are protected against spreadsheet formula interpretation.

Settings and license acknowledgement stay in WebView local storage under `meterluma.settings.v2`; credentials are never copied there. There are no analytics, external fonts, billing or account-sync servers. Read the [privacy information](PRIVACY.md), [third-party notices](THIRD_PARTY_NOTICES.txt) and the [legal issue review](docs/legal-review.md).

## Develop

Requires Node.js 22.22 or newer. Install dependencies, then start the browser preview at http://127.0.0.1:1420:

```powershell
npm ci
npm run dev
```

Build and test:

```powershell
npm run build
npx playwright install chromium webkit
npm test               # Chromium, dev server on port 1431 (METERLUMA_TEST_PORT)
npm run test:webkit    # WebKit, closer to the Mac renderer; port 1432 (METERLUMA_WEBKIT_TEST_PORT)
npm run test:release   # serves the built dist/ on port 1422 (METERLUMA_RELEASE_TEST_PORT); run npm run build first
```

For the desktop app, install stable Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows, install the Visual Studio Build Tools with the C++ workload (MSVC and the Windows SDK); CI and releases use the `x86_64-pc-windows-msvc` target. On macOS, install the Xcode command-line tools.

```powershell
npm run desktop:dev
npm run desktop:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --features updater
```

Releases are built only by `.github/workflows/release.yml` from a tagged, clean commit; follow [docs/release-process.md](docs/release-process.md). `npm run release:verify -- vX.Y.Z` runs the same tag, version and clean-tree check locally. CI bundles named `MeterLuma-<platform>-ci-unsigned` and local builds are for testing only, not for distribution.

To regenerate the third-party notices after a dependency change:

```sh
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --locked --all-features > .tools/dependency-metadata.json
python scripts/generate-notices.py --fetch-upstream
node .github/scripts/release-meta.mjs notices
```

In Windows PowerShell 5.1, `>` writes UTF-16; use `cargo metadata ... | Out-File -Encoding utf8 .tools/dependency-metadata.json` instead.

## Structure

- `src/`: React interface (the tray panel), local preferences, alerts, exports and the development-only sample model.
- `src-tauri/`: Rust desktop shell: tray and panel placement, local history readers and pricing, the Codex app-server client, the Cursor request, profile validation, the export save dialog and the optional updater.
- `tests/`, `tests-release/`: Chromium/WebKit behavior checks and release-build checks.
- `scripts/generate-notices.py`, `scripts/license-sources.json`, `licenses/`: third-party notice generation.
- `.github/workflows/checks.yml`: release metadata and interface tests on pushes to `main` and pull requests. The native Windows and macOS jobs run only when started by hand.
- `.github/workflows/release.yml`: tagged release builds, with signing, notarization and the updater applied only when their secrets exist, and a draft GitHub release.
- `docs/release-process.md`: the owner's release runbook (keys, signing, hosting, tagging).
- `docs/launch.md`: requirements for a worldwide release. `docs/beta-testing.md`: how to test the current build. `docs/legal-review.md`: legal issue review.

## Ownership and publishing

Copyright holder: Youssef Rigale, Morocco (`youssefrigale`). MeterLuma uses the custom [MeterLuma Personal Use License 1.1](LICENSE): individuals may use it for personal, noncommercial purposes and, if source is supplied by the owner, inspect, build, and modify it privately for that purpose. Commercial, business, professional, and organizational use is prohibited. Selling, sharing copies, mirroring, repackaging, and redistributing source, binaries, or modified versions are prohibited. Share the owner's official link instead of copies. Third-party components and provider marks retain their own licenses and rights.

This is proprietary software, free for personal use. Do not describe it as open source. These are custom terms prepared for owner review, not a guarantee of enforceability in every jurisdiction; obtain qualified legal review before public distribution. The intended support contact is support@meterluma.com; domain ownership and mailbox operation remain unverified.

GitHub home: `youssefrigale/MeterLuma`. Keep the source repository private while strict no-redistribution is the requirement. [GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users) grant users rights to view and fork public repositories; a project license cannot remove those platform grants. Public source hosting needs a separate owner decision about that exception. Publishing official binaries for personal use does not require making the source public.

## Current verification — 2026-10-15

Branch `release-readiness` at commit `1b4c9c1`, on Windows 11. The previous beta snapshot was `0a41dfb`.

Verified:

- `npm run build` passed. `npm audit --omit=dev` reported 0 vulnerabilities (not a full security audit or a Rust advisory audit).
- Chromium Playwright: 110 of 110 passed, and the two tests added afterwards also pass. WebKit: 55 of 55. Release-build tests: 3 of 3.
- Rust library tests: 72 passed and 2 opt-in tests ignored, on both the GNU/LLVM toolchain and MSVC (Visual Studio Build Tools 2026). Clippy is clean, and the `updater` feature compiles.
- An unsigned MSVC NSIS installer was built locally from the final commit of this change set: `artifacts/releases/windows-beta-2026-10-15-msvc/`, with `BUILD-INFO.json` (exact commit) and `SHA256SUMS.txt`.
- The new Claude history scanner, run over 30 days of real local logs, counted 2,758,861,836 tokens in 13,005 records. An independent count gave 2,757,663,687 tokens in 13,002 records, a difference of about 0.04% (1,198,149 tokens and 3 records, most likely messages written between the two runs). The previous scanner undercounted by about 4.5% (433 messages missed in 31 days). The logs only went back to 2026-09-18, because Claude Code deletes transcripts after 30 days by default.
- The dev-server watcher fix cut cold page loads from about 36 s to about 0.2 s.
- The price table matched Anthropic's pricing page on 2026-10-15.
- THIRD_PARTY_NOTICES.txt was regenerated for the current lockfiles: 536 components, no unresolved notices, and `node .github/scripts/release-meta.mjs notices` passes.

Not verified:

- No GitHub Actions run of this code. The private repository's Actions minutes for October are used up, jobs are blocked (not billed) by the $0 budget, and the allowance resets on November 1. The native Windows and macOS CI jobs now run only on manual dispatch.
- No macOS build and no test on Mac hardware. The macOS-only code paths have never been compiled for macOS; only their platform-independent helpers are unit-tested on Windows.
- No installer install or uninstall test, including the delete-app-data option.
- No signing, notarization or updater keys. These are owner actions, described in [docs/release-process.md](docs/release-process.md).
- No real Cursor sign-in exists on this machine, so Cursor quotas were not checked against the live endpoint.
- Tray clicks, multi-monitor and DPI placement, and auto-hidden taskbars were not exercised by hand; the placement logic is covered by unit tests only.
- The screenshots in `artifacts/` predate these changes. They show the removed Claude quotas and older logo files, so replace them before any public use.

An earlier checkpoint (2026-10-13, Actions run 38484310114, commit `78236fd`) tested a build that still had direct Claude quota requests. It does not describe this build.
