# Changelog

## 0.1.2 (unreleased; changes since internal beta snapshot 0a41dfb)

Prepared for version 0.1.2; no release has been published.

### Added

- Resume missed automatic usage retries at their scheduled deadline after the renderer wakes. Verify cached-to-live recovery without a manual refresh, and make rate-limit notices explicitly describe automatic retries.

- Anchor the Mac popup to its current menu-bar item when opening from the app, menu or keyboard shortcut, and retain that placement through content resizing instead of falling back to the screen’s right edge.

- Start all Overview provider cards collapsed. Remember explicit expansions per connection and collapse cards when restoring the overview layout; full provider detail pages stay unchanged.

- Keep saved-token Keychain reads noninteractive during automatic refresh on macOS. Connections offers an explained Unlock saved connection action when macOS needs approval; saved credentials and their access controls are preserved.

- Prevent a fresh background provider response from triggering a false future-timestamp menu warning while the popup is hidden. Read current time on each render while retaining visibility-based timer suspension and genuine provider warnings.

- Reduce the Codex menu-bar item’s reserved image width while preserving its 13.5-point visible logo and readable percentage.

- Open Codex’s Usage dashboard at the ChatGPT usage overview in the native app and browser preview.

- Use the OpenCode template logo beside its selected menu-bar allowance on macOS.

- Clarified OpenCode Go / Go Plus subscription support in Connections and linked its usage dashboard directly to the subscription console.

- Drag grips and Up/Down keyboard reordering for core and additional providers, with local persistence, drop feedback, edge scrolling, cancellation and failed-save recovery. Apply order to Overview and sidebar without changing credentials or refresh sources; extend layout restore/Undo to additional-provider order. Remove core logo frames, render Codex at its final vector size, and use Antigravity’s crisp monochrome vector variant.

- Compact alphabetical additional-provider rows with bundled logos/owner marks, checkbox-style connection controls and an inline key-management action. Keep descriptions and consent in the setup dialog; preserve failed-replacement behavior and website-only providers. Include icon source hashes and third-party notices.

- Limit the Mac Settings page to 850 logical pixels with internal scrolling and a visible footer, clamped to the display work area. Other Mac pages retain content-based sizing; Windows sizing is unchanged.

- Compact Connections rows with inline connect/disconnect actions; fold multiple-account setup and connection explanations into expandable sections while retaining all controls and notices.

- Per-connection collapsible Overview cards, preserving all quota meters, amounts, cached notices and errors in the compact form. Keep detail pages full-size, expose reset text through accessible meter values/tooltips, and fade cached fills without dimming their labels.
- Separate Restore overview layout and Undo actions for card collapse, core provider order and default menu allowance. Preserve appearance, density, visibility, refresh, alerts, notifications and connections; account-scoped collapse keys are excluded from display-preference transfers.

- Optional Mac desktop usage notifications through UserNotifications, using actual authorization and completion callbacks. Add grouped low-allowance/custom-threshold/pace/reset events, persisted hashed deduplication/pace state, explicit failure recovery and no replay of uncertain attempts. Windows delivery remains unavailable; existing in-app alerts continue there.

- Optional custom global shortcut with conflict-safe replacement and restart restoration; preference imports cannot register keys. Add a session-only stay-open panel switch. Mac shortcut/stay-open smoke checks passed; Windows and broader multi-display QA remain pending.

- Display-preference backup/import with strict validation, a change preview and undo. Preserve connections, local accounts, alerts, consent and per-computer login settings.
- Local diagnostic preview/export with a 20-attempt lookup timing ring and status metadata. Exclude raw errors, paths, account labels, credentials and usage values; send nothing automatically.
- Start at login defaults to enabled on the first launch of an installed build, including upgrades to this default. Later app/system opt-outs are preserved, and preference imports do not change it. Real login/reboot QA remains pending.
- Zed personal edit-prediction quota, plus separate international/China Alibaba Coding Plan quota queries using supplied console tokens. No browser credential extraction, inference or renewal.
- Currency/precision-aware Claude extra-usage spending and monthly limits, separate from local token-value Costs and persistent quota fallback storage. Add returned Sonnet/Opus/Fable weekly pools without duplicating legacy/scoped readings.

- Optional known-duration usage projections, persistent Session/Weekly/Lowest-left menu selection, and fresh live Claude threshold alerts. Preserve actual quota values when another window is exhausted and flag the tray for attention.

- 42 additional opt-in integrations, including regional API connections, cached IDE quotas, local token readers and bounded Qoder/BytePlus CLI usage readers. Show provider-reported credits, currencies and quotas separately from local Cost estimates. Keep new connections disabled until individually chosen; preserve the previous key after failed validation, honor credential-scoped Retry-After, and support key replacement and disconnect. Additional integrations have fixture-based verification; live provider verification is pending.

