# MeterLuma

All your AI usage, one glance. A desktop tracker for macOS and Windows, free for personal, noncommercial use only. Selling and redistribution are prohibited; see [LICENSE](LICENSE).

## Current status

This is an internal prototype, not a public release. The dashboard, provider visibility, theme preferences, reset countdowns, sample spending charts, and local settings work. It starts in **real-data mode** and includes recorded Claude/Codex activity and Codex CLI quotas. Experimental Claude and Cursor quotas use existing local sign-ins. Connections need real-account QA before release. Former Pro features are included free for personal use: 30/90/365-day recorded history and trends, multiple local account profiles, custom in-app quota alerts, and CSV/JSON exports. There is no paid edition or checkout.

In the desktop app, open Connections and select **Connection options**, then **Use local profile**. MeterLuma reads recorded local usage metadata; Codex quotas use the installed official Codex CLI app-server. Claude and Cursor quotas use their existing local credentials and fixed provider usage endpoints, following the approach documented by OpenUsage. Browser preview mode cannot access native local profiles or fetch live limits. Live and sample spending are never mixed.

Interface controls use Remix Icon 4.9.0 with consistent sizes and filled selection states. The original MeterLuma monogram is shared by the interface, favicon and generated desktop icons.

The primary desktop interface is a compact popup with a vertical icon sidebar: overview, individual provider details, costs, help, and settings. Provider pages show allowance bars and reset times above three compact usage rows, an inline token trend, and the top five recorded models. Extra limits, models and data notes expand on demand. Claude Code and Codex local session logs supply recorded tokens, 30/90/365-day daily activity, week-over-week trends, and model shares. These are device totals across local sign-ins, not account-wide billing. Actual billed spending remains unavailable. Known Claude model tokens have labeled estimates of API value at standard global rates checked October 15, 2026, including logged cache durations; these are not subscription charges. The default theme follows the system and updates automatically when it changes; Light and Dark remain optional overrides. Settings work inside the popup: refresh every 5 / 15 / 30 / 60 minutes, Left / Used bars, relative / absolute reset timers, clock format, appearance, and provider visibility and order. Provider website buttons open fixed status and usage pages in the default browser. Additional integrations, global shortcuts, and startup at login are not implemented.

The popup is 360 logical pixels wide and changes height with the page (420–660 pixels), with scrolling content and a fixed Options footer. It starts hidden in the tray; clicking outside hides it. Light gray and black is the default appearance, with a neutral graphite dark variant. Claude, OpenAI, and Cursor use their actual provider logo assets in the popup and dashboard. Preferences synchronize with the optional full dashboard. Windows accounts for actual client and visible-frame margins so the bottom edge docks flush against the taskbar, including after resizing; macOS retains menu-bar positioning and accessory activation. Native Windows and universal Mac packages are built through GitHub Actions. Internal artifacts are unsigned.

![MeterLuma tray panel](artifacts/quick-view.png)

Cost ranges in the demo are simulated, including the thirty-day sample. Live mode displays provider-reported limits and recorded local token activity, with labeled local Claude API-value estimates for known model prices. A day or period containing unknown model prices has no dollar total. Older saved preview settings migrate to real-data mode. Sample data and demo controls are available only in development previews. Release builds force real-data mode, including when older saved settings enabled demo.

![MeterLuma dashboard](artifacts/overview-light.png)

## Develop

Requires Node.js 22.22 or newer. Install dependencies, then start the browser preview:

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:1420. Build and verify:

```powershell
npm run build
npx playwright install chromium
npm test
```

Optional WebKit coverage, closer to the Mac renderer:

```powershell
npx playwright install webkit
npm run test:webkit
```

