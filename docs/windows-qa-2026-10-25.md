# Windows QA checkpoint — 2026-10-25

Version 0.1.2, Windows 11 Pro 10.0.26300, x64 MSVC, branch `restore-provider-logos`. This checkpoint supports continuing development and testing on Mac; it is not a public-release sign-off.

## October 26 follow-up: Codex subscription details

The Codex page now preserves and displays included-usage permission, credit balance and available rate-limit reset count from the existing `account/rateLimits/read` response, with a readable plan label and expandable connection/fetch details. Missing fields are unavailable, not zero or active. No credit purchase or reset redemption method is called. Existing cached snapshots without the added optional fields still deserialize, and cached account details remain labeled.

The installed CLI's generated protocol and a live quota-only diagnostic confirmed these fields. This account returned `prolite`, a weekly limit, zero credits, zero available resets and included usage allowed. The owner's reference plan label is displayed as Pro 5x. The [official app-server reference](https://learn.chatgpt.com/docs/app-server) documents credit details and earned-reset counts. Billing charges/renewal dates are not supplied, and credit balances are not converted to dollars. [Official pricing](https://learn.chatgpt.com/docs/pricing) distinguishes API prices from subscription usage; this update does not invent Codex dollar estimates from local tokens.

Rust release tests passed 82 checks with 2 opt-in local-data tests ignored. The initial Chromium run passed 148 checks and exposed 6 layout failures from unavailable detail rows taking space. Those rows now collapse into the details disclosure when no account data is returned; all 18 affected detail/reference checks passed afterward, covering all 154 unique suite cases. Production UI checks passed 3. Cases cover zero/missing/invalid fields, blocked included usage, unlimited credits, cached values, older snapshots, accessibility and both themes.

The full WebKit suite passed 77 checks. Six native checks passed, including the real Codex fields through the rebuilt backend and both themes, expanded details, automatic local discovery and stable geometry across all eight pages. At 00:25 UTC the unsigned 0.1.2 update was installed and reopened normally. All 316 original app-data files were restored after isolation and unchanged by installation before launch; installed resources match source and the executable differs from the candidate only by the expected three-byte NSIS marker. Latest evidence/candidate: `artifacts/local/windows-qa-2026-10-26-codex-details/`; backup: `artifacts/local/windows-install-2026-10-26-002500/`; isolation: `artifacts/local/windows-qa-2026-10-26-codex-isolation/`. This supersedes the earlier installed builds below. Other unverified platform and release cases remain unchanged.

## Earlier October 26 follow-up: Claude subscription-status limitation

The owner showed a paused subscription in Claude's website while MeterLuma displayed recorded local history. The Claude page now explicitly says **Subscription status unavailable** and explains that local history cannot establish active or paused status. History remains visible; automatic pause detection is not implemented.

A read-only diagnostic of the installed Claude Code 2.1.304 CLI returned signed-in `claude.ai` and subscription type `max`, without any billing-state field. No credentials or account identifiers were printed. The [official CLI reference](https://code.claude.com/docs/en/cli-reference) describes `auth status` as authentication status; that does not establish whether billing is paused. The app still does not invoke Claude authentication or access Claude credentials.

Production build, 14 targeted Chromium checks, 7 WebKit checks and 3 production UI checks passed, including explicit unavailable wording, preserved history, accessibility and no Claude quota request.

Five native checks passed for consent, automatic local discovery, stable panel geometry across all eight pages and the notice with retained history in both themes. At 00:11 UTC on October 26, the unsigned 0.1.2 update was installed and reopened normally. All 315 owner app-data files were restored after isolation and unchanged by installation before launch. The executable matches the candidate apart from the expected three-byte NSIS marker. Private candidate/evidence: `artifacts/local/windows-qa-2026-10-26-claude-status/`; backup: `artifacts/local/windows-install-2026-10-26-001127/`; isolation: `artifacts/local/windows-qa-2026-10-26-status-isolation/`. This supersedes the earlier installed build below.

## Earlier follow-up: stable panel and Costs layout

Navigation now keeps the standard 360 by 660 logical-pixel panel across all pages, subject to the existing native screen-work-area clamp. Costs and Help no longer shrink the window. The Costs donut is replaced by a readable estimated total, USD label, zero-usage explanation and aligned provider rows. Long account names truncate before the amount; pricing and coverage calculations are unchanged.

The production build, 68 targeted Chromium checks, 34 targeted WebKit checks and 3 production UI checks passed. Coverage includes both themes, accessibility, zero costs, large amounts, long names and no additional native resize calls during navigation. Five native checks passed against the rebuilt Windows candidate: consent, local detection, stable viewport/footer across all eight pages, all three Costs ranges without overflow, and both themes with reload. These UI-only changes did not require rerunning the previously passed Rust suites.

At 23:15 UTC the unsigned 0.1.2 update was installed and reopened normally. All 314 existing app-data files were unchanged before launch and were also restored byte-for-byte after isolated testing. The installed executable matches the candidate except for the expected three-byte NSIS marker. Private evidence: `artifacts/local/windows-qa-2026-10-25-panel-layout/`; owner backup: `artifacts/local/windows-install-2026-10-25-231524/`; isolation: `artifacts/local/windows-qa-2026-10-25-layout-isolation/`. This supersedes the candidate below; the remaining QA limitations are unchanged.

## Earlier follow-up: automatic local connections

The owner superseded the token-first default: MeterLuma now discovers existing local Claude Code history, Codex CLI profiles and Cursor desktop profiles after privacy revision 6 consent. No separate login or pasted token is required. Explicit disconnects, hidden providers, paused custom profiles and active explicit token connections are respected. Advanced token entry is collapsed by default. Windows also checks the known Codex MSIX redirected Cursor location, preferring an existing sign-in.

The final Chromium suite passed 138 checks, WebKit 69 and production UI 3. Windows Rust release tests passed 79 checks; the updater-enabled suite passed 80, with two opt-in local-data tests ignored in each suite. Version consistency and coverage of all 531 locked packages in the notices passed. No dependencies changed after the earlier successful audits.

Eleven native checks passed against the rebuilt candidate using disposable MeterLuma data and the owner's existing local provider connections. All three providers appeared automatically with no token entry. Claude and Codex history loaded with matching model/day totals; both Codex and Cursor returned live limits through their default local connection. Claude remained history-only. Provider-scoped discovery, reload persistence, persistent disconnects, hidden Costs after disconnect and absence of credential fields in preferences passed. No comparison with account dashboards or account-switching exercise is claimed.

At 22:13 UTC, the unsigned 0.1.2 installer replaced the owner's previous Costs build. All 316 existing app-data files were unchanged before launch. Installed resources match source; the executable matches the tested candidate except for the expected three-byte NSIS bundle marker. The app was reopened normally without debugging. The owner accepts the updated privacy notice in the normal app; acceptance was automated only in the disposable test profile.

Latest private candidate/evidence: `artifacts/local/windows-qa-2026-10-25-local-discovery/`. Owner backup: `artifacts/local/windows-install-2026-10-25-221341/`. Isolation/restoration: `artifacts/local/windows-qa-2026-10-25-local-isolation/`. The earlier report below remains historical; its live-token limitation concerns the optional advanced feature, not the now-verified default local workflow. Uninstall/tool limitations and unavailable Windows environments remain unchanged.

## Bug fixed

A clock tick or navigation after a rate-limit deadline could cancel its pending retry during the one-second grace period. Retry scheduling now retains the deadline until a new lookup starts. Already-spent deadlines cannot start a retry loop. The regression failed before the fix and passed three consecutive WebKit runs after it.

## Passed

| Check | Result |
| --- | --- |
| TypeScript and production frontend build | Passed |
| Chromium | 126 full-suite checks plus 2 checks for the added expired-deadline regression |
| WebKit on Windows | 63 full-suite checks plus 1 check for the added expired-deadline regression; this is not macOS native QA |
| Production frontend | 3 checks on the rebuilt assets |
| Windows Rust release tests | 77 passed; 2 opt-in local-data checks ignored |
| Updater-enabled Rust release tests | 78 passed; the same 2 opt-in checks ignored |
| Dependency audits | Zero Rust vulnerabilities and zero production npm vulnerabilities; Rust reports informational unmaintained-package warnings |
| Release metadata and notices | Versions agree; all 531 locked packages covered |
| Windows package | Unsigned NSIS installer rebuilt with locked dependencies |
| Disposable installation | Fresh installation and same-version replacement preserve seeded settings, consent, alerts and data; tested October 20 Costs candidate |
| Native UI | 11 checks: themes, keyboard behavior, native outer frame, provider/Costs visibility, footer, all refresh intervals and reload persistence |
| Native rejected-token flow | 6 checks: synthetic Codex/Cursor failures, no local-sign-in fallback, no stored rejected tokens, no preference secrets, Claude-token rejection and branding |
| Native history and lifecycle | 6 checks: restart, synthetic history parsing with exact totals and no message content, Costs, history windows, profile removal and clean Options Quit |
| Owner-data restoration | All 308 original app-data files restored byte-for-byte; original executable, registration and shortcuts preserved |

The native UI, token and history/lifecycle checks above used the October 20 Costs candidate. Final browser checks and the rebuilt installer include the retry fix. Successful real-token checks remain separate from synthetic rejection checks.

## Not verified in this run

- Successful real Codex and Cursor account-token connections, comparison with account dashboards, token replacement and persistence across an app restart. The owner was asked to enter tokens only in the normal app, with debugging disabled.
- Uninstall with and without deleting application data. The Windows automation tool rejected launching the disposable uninstaller: `product policy blocks this app`. No shell workaround was attempted. Earlier October 20 evidence covers an uninstall retaining data, but not deletion.
- Native save-dialog completion/cancellation and tray-icon click sequences: the computer-use tool could not expose a targetable MeterLuma window. Export invocation alone is not recorded as a successful saved export.
- Windows 10, a machine without WebView2, SmartScreen on a downloaded public artifact, Windows on Arm, mixed-DPI/multiple monitors, other taskbar edges/auto-hide and physical sleep/wake. Unit tests and simulated resume tests do not replace these hardware/environment checks.
- GitHub Actions and release-workflow execution. No workflow was dispatched and no release was tagged or published.

## Evidence and next platform

Private logs, synthetic fixtures, screenshots and candidate binaries are in gitignored `artifacts/local/windows-qa-2026-10-25/`. Isolation/restoration records are in `artifacts/local/windows-qa-2026-10-25-isolation/`. Do not publish those directories or commit WebView profiles, provider tokens or private exports.

Continue with [the Mac handoff](mac-handoff.md). Mac compilation, Keychain lifecycle, hardware behavior, signing and notarization still require Mac testing. Windows remains intentionally unsigned.