- Reliability safeguards from the OpenUsage issue audit: path-scoped Claude Keychain reads, read-only Cursor safeStorage decoding, streaming compressed Codex history, persistent metadata-only extraction caching, stuck-lookup deadlines and stale/error diagnostics. Isolate Codex caches by current credentials and allow unrelated local profiles to refresh independently. Preserve sub-0.1% usage captions and exact reset-time tooltips.

- Codex API-value estimates at OpenAI Standard model rates, with cached-input discounts and per-request long-context tiers. Include supported Codex usage in Cost totals, provider details and exports; count unknown models separately. Estimates exclude speed-tier multipliers and cache-write fees and do not represent subscription charges.

- Optional read-only Claude session and weekly limits from the existing Claude Code login. Enable live usage in Connections to acknowledge privacy revision 7; existing revision-6 installs keep history-only access. Preserve local history, label cached limits, and keep credentials out of preferences and exports. Claude Code continues renewing its own sign-in.

### Removed

- **Dashboard window.** MeterLuma is now tray-only. Connections, local accounts, usage alerts, the history window, exports, the license and **Reset preferences** moved into the tray panel (Connections, Settings and Help), and the panel stays open while the export save dialog is showing. The dashboard's sample spending charts and week-over-week comparison are gone.
- **Earlier Claude credential writer.** The former connector that renewed and rewrote Claude tokens, used a Claude CLI User-Agent and carried an OAuth client ID was removed. The new optional usage reader does none of those things. Claude Desktop credentials remain unsupported; fresh live Claude in-app quota alerts are now available after live-usage consent.

### Changed

- Apply the owner-selected Ring A logo to the app, frontend branding and generated native icon assets: rounded yellow and white arcs on a graphite tile.

- Show the menu-bar warning triangle only for the displayed provider and allowance window at 25% or less remaining, matching the meter's Low allowance indicator. Keep other connection and data warnings in provider views and tooltip diagnostics.

- Keep Overview cards within the popup width when an additional provider has a long account heading, preserving visible meters and reset labels.

- Tighten the macOS menu-bar item's left and right margins through a temporary setting scoped to MeterLuma's process. Preserve the provider icon-to-text gap and leave system preferences unchanged.

- Restore spacing between the Codex menu-bar icon and percentage. Name warning providers and reasons in the tooltip, including lookup failures and exhausted windows, while keeping the displayed percentage as allowance remaining.

- Write exports completely before replacing a destination file, preserving the previous export when writing/replacing fails.

- Click the footer update countdown to request the same bounded refresh as the header, preserving provider retry cooldowns. Add a fixed GitHub shortcut to Options and optional compact Overview spacing.

- Exclude Codex sessions explicitly marked with a non-OpenAI model provider from local totals; keep old logs without provider metadata as device history. Version the extraction cache so previous mixed-provider results are reparsed.

- Keep Codex and other unpriced connections visible in the Cost breakdown. Show recorded token counts and an explicit missing-price status, exclude unavailable estimates from the subtotal, and preserve zero-dollar values only when a supported estimate exists.

- Publish recorded history independently of quota lookups so Costs stops showing Reading when history finishes or fails. Optimize the app crate in local development builds to avoid slow first scans of large usage logs.

- Fit the Mac popup height to its current content, including asynchronously loaded history and expanded sections. Grow or shrink on navigation, preserve the menu-bar gap, and clamp to the display work area; Windows retains its fixed-height behavior.

- Show Codex included-usage permission, available rate-limit resets and credit balance from the existing official CLI quota response. Format plan labels and add expandable subscription details with connection source and fetch time. Preserve missing values and cached labeling; older snapshot files remain compatible.

- Explicitly label Claude subscription status as unavailable. Recorded local history remains available even when the subscription is paused; history and a saved plan name do not establish billing status.

- Keep the panel and footer at the same size and position when switching pages. Replace the cramped Costs donut with a readable total, explicit USD label and aligned provider breakdown, including zero-value periods and long account names.

- Detect existing local Claude Code history, Codex CLI profiles and Cursor desktop profiles automatically after privacy revision 6 consent. No separate login or pasted token is needed. Keep explicit disconnects, visibility choices and paused custom profiles; retain active explicit token connections without fallback. Token entry moves under an advanced disclosure. Windows Cursor discovery also handles the known Codex MSIX redirected roaming profile.

- Keep a rate-limit retry scheduled when a clock tick or navigation renders just after its deadline. Spent deadlines do not cause repeated retries.

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

- Exclude explicitly non-OpenAI Codex sessions from local token-value history and invalidate the previous parse-cache schema. Preserve cumulative baselines across provider changes.
- Separate manual account locks across providers; bound additional lookup concurrency and CLI output/runtime, and stop hidden-panel display intervals.

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
