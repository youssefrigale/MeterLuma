# Changelog

## 0.1.2 (unreleased; changes since internal beta snapshot 0a41dfb)

Prepared for version 0.1.2; no release has been published.

### Removed

- **Dashboard window.** MeterLuma is now tray-only. Connections, local accounts, usage alerts, the history window, exports, the license and **Reset preferences** moved into the tray panel (Connections, Settings and Help), and the panel stays open while the export save dialog is showing. The dashboard's sample spending charts and week-over-week comparison are gone.
- **Claude live quotas.** MeterLuma no longer reads the Claude Code sign-in (`.credentials.json`, the macOS Keychain or Claude Desktop), never renews or writes Claude tokens, and makes no requests to Anthropic. Claude has no quota bars or alerts, saved Claude alert rules and quota snapshots are dropped, and the Claude CLI User-Agent and OAuth client ID are gone.

### Changed

- Costs is hidden from the sidebar until a provider is chosen, and returns to Overview if the final provider is removed while viewing Costs.

- The footer now shows MeterLuma and its version on the left and the next update time on the right, including the selected interval before any provider is connected. Click the version to open Options; fetch/cache/retry details remain in the update tooltip.

- Removed all focus outlines, including the default WebView rectangle on license disclosure text, at the owner's request. Keyboard focus and activation remain available.

- Codex and Cursor now default to user-supplied account access tokens for subscription limits. Token connections never read local provider logs or sign-in files. Previous local connections are paused on upgrade; choosing them again is explicit. Accepted tokens use Windows user-bound DPAPI or macOS Keychain and can be replaced or removed in Connections. Codex uses the official CLI's experimental external-token mode in an isolated temporary profile. Expired tokens require replacement; API keys and Claude session tokens are unsupported.

- MeterLuma uses the approved Levels Clean logo: flat white meter bars on a softly lit graphite tile. Frontend, tray, app and installer icons are regenerated from one SVG source.

- Windows installers are intentionally unsigned, per the owner's release policy. Windows signing is optional future work.

- **Claude** is recorded token history from Claude Code's local logs only. A Claude profile folder needs only `projects/`.
- **Cursor** quotas are labeled **Unofficial**, with a note that the endpoint is undocumented, not endorsed by Cursor and may stop working. Requests send an honest `MeterLuma/<version>` User-Agent.
- **Provider logos** are now the owners' official files, unmodified: Anthropic's Claude Spark, OpenAI's Blossom and Cursor's cube, from their press kit and brand pages. Codex and Cursor switch to their official light or dark file with the theme. The earlier third-party logo files and their attribution are gone, and the third-party notices name each logo's owner.
- A "not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor)" note appears in Connections and the tray's Help page.
- Privacy notice revision 5 documents protected token storage, connection migration and removal. Existing users are asked to accept it again.
- Cache files moved to the app's own cache folder (`app.meterluma.desktop`), which the Windows uninstaller's "Delete the application data" option removes. The old cache files are deleted on startup.
- Rate-limit cooldowns are capped at 6 hours and apply only to the signed-in account. Saved quota snapshots drop expired windows and anything older than 24 hours.
- Cursor requests trust certificates from the operating system as well as bundled roots, use proxy environment variables or the Windows/macOS manual proxy, and give clearer connection, TLS and timeout errors.
- Codex: the `codex` executable is found in more install locations (npm, nvm, fnm, Volta, bun, pnpm, Homebrew), and for npm-style installs the native binary is run directly, so Node does not need to be on the PATH. One lookup is shared by both windows.
- Alerts stay valid for the refresh interval plus 2 minutes (at least 10 minutes), and dismissals persist across windows and restarts.
- **Reset settings** is now **Reset preferences**, with a confirmation, and keeps connections, local accounts, alerts and consent.
- The tray Costs tab shows estimated API value from recorded Claude history. The tray tooltip is neutral, and the tray menu shows the app version.
- Tray panel: clicking the icon to close the panel no longer reopens it, it docks to the clicked taskbar edge (including auto-hidden taskbars), and on macOS it follows the clicked display and appears over full-screen apps.

### Fixed

- Windows no longer draws a second rounded HTML border inside its native panel frame. Sidebar provider icons appear only for selected connections or active local profiles, and disappear when their last connection is removed.

- Updated rustls-webpki, webpki-roots and webpki-root-certs for the October 20 emSign certificate-distrust advisories (RUSTSEC-2026-0381, 0382 and 0383).

- Returning to the tray after sleep or a long absence refreshes stale quotas and reset timers. Focus and visibility events share in-flight requests, and disconnected providers remain disconnected.

- Disabled the optional updater's unused Windows ZIP extractor. Windows updates continue to use the NSIS executable directly, and macOS retains its app tarball format. The locked `zip` dependency and its three reported vulnerabilities are removed.
- Third-party notices can be regenerated on a fresh checkout without a precomputed local Cargo metadata file. Missing notices now fail generation, and the release workflow audits Rust dependencies and verifies regenerated notices.
- Claude history undercounted by about 4.5% of tokens, because usage lines that put `type` after a large message were skipped. Every usage line is now counted.
- The history reader now keeps the 2,000 most recently modified log files instead of the first 2,000 found, and one unreadable file no longer hides a provider's whole history.
- Days without logs (for example after Claude Code's 30-day transcript cleanup) are shown and exported as **Not recorded**, not as zero. Totals read "Since <date>" when logs are shorter than the window.
- Dollar estimates value only priced tokens and say how many tokens were excluded, instead of hiding the whole day. Fast mode is valued at 2x on Opus 5.5, Opus 5 and Opus 4.8, and Bedrock, Vertex and gateway model ids are recognized.

### Added

- Exports: JSON format version 2 (app version, quota type per provider, `coverageStart`, per-day `recorded` and `unpricedTokens`), and new CSV columns `recorded`, `unpriced_tokens` and `estimated_api_value_usd`.
- An optional automatic updater, compiled only with the `updater` feature and active only when a release is built with updater keys. It checks shortly after start and then daily (retrying every 15 minutes after a failed check), and asks before installing.
- A release workflow (`.github/workflows/release.yml`) and owner runbook ([docs/release-process.md](docs/release-process.md)) for unsigned Windows and signed macOS releases.
- Supported platforms: Windows 10 and 11 (x64), and macOS 13 Ventura or later (set as the app's minimum system version).