For the desktop app, install stable Rust and the OS build prerequisites from the [official Tauri instructions](https://v2.tauri.app/start/prerequisites/). On Windows this includes the Visual Studio C++ build tools and Windows SDK. On macOS this includes Xcode command-line tools.

```powershell
npm run desktop:dev
npm run desktop:build
```

Closing the desktop window keeps MeterLuma running in the tray. Choose **Quit MeterLuma** from its tray menu to exit completely.

## Structure

- `src/`: React dashboard, sample-provider model, charts, local preferences.
- `src-tauri/`: Rust desktop shell, tray behavior, bounded local-history readers, official Codex app-server client, profile validation, export save dialog, and response mappers.
- `tests/`: browser behavior checks at desktop and compact widths.
- `.github/workflows/checks.yml`: interface tests and unsigned native builds.
- `docs/launch.md`: concrete requirements for worldwide release.

The app stores appearance, provider visibility, demo preferences, local profile labels and paths, alert rules, history range, license acknowledgement, and selected connection IDs in browser/WebView local storage under `meterluma.settings.v2`. It never copies credentials there. There are no analytics, external fonts, billing, or account-sync servers. The app is free for personal, noncommercial use under the custom license; it is not open source. Sample spend is an estimate in USD, not a subscription charge; actual billed spending is not implemented. Recorded Claude token value can be estimated locally; see the expandable data note for its assumptions.

## Connections and free features

- Claude Code: recorded metadata from `.claude/projects` or `CLAUDE_CONFIG_DIR/projects`, plus live session/weekly quotas using `.credentials.json` or the default macOS `Claude Code-credentials` Keychain entry. Custom directories never fall back to another profile's credential. Claude Code credential-file tokens renew near expiry or once after HTTP 401, with guarded write-back preserving other fields. Claude Desktop-only credentials and macOS Keychain renewal are not implemented.
- Codex CLI: recorded activity from `sessions` and `archived_sessions` under `.codex` or `CODEX_HOME`. Quotas use the installed official CLI's documented `account/rateLimits/read` app-server method. Install a recent native Codex executable on PATH and sign in using the official app. MeterLuma does not extract tokens or send inference requests. The CLI handles its own authentication and may renew its credentials.
- Cursor: live quotas use the existing access token in `Cursor/User/globalStorage/state.vscdb`, with default macOS Keychain fallback. The native request uses the same dashboard usage RPC documented by OpenUsage. Recorded Cursor token history and automatic token renewal are not implemented.

Connect separate existing Codex, Claude, or Cursor directories in **Connections → Multiple local accounts**. Each must be under your home folder and contain supported provider data. Up to twelve additional profiles can be selected. Profiles are labels and directories, not verified account identities; logs include every sign-in recorded there. No credential snapshots or account-sharing service is created.

In **Activity**, select 30, 90, or 365 days, compare recent weeks, and export CSV or JSON. Only existing recorded history is available; older records are not reconstructed. Scans are bounded and partial totals are marked. CSV exports daily token activity; JSON includes available quotas. Exports omit paths, credentials, and conversation content. CSV labels are protected against spreadsheet formula interpretation.

Configure up to twelve threshold rules in **Settings → Custom usage alerts**. Alerts appear inside MeterLuma while running, using live quotas fetched within ten minutes and excluding elapsed reset windows. Demo values never trigger alerts. No push notification service is implemented. Alerts require a working connected sign-in and a fresh quota response.

Claude/Cursor usage requests use fixed HTTPS endpoints, verified TLS, no redirects, bounded responses, per-profile credential-fingerprinted caches, and throttling cooldowns. Token values and raw response bodies never appear in errors or exports. Selected Claude Code credential-file tokens can renew through the fixed provider OAuth endpoint, with guarded write-back. Cursor, Claude Desktop and macOS Keychain credentials remain read-only. This matches OpenUsage's general local-sign-in request approach, not all of its optional endpoints or credential formats. Successful quotas are cached for the same credential across restarts and shown as cached during failures; expired windows and snapshots older than 24 hours are omitted. See its [Claude](https://github.com/robinebers/openusage/blob/main/docs/providers/claude.md) and [Cursor](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md) documentation.

The native Codex response is bounded to 1 MiB and lookup has a twenty-second deadline. Native exports use an OS save dialog. Local histories are coalesced and cached for sixty seconds; settings and license acknowledgement stay in WebView local storage. Read [privacy information](PRIVACY.md), [third-party notices](THIRD_PARTY_NOTICES.txt), and the [legal issue review](docs/legal-review.md). Real-account and native OS validation remains required before release.

## Ownership and publishing

Copyright holder: Youssef Rigale, Morocco (`youssefrigale`). MeterLuma uses the custom [MeterLuma Personal Use License 1.1](LICENSE): individuals may use it for personal, noncommercial purposes and, if source is supplied by the owner, inspect, build, and modify it privately for that purpose. Commercial, business, professional, and organizational use is prohibited. Selling, sharing copies, mirroring, repackaging, and redistributing source, binaries, or modified versions are prohibited. Share the owner's official link instead of copies. Third-party components and provider marks retain their own licenses and rights.

This is proprietary software, free for personal use. Do not describe it as open source. These are custom terms prepared for owner review, not a guarantee of enforceability in every jurisdiction; obtain qualified legal review before public distribution. The intended support contact is support@meterluma.com; domain ownership and mailbox operation remain unverified.

GitHub home: `youssefrigale/MeterLuma`. Keep the source repository private while strict no-redistribution is the requirement. [GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users) grant users rights to view and fork public repositories; a project license cannot remove those platform grants. Public source hosting needs a separate owner decision about that exception. Publishing official binaries for personal use does not require making the source public.

## Current verification — 2026-10-15

- Production frontend build and TypeScript check passed.
- Chromium: 62 checks passed across desktop and compact widths. WebKit: 31 checks passed. Coverage includes first-use consent, 365-day history requests, profile isolation/removal, fresh-quota alerts, formula-safe CSV generation, JSON exports, and accessibility checks.
- Windows Rust check and 37 automated native tests passed (one real-account test is opt-in) using a workspace-local Rust/LLVM toolchain (`x86_64-pc-windows-gnullvm`). A fresh unsigned Windows installer and portable folder were built with required runtime DLLs. This does not replace the standard MSVC release or testing the Mac app on hardware.
- Production npm audit reported zero known vulnerabilities. This is not a full security audit or a Rust advisory audit.
- THIRD_PARTY_NOTICES.txt inventories 510 components, including the WebView2 SDK and local GNU beta's LLVM runtime, and collects notices/source links with no unresolved notice entries in that inventory. Review exact release binaries and trademark permissions separately. To regenerate: install dependencies, save `cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --locked` as `.tools/dependency-metadata.json`, then run `python scripts/generate-notices.py --fetch-upstream`.
- The latest owner-provided Claude response was HTTP 429 with a one-hour Retry-After. The app now distinguishes rate limiting from sign-in failures and preserves provider cooldowns across refreshes and restarts. Current Claude quotas remain unavailable during that deadline; no successful Claude quota response is claimed. Cursor had no readable local sign-in. No credentials were rotated or overwritten.
- The current native Windows beta returned real Codex quotas through its official app-server. Runtime checks also passed for fresh live defaults, consent synchronization, bundled notices, 365-day recorded activity, export availability, and persisted alerts/history settings. Native export save dialogs, installer installation/uninstallation, Mac GUI behavior, signed installers/notarization, operational support, and legal clearance remain outstanding. See [beta testing](docs/beta-testing.md) for current artifacts and limitations.

## Historical beta checkpoint — 2026-10-13

This checkpoint describes an earlier runtime with direct token-based quota connectors. The current Codex path uses the official CLI; Claude/Cursor usage requests have been restored with the safeguards above. It does not validate the current feature changes or authorize publication.

- Runtime commit: `78236fdf5eaa140942a46d5acd083276bf40972e`.
- [Native and interface build run](https://github.com/youssefrigale/MeterLuma/actions/runs/38484310114): successful Windows x64 and universal Mac packages; 20 native tests per platform covering token normalization, cumulative-event deltas, duplicate messages/sidechains, content isolation, provider responses, URL validation and taskbar geometry; 42 Chromium checks.
- Local WebKit coverage: 21 checks passed, with the five real-data/connection checks rerun after the final loading changes.
- Twelve checks against the actual Windows app passed, including live-mode migration, a successful real provider quota response, recorded Claude and Codex token histories, agreement between model and daily totals, matching displayed quotas/model names, explicit device scope, unavailable spending, failed-credential handling, exclusion of sample charts, and zero-pixel taskbar gaps on Overview, Codex, Claude, and Costs. See `artifacts/native-live-check.json`. Personal usage screenshots and account measurements are kept outside version control.
- The owner device's recent Claude and Codex histories scanned without a partial-data flag. The reader ignores non-usage records before JSON parsing, never returns conversation text, and scans in background workers. Read limits remain bounded (8 GiB, 2,000 recent files per provider); omitted usage is disclosed as partial. History reads are coalesced and cached for 60 seconds. Server quota caches retain their real fetch timestamp.
- Real quotas require a valid provider sign-in. Local token history can remain available when a quota credential needs renewal; it covers this device across local sign-ins, rather than all activity on an account. Dollar spending is unavailable. Demo data is an explicit opt-in, and prior preview preferences migrate to real-data mode.
- Antigravity/additional connectors, account-wide billing, shortcuts, startup at login, broader provider-plan/OS validation, Mac GUI testing, signing, and updater remain unimplemented or unverified. The former Pro and checkout plans were superseded by personal-use-only distribution on 2026-10-15. This is not a public-release approval.
