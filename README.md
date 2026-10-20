# MeterLuma

All your AI usage, one glance. A tray and menu-bar tracker for macOS and Windows, free for personal, noncommercial use only. Selling and redistribution are prohibited; see [LICENSE](LICENSE).

MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor). Claude, Codex and Cursor are trademarks of their respective owners. Their official logos appear unmodified, only to identify each service, and their owners keep all rights in them (see [src/assets/providers/README.md](src/assets/providers/README.md)).

## Current status

This is an internal pre-release of version 0.1.2 with the unreleased changes listed in [CHANGELOG.md](CHANGELOG.md). Windows releases will be unsigned by the owner's decision of 2026-10-20; Windows code signing is not a launch requirement. Public release still needs the remaining functional QA and release-workflow validation; macOS also needs its platform checks (see [Windows QA checkpoint](#windows-qa-checkpoint--2026-10-20) and [earlier verification](#current-verification--2026-10-15)).

- **Claude Code**: recorded token history from local Claude Code logs only. No quotas or alerts. MeterLuma does not read Claude credentials and never contacts Anthropic (Claude's Status and Usage dashboard buttons only open Anthropic's public pages in your browser when you click them).
- **Codex**: subscription limits using a supplied ChatGPT account access token through the official Codex CLI. Local quota/history profiles are an explicit optional connection.
- **Cursor (Unofficial)**: monthly allowance using a supplied Cursor account access token and an undocumented Cursor endpoint. An optional local-sign-in connection remains available. No token history.
- Free for personal use: 30/90/365-day recorded history and trends, multiple local account profiles, in-app quota alerts, and CSV/JSON exports. There is no paid edition or checkout.

Release builds use real data only. Sample data and demo controls exist only in development previews and are never mixed with live data.

## Features

The main interface is a compact tray popup, 360 logical pixels wide and up to 660 tall, with a vertical icon sidebar: overview, each provider, costs, connections, help and settings. It is MeterLuma's only window; there is no separate dashboard. The popup starts hidden in the tray, and clicking outside hides it. On Windows it docks to the taskbar edge you clicked, including auto-hidden taskbars. On macOS it opens below the menu bar of the display you clicked and also over full-screen apps.

- **Provider pages** show allowance bars and reset times (Codex and Cursor), compact usage rows, an inline token trend and the top five recorded models. Extra limits, models and data notes expand on demand. A cached quota is labeled with its original fetch time.
- **History** covers 30, 90 or 365 days, shown on each provider's page as a token trend and model shares. Days before the first recorded day are shown as hatched **Not recorded** bars, not as zero, and totals read "Since <date>" when the logs are shorter than the window.
- **Estimated API value**: recorded Claude tokens are valued at Anthropic's standard list prices, checked 2026-10-15 against the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing). Fast mode is valued at its published 2x rate on Opus 5.5 ($8/$40 per million input/output tokens), Opus 5 and Opus 4.8 ($10/$50). Tokens from models without a known price are left out and counted ("Excludes N tokens from models without a known price"). These estimates are not bills or subscription charges. Codex usage has no dollar estimate, and actual billed spending is not available.
- **Settings**: refresh every 5, 15, 30 or 60 minutes; Left or Used bars; relative or absolute reset timers; clock format; theme (follows the system by default, with Light and Dark overrides); provider visibility and order; the history window, CSV and JSON exports, and usage alerts. **Reset preferences** in Help keeps connections, local accounts, alerts and license acceptance.
- Interface icons use Remix Icon 4.9.0. The Levels Clean meter logo is original artwork. Provider logos are the owners' official files: Anthropic's Claude Spark, OpenAI's Blossom and Cursor's cube.
- The tray menu shows the app version, **Open MeterLuma** and **Quit MeterLuma**.
- Provider buttons open fixed official status and usage pages in the default browser.

Not implemented: startup at login, global shortcuts, push notifications, account-wide billing, Cursor token history, and PAC/WPAD proxy scripts. An automatic updater exists as an optional build feature, but no current build has one configured (see [docs/release-process.md](docs/release-process.md)).

## Connections

