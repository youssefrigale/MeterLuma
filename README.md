# MeterLuma

All your AI usage, one glance. A desktop tracker for macOS and Windows, with a free core and a planned one-time purchase of MeterLuma Pro.

## Current status

This is an internal prototype, not a public release. The dashboard, provider visibility, theme preferences, reset countdowns, sample spending charts, and local settings work. It starts with **clearly labeled sample data** and also includes experimental native connections for Claude Code, Codex CLI, and Cursor. Those connections need real-account QA before release. Pro and checkout are not implemented.

In the desktop app, open Connections and select **Connection options**, then **Use local sign-in**. This is the point where MeterLuma reads that provider's existing local credential. Browser preview mode cannot access native credentials or fetch live limits. Live and sample spending are never mixed.

The primary desktop interface is a 360 × 660 compact panel, opened by clicking the macOS menu-bar icon or Windows tray icon. It starts in the tray with the full dashboard hidden; clicking outside the panel hides it. MeterLuma has its own charcoal and amber design, a slim cost donut with Today / Yesterday / 30 Days sample ranges, provider-colored remaining-allowance bars, scrolling provider cards, and a fixed **Options** footer. Options opens Connections, Settings, or the dashboard, refreshes limits, or quits. Charcoal is the default theme, with an ivory light variant; saved theme and provider preferences stay synchronized between windows. Windows positions the panel using the clicked monitor's native work area, with its bottom edge flush against the top of a bottom taskbar; opening without an icon click also docks the panel. Top and side taskbars use their corresponding work-area edges. macOS retains menu-bar positioning and runs with an accessory activation policy. Native builds are configured through GitHub Actions for Windows and a universal Intel/Apple Silicon Mac package. Internal artifacts are unsigned.

![MeterLuma tray panel](artifacts/quick-view.png)

Cost ranges in the demo are simulated, including the thirty-day sample. Live mode currently displays real plan limits only, with an explicit unavailable-cost state instead of fabricated spending.

![MeterLuma dashboard](artifacts/overview-dark.png)

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
- `src-tauri/`: Rust desktop shell, tray behavior, native credential readers, provider HTTP clients and response mappers.
- `tests/`: browser behavior checks at desktop and compact widths.
- `.github/workflows/checks.yml`: interface tests and unsigned native builds.
- `docs/launch.md`: concrete requirements for worldwide release.

The app stores appearance, provider visibility, demo preferences, and selected connection IDs in browser/WebView local storage under `meterluma.settings.v1`. It never copies credentials there. There are no analytics, external fonts, billing, or account-sync servers. Pro descriptions are plans, not delivered functionality. Sample spend is an estimate in USD, not a subscription charge; live spending history is not yet implemented.

## Experimental live providers

- Claude Code: `.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`), plus the default `Claude Code-credentials` Keychain entry on macOS. Reads session and weekly usage. Claude Desktop-only sign-ins are not supported yet.
- Codex CLI: `.codex/auth.json` (or `CODEX_HOME`) with a ChatGPT OAuth token. API-key-only and keyring-only configurations are not yet supported. Reads primary and secondary rate-limit windows.
- Cursor: read-only local `state.vscdb` in the OS app-data directory, with macOS Keychain fallback. Reads the current period's supported plan limits.

Credentials stay inside the native process and are sent only to that provider's fixed HTTPS endpoint. Redirects are disabled. Responses are bounded to 1 MiB, errors never include raw response bodies or token values, and cached results are keyed by a credential/account fingerprint. Usage requests are cached for five minutes. Expired credentials must be renewed in the provider app; MeterLuma never rotates or overwrites them. A sign-in change during a request discards that response.

These provider endpoints are external dependencies and can change. Unsupported response shapes show an error instead of invented usage. Actual subscription/enterprise plan variants and platform credential formats still require native validation before launch.

## Ownership and publishing

GitHub home: `youssefrigale/MeterLuma`. Keep the repository private until the implementation, licensing, and release materials are ready for owner review. Free pricing does not imply an open-source license; the owner still needs to choose the source licensing terms.

## Verified beta checkpoint — 2026-10-13

- Runtime commit: `0c439156e3a075c5d24406b6b52bedec9acdc0e8`.
- [Native and interface build run](https://github.com/youssefrigale/MeterLuma/actions/runs/38462260553): successful Windows x64 and universal Mac packages; 8 native provider tests per platform; 30 browser checks.
- Additional local WebKit verification: 15 checks passed. The dark tray panel also passed an additional accessibility check.
- Six actual Windows WebView2 integration checks passed: hidden startup, single-instance panel opening, 360 × 660 logical sizing, Options navigating to Settings, panel hiding when Settings opens, and theme synchronization. See `artifacts/native-panel-check.json` and `artifacts/quick-view-windows-native.png`. These checks do not substitute for clicking the tray icon on every OS and display configuration.
- The updated Windows executable was relaunched normally and its compact MeterLuma window appeared. The light theme from the requested reference was applied through Settings.
- Windows and Mac builds produced identical `Cargo.lock` files; the resolved native dependencies are now committed.
- Real provider accounts, Mac GUI behavior, signing, updater, Pro features, licensing, and checkout remain unverified or unimplemented as described in `docs/launch.md`. This checkpoint is not a worldwide-release approval.
