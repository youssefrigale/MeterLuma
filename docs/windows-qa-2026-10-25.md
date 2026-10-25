# Windows QA checkpoint — 2026-10-25

Version 0.1.2, Windows 11 Pro 10.0.26300, x64 MSVC, branch `restore-provider-logos`. This checkpoint supports continuing development and testing on Mac; it is not a public-release sign-off.

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