In the desktop app, open **Connections**, choose **Connect Codex** or **Connect Cursor**, enter an account access token, then **Connect with token**. Codex requires an up-to-date official CLI; its account ID is detected from the token when available or can be supplied separately. API keys, refresh tokens and browser cookies are unsupported. Tokens are saved only after a successful lookup, using Windows user-bound DPAPI encryption or macOS Keychain, and can be replaced or removed in Connections. Expired tokens require replacement. Never paste tokens into chat or support reports.

Token connections do not read local provider sign-ins or history, and never fall back to them. Codex uses the CLI's experimental external-token authentication over stdin in an isolated temporary profile and asks only for subscription limits. Claude supports local history only; Claude.ai session tokens are unsupported. The upgrade pauses old local connections, retains their folder labels and asks for privacy revision 5 consent.

Choose **Use local profile** explicitly for the following optional behavior. The browser preview cannot save tokens, read local profiles or fetch live limits.

- **Claude Code**: reads `projects/` under `~/.claude` or `CLAUDE_CONFIG_DIR`, or under a profile folder you add. Only token counts, model names, dates and message identifiers are kept, in memory. MeterLuma never reads `.credentials.json`, the macOS Keychain or Claude Desktop, and makes no requests to Anthropic. Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`), so older days usually show as Not recorded.
- **Codex**: reads `sessions/` and `archived_sessions/` under `~/.codex` or `CODEX_HOME`. Quotas come from running `codex app-server --listen stdio://` with the `codex` executable found on the PATH or in common install locations (npm, nvm, fnm, Volta, bun, pnpm and Homebrew folders, among others). For npm-style installs MeterLuma runs the native binary from the Codex platform package, not the Node shim, so Node does not need to be on the PATH (for example when the app is started from Finder or the Dock). It sends only `initialize`, the `initialized` notification and `account/rateLimits/read`, never uses a shell, and stops the process after each lookup (20 s limit, 1 MiB output cap). Both windows share one successful lookup for just under 5 minutes. In this optional local mode, sign in with the Codex CLI itself; MeterLuma does not read or copy that local sign-in.
- **Cursor (Unofficial)**: reads `cursorAuth/accessToken` read-only from `Cursor/User/globalStorage/state.vscdb`; on macOS the default profile falls back to the Keychain item `cursor-access-token`. It calls `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` with the User-Agent `MeterLuma/<version>`. This undocumented endpoint is not endorsed by Cursor and may change or stop working without notice. Requests verify TLS against the operating system's certificates plus bundled roots, follow no redirects, time out after 15 s and cap responses at 1 MiB. Proxy environment variables take precedence over the Windows or macOS manual proxy. A successful result is reused for 5 minutes, and the last good snapshot can be shown as cached for up to 24 hours. HTTP 429 starts a cooldown from Retry-After (30 s to 6 h) that applies only to that sign-in. MeterLuma never renews or writes Cursor credentials.

Add up to twelve more profiles in **Connections → Multiple local accounts**. Each folder must be inside your home folder: Claude needs `projects/`, Codex needs `auth.json`, `sessions/` or `archived_sessions/`, and Cursor needs `User/globalStorage/state.vscdb`. Profiles are labels and folders, not verified account identities; logs include every sign-in recorded there.

Per profile, the history reader keeps the 2,000 most recently modified log files in the selected period. It also examines at most 8 GiB, 5,000 folders, 16 folder levels and 200,000 files, skips lines over 8 MiB and keeps at most 100,000 unique records. Exceeding a limit or an unreadable file marks the result as partial. Results are cached for 60 seconds, and unchanged files reuse their in-memory extraction.

**Alerts**: up to twelve threshold rules in **Settings → Custom usage alerts**, for Codex and Cursor. They appear inside MeterLuma while it runs and use only quotas fetched within the last 10 minutes, or the refresh interval plus 2 minutes if that is longer. Cached, rate-limited and sample values never trigger alerts. Dismissals persist across windows and restarts.

**Exports**: in **Activity**, export CSV or JSON through the system save dialog. JSON (format version 2) includes the app version, each provider's quota type (`none`, `official` or `unofficial`), `coverageStart`, and per-day `recorded` and `unpricedTokens`. CSV columns are `mode, provider, account, date, recorded, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, total_tokens, unpriced_tokens, estimated_api_value_usd, partial, scope`. Unrecorded days have `recorded=false` and empty values. Exports omit paths, credentials and conversation content, and CSV labels are protected against spreadsheet formula interpretation.

Settings and license acknowledgement stay in WebView local storage under `meterluma.settings.v2`; credentials are never copied there. There are no analytics, external fonts, billing or account-sync servers. Read the [privacy information](PRIVACY.md), [third-party notices](THIRD_PARTY_NOTICES.txt) and the [legal issue review](docs/legal-review.md).

## Develop

Continuing on a Mac: see [the Mac handoff](docs/mac-handoff.md) for the branch, build commands and remaining native QA.

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
python scripts/generate-notices.py --fetch-upstream
node .github/scripts/release-meta.mjs notices
```

The generator runs locked Cargo metadata with all features itself and creates its notice cache as needed. It does not require a precomputed `.tools/dependency-metadata.json`. Use `--metadata <path>` to supply an existing metadata JSON file, or `--cache-dir <path>` to choose another cache. Missing notices make it exit with an error. The release workflow regenerates notices and rejects any difference from the committed file.

## Structure

The approved Levels Clean logo lives in `public/mark.svg`. Run `npm run icons` to regenerate the native app, tray and installer icon assets in `src-tauri/icons/`.

- `src/`: React interface (the tray panel), local preferences, alerts, exports and the development-only sample model.
- `src-tauri/`: Rust desktop shell: tray and panel placement, local history readers and pricing, the Codex app-server client, the Cursor request, profile validation, the export save dialog and the optional updater.
- `tests/`, `tests-release/`: Chromium/WebKit behavior checks and release-build checks.
- `scripts/generate-notices.py`, `scripts/license-sources.json`, `licenses/`: third-party notice generation.
- `.github/workflows/checks.yml`: release metadata and interface tests on pushes to `main` and pull requests. The native Windows and macOS jobs run only when started by hand.
- `.github/workflows/release.yml`: tagged release builds, with Windows signing disabled by policy, macOS signing/notarization and the updater applied only when their secrets exist, and a draft GitHub release.
- `docs/release-process.md`: the owner's release runbook (keys, signing, hosting, tagging).
- `docs/launch.md`: requirements for a worldwide release. `docs/beta-testing.md`: how to test the current build. `docs/legal-review.md`: legal issue review.

## Ownership and publishing

Copyright holder: Youssef Rigale, Morocco (`youssefrigale`). MeterLuma uses the custom [MeterLuma Personal Use License 1.1](LICENSE): individuals may use it for personal, noncommercial purposes and, if source is supplied by the owner, inspect, build, and modify it privately for that purpose. Commercial, business, professional, and organizational use is prohibited. Selling, sharing copies, mirroring, repackaging, and redistributing source, binaries, or modified versions are prohibited. Share the owner's official link instead of copies. Third-party components and provider marks retain their own licenses and rights.

This is proprietary software, free for personal use. Do not describe it as open source. These are custom terms prepared for owner review, not a guarantee of enforceability in every jurisdiction; obtain qualified legal review before public distribution. The intended support contact is support@meterluma.com; domain ownership and mailbox operation remain unverified.

GitHub home: `youssefrigale/MeterLuma`. Keep the source repository private while strict no-redistribution is the requirement. [GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users) grant users rights to view and fork public repositories; a project license cannot remove those platform grants. Public source hosting needs a separate owner decision about that exception. Publishing official binaries for personal use does not require making the source public.

## Windows QA checkpoint — 2026-10-20

Tested source commit `fbdc919d6a7eabc2ec76d0043d288c55d3c35372` on Windows 11 Pro x64, OS build `10.0.26300.0`, with WebView2 `155.0.4283.62` already installed. A new unsigned MSVC NSIS installer was built from that clean commit with locked dependencies. Local evidence, exports and screenshots are private and gitignored under `artifacts/local/windows-qa-2026-10-20/`; `BUILD-INFO.json` identifies the installer and source. This local QA build is not a public distribution.

Verified:

- Fresh per-user installation into a path containing spaces, application registration, and the first-run consent gate.
- Installation of the current build over the October 15 MSVC build; preferences, consent and a saved alert were preserved. Both builds report `0.1.0`, so this is a same-version binary replacement, not a different-version upgrade test.
- Desktop and Start menu shortcuts are created. Bundled LICENSE, PRIVACY.md and THIRD_PARTY_NOTICES.txt match the repository files byte-for-byte. The installed executable differs from the built executable only by Tauri's three-byte NSIS bundle marker (`NSS` versus `UNK`).
- Real Claude and Codex local history loads without a partial-data flag, and model totals equal daily totals. Real Codex quotas load and render in the installed app. The opt-in native Codex live-connection test and both providers' real-history tests also pass.
- After owner sign-in, the opt-in native Cursor live-connection test passed, and nine checks passed against the installed NSIS executable in an isolated WebView profile: custom-profile validation and the local-account form, a successful live monthly allowance, matching Left/Used percentages, unofficial/no-history disclosures, refresh caching, persistence across renderer reload, and removal clearing displayed data without invalidating the Cursor sign-in. Evidence is in `cursor-live.json` and `cursor-live-remaining.png` in the private QA folder.
- Claude renders as local history without quota bars. The installed app accepts each of the 30/90/365-day history settings.
- Native CSV and JSON save dialogs create exports, cancellation reports "Export cancelled", and the panel remains behind the dialog and regains focus. The 30-day CSV and JSON daily totals agree, JSON uses format version 2, and the inspected exports contain no credential, local-path or conversation fields.
- Uninstall without data deletion removes the test executable and uninstall registration while preserving both app-data folders and exports. Reinstall restores the saved preferences, consent, connections and alert.
- Starting the installed app with both disposable app-data folders moved aside shows first-run consent again, with no provider connections. This verifies clean-start behavior, not the uninstaller's deletion checkbox.
- Production build, Chromium (104), WebKit (52), release UI (3), and Windows native unit tests (72 passed, 2 opt-in tests initially ignored) pass. The optional updater compiles, the npm production audit reports zero vulnerabilities, and notices cover all 534 locked packages.

Dependency and release-process follow-up on 2026-10-20 (working-tree changes after the clean-commit QA build above):

- The optional updater's unused Windows ZIP extractor is disabled. Windows keeps the direct NSIS `.exe` update format, macOS keeps `.app.tar.gz`, and TLS and system-proxy features remain enabled. `zip` and its two exclusive helper crates are removed from Cargo.lock.
- The refreshed full-lockfile Rust audit reports **zero vulnerabilities**. Five advisory warnings remain (`proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`, and `glib`); those packages are outside the Windows and macOS dependency trees. This does not verify macOS compilation or update installation.
- Release-mode Windows native tests with the updater enabled pass: 73 passed, 2 opt-in live-data tests ignored. The production frontend and all three release-build tests pass after notices regeneration.
- Notices cover 531 locked packages plus two separately documented runtime components. Generation succeeded from a new empty cache, requires no precomputed metadata file, and produces identical output on repeat. An intentionally incomplete run fails without replacing the existing notices file.
- The release workflow now audits the Rust lockfile and regenerates notices, rejecting drift. Its YAML parses locally; the changed workflow has not run on GitHub Actions.
- A new unsigned MSVC NSIS installer and native executable were built under `artifacts/local/windows-qa-2026-10-20/hardened/`. Eleven checks passed on that native executable, including the real Cursor checks above, second-instance handoff, and four pages staying within the current display's work area with a zero-pixel taskbar gap. These measurements cover this Windows 11 display configuration only. The new installer was built but was not installed again; the earlier installer lifecycle checks used the original clean-commit QA build. `BUILD-INFO.json` records the base commit, local changes and file hashes. These local files are for QA, not distribution.

Version 0.1.1 follow-up on 2026-10-20 (local working-tree candidate):

- Fixed stale quotas and reset timers when reopening after a long wall-clock gap. Regression coverage includes pending requests, fresh data, missing consent and disconnected providers; the stale-data regression fails against the original hook and passes with the fix.
- Built the unsigned 0.1.1 MSVC NSIS installer with locked dependencies and installed it over 0.1.0 into a path containing spaces. Preferences, alerts, consent and both disposable data markers survived. The registered version, native executable version and UI footer all report 0.1.1; bundled legal files match source.
- Eleven checks passed against the installed 0.1.1 executable, including real Cursor quotas, custom-profile persistence/removal, second-instance handoff and current-display placement. The original installation, data, registration and shortcuts were restored; its executable hash is unchanged. No uninstaller was executed during this follow-up.
- Four additional installed-app checks pass: real Claude and Codex history is available without partial scans, model totals equal daily totals, real Codex quotas load, and Codex renders live in its provider page. The opt-in native Codex connection test also passes.
- Production build, updater-enabled Windows release native tests (73 passed, 2 opt-in tests skipped in that suite), and all interface tests pass: Chromium 112, WebKit 56, production UI 3. Rust and production npm audits report zero vulnerabilities. Six local workflow policy checks pass, including ignoring stale Windows signing secrets while preserving macOS and updater configuration validation. GitHub workflow execution remains pending.
- The WebView2 bootstrapper download succeeds and its Microsoft Authenticode signature is valid. This verifies the download, not installation on a machine without WebView2.
- Private evidence and the unsigned installer are in `artifacts/local/windows-qa-2026-10-20-v011/`. These are QA files from a modified working tree, not a tagged public release.

Approved-logo follow-up on 2026-10-20:

- The owner approved **Levels Clean in graphite**. `public/mark.svg` is the canonical artwork; `npm run icons` regenerates native app, tray and installer assets, including Windows ICO and macOS ICNS files.
- Rebuilt the unsigned Windows 0.1.1 NSIS installer. Three production UI tests pass. Three checks on the rebuilt native executable pass: the embedded SVG matches the approved source exactly, and navigation/Help logos render in both light and dark modes in an isolated WebView profile.
- The refreshed candidate is under `artifacts/local/windows-qa-2026-10-20-v011-clean-logo/`, with build metadata and checksums. This logo-only follow-up did not rerun installer lifecycle QA or verify macOS execution; earlier 0.1.1 upgrade and provider evidence remains above.

Owner installation, 2026-10-20: on explicit request, the branded installer upgraded the actual Windows installation from 0.1.0 to 0.1.1. All 301 existing app-data files were unchanged before launch; the installed executable matches the verified candidate with its expected NSIS bundle marker. MeterLuma launched and its panel opened. Backup and installation evidence are private under `artifacts/local/windows-install-2026-10-20-202452/`. This does not verify the uninstall data-deletion option or additional hardware configurations.

Still pending at this checkpoint:

- The Windows UI automation tool blocked opening the QA uninstaller ("product policy blocks this app"). The "Delete the application data" checkbox still needs testing in a newly isolated environment. It has not been marked passed.
- Cursor's default-path discovery did not find the profile in this QA setup: launching Cursor through packaged Codex redirected its data into the Codex package's `LocalCache/Roaming/Cursor` folder. The live test succeeded by selecting that folder through **Connections → Multiple local accounts**. MeterLuma does not automatically scan other applications' package folders. Normal default-path discovery and comparison against Cursor's web dashboard were not exercised by this live test.
- Windows 10, a machine without WebView2, real tray-icon click sequences, mixed-DPI/multi-monitor and auto-hidden taskbar configurations, physical sleep/wake, and live account changes/rate limiting remain outside this checkpoint. Different-version upgrade and simulated resume behavior now pass; current-display placement and second-instance handoff passed in the native follow-up above.
- Windows Authenticode signing is intentionally excluded from this release's requirements (owner decision, 2026-10-20). Windows downloads must be described as unsigned. Updater installation, macOS signing/notarization and builds/hardware, and final release-workflow validation remain separate release requirements. The earlier three `zip 4.6.1` vulnerabilities are resolved in the source follow-up above; the original clean-commit QA binaries predate that change.

The original MeterLuma app data, registration and shortcuts have been restored, and the original installed executable's SHA-256 is unchanged. Disposable test files are retained separately as evidence. The test uninstaller was renamed to `uninstall.exe.disabled`, and the earlier `Installed App/uninstall.exe` handoff path no longer exists. A future data-deletion test must isolate owner data again before enabling or running any test uninstaller.

## Account-token checkpoint ? 2026-10-20

Version 0.1.2 adds supplied account access tokens for Codex and Cursor subscription limits. Chromium (124), WebKit (62), and production UI (3) checks pass, including consent migration, no history reads in token mode, token-free preferences, disconnect behavior and failed connections. Windows DPAPI tests cover encryption, replacement, tamper rejection, provider separation and deletion. The three October 20 TLS advisories are patched in the lockfile; the refreshed Rust audit reports zero vulnerabilities, with the five previously documented platform-excluded warnings. Notices cover 533 components.

The patched unsigned NSIS installer was built and upgraded the owner's installation from 0.1.1 to 0.1.2. All 305 existing app-data files were unchanged before launch; the installed executable matches the candidate apart from the expected NSIS bundle marker. The app is running normally. Six native checks passed in an isolated WebView profile, covering first-run defaults, branding, synthetic invalid Codex and Cursor tokens, Claude-token rejection, and absence of saved token files/preference secrets. No real tokens or owner consent were supplied by automation. Candidate evidence: `artifacts/local/windows-qa-2026-10-20-v012-tokens/`; owner backup/install evidence: `artifacts/local/windows-install-2026-10-20-210100/`.

Positive live QA of manually supplied tokens remains pending entry by the owner inside the app. Earlier successful local-account checks do not establish that result. The macOS token-storage path has not been compiled or exercised on Mac hardware. Windows 10, missing-WebView2 installation and the blocked uninstaller deletion case remain unverified.

Styling follow-up, 21:07 UTC: at the owner's request, all authored and default WebView focus outlines are removed. Three production UI checks and four native checks pass, including dark/light consent screens and keyboard navigation/activation. The rebuilt 0.1.2 is installed and running; all 306 existing app-data files were unchanged before launch. Latest candidate: `artifacts/local/windows-qa-2026-10-20-v012-no-focus/`; owner backup: `artifacts/local/windows-install-2026-10-20-210721/`. Provider functionality was unchanged and its earlier QA scope remains as stated above.

Panel follow-up, 21:17 UTC: removed the duplicate HTML border/radius inside the Windows native frame and limited sidebar providers to selected connections or active local profiles. Empty setup and paused profiles have no provider icons; removing a provider's last connection also leaves its details page. Chromium 126, WebKit 63, production UI 3 and native panel checks 7 pass. The updated 0.1.2 is installed and running, preserving all 305 existing app-data files before launch. Current candidate: `artifacts/local/windows-qa-2026-10-20-v012-panel-cleanup/`; owner backup: `artifacts/local/windows-install-2026-10-20-211715/`. The no-outline preference is retained; prior manual-token and platform QA limitations still apply.

Footer follow-up, 21:25 UTC: the footer shows MeterLuma and its version on the left, and the next update minutes on the right. It uses the chosen interval when no provider is connected; clicking the version opens Options. Fetch/cache/retry information remains in the update tooltip and provider views. Chromium 126, WebKit 63, production UI 3 and native checks 10 pass. Native checks cover all four intervals, persistence after reload, footer alignment and Options keyboard behavior. The rebuilt 0.1.2 is installed and running; all 306 existing app-data files were unchanged before launch. Latest candidate: `artifacts/local/windows-qa-2026-10-20-v012-footer/`; owner backup: `artifacts/local/windows-install-2026-10-20-212554/`. Earlier live-token and platform limitations still apply.

Costs follow-up, 23:20 UTC: the Costs sidebar icon hides when no visible provider is chosen and returns after choosing one. Removing the last provider while viewing Costs returns to Overview. Focused Chromium 28, WebKit 14, production UI 3 and native checks 11 pass. The updated 0.1.2 is installed and running; all 307 existing app-data files were unchanged before launch. Current candidate: `artifacts/local/windows-qa-2026-10-20-v012-costs-hidden/`; owner backup: `artifacts/local/windows-install-2026-10-20-232008/`. Earlier live-token and platform QA limitations remain.

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
