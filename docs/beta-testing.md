# Try the MeterLuma beta

This is an internal, unsigned pre-release for testing only. It is free for personal, noncommercial use under [LICENSE](../LICENSE); selling and redistribution are prohibited, so share the owner's official link rather than copies. Release builds use real data only and hide demo controls.

This build changes how providers connect: Claude is recorded history only, Cursor quotas are labeled Unofficial, and the provider logos are now Anthropic's, OpenAI's and Cursor's official files. The privacy notice is now revision 4, so earlier testers are asked to accept it again. See [CHANGELOG.md](../CHANGELOG.md).

## Windows

The current build is an unsigned MSVC installer, built locally from the `release-readiness` branch after these changes were committed: `artifacts/releases/windows-beta-2026-10-15-msvc/MeterLuma_0.1.0_x64-setup.exe`. `BUILD-INFO.json` beside it records the exact commit and build checks, and `SHA256SUMS.txt` its checksum.

It installs for the current user without an administrator prompt and downloads Microsoft WebView2 if it is missing. Because it is unsigned, SmartScreen will warn before it runs. It does not check for updates. The installer has not been install- or uninstall-tested yet, so that is part of this test.

The GNU/LLVM beta in `artifacts/releases/windows-beta-2026-10-15/` and the older Windows files in `artifacts/releases/` are superseded. They still contain the removed Claude quota connection and older logo files, so do not test or share them. Quit and remove an old beta before installing this build. On its first start the new build deletes the old beta's two cache files.

## Mac

There is no Mac build of the current code. The `MeterLuma-Mac.dmg` from October 13 predates these changes and must not be used for testing. A current Mac build needs either a manual run of the native CI job (blocked until the GitHub Actions minutes reset on November 1) or a local build on a Mac (`npm ci`, then `npm run desktop:build`). A CI build, or a copy downloaded from elsewhere, is unsigned and not notarized, so macOS blocks it until you choose Open Anyway in System Settings → Privacy & Security. A build made locally on the same Mac carries no quarantine flag and opens normally. Test on macOS 13 or later, on Apple silicon and Intel if possible.

## Test checklist

1. **First start.** The consent dialog appears before any local data is read, with the license and the privacy information (revision 4). The panel starts hidden in the tray. The tray menu shows a disabled "MeterLuma 0.1.0" line, **Open MeterLuma** and **Quit MeterLuma**, and no "Check for updates…" item.
2. **Tray panel.** Clicking the tray icon opens the panel next to it. Clicking the icon again closes it, and it must stay closed. A double-click should leave it open. Clicking outside hides it. MeterLuma has no other window: Connections, Help and Settings open inside the panel. On Windows the panel's edge should sit flush against the taskbar. If you can, try other taskbar edges, an auto-hidden taskbar, several monitors and different display scales. On macOS, check a secondary display, a full-screen app's Space, and an auto-hidden menu bar.
3. **Claude (history only).** In Connections, choose **Connect Claude**, then **Use local profile**. Claude shows "Local history only", with no quota bars and no alert option. The details say MeterLuma reads token counts from Claude Code's local logs and does not read the Claude sign-in or contact Anthropic. In Settings, set the recorded history window to 30, 90 and 365 days and check Claude's page each time. Days before the first recorded day should appear as hatched **Not recorded** bars, totals should read "Since <date>", and the note should mention that Claude Code keeps transcripts for 30 days by default. Dollar amounts are labeled as estimated API value, not a bill, and show "Excludes N tokens from models without a known price" when that applies.
4. **Codex.** You need the Codex CLI installed and signed in. After connecting, Codex should show its session and weekly limits with reset times that match Codex's own usage page. Without the CLI, it should say to install the official Codex CLI, and local history should still work.
5. **Cursor (Unofficial).** You need the Cursor desktop app signed in. The **Unofficial** badge and its explanation should appear in Connections, on the overview and on Cursor's page. Compare the monthly allowance with cursor.com/dashboard. Without a sign-in, Cursor should show a sign-in message and no invented usage. If Cursor limits requests, the app shows when it will retry, and cached quotas show their original fetch time.
6. **Multiple local accounts.** Add a second profile folder in **Connections → Multiple local accounts**. Check that its data stays separate, that removing it removes its data, and that adding the default profile again is refused.
7. **Alerts.** In **Settings → Custom usage alerts**, add a Codex or Cursor rule below current usage. The alert should appear in the app. Dismiss it, then check that it stays dismissed after a restart. Cached or rate-limited quotas must not trigger alerts.
8. **Exports.** In **Settings → History and exports**, export CSV and JSON, and also cancel the save dialog once. The panel should stay open behind the save dialog and keep focus afterwards. Unrecorded days should have `recorded` set to false and empty values. JSON should have `formatVersion` 2. Neither file should contain folder paths, credentials or conversation text. Open the CSV in a spreadsheet to check that labels are not run as formulas.
9. **Settings and costs.** Change the theme, Left/Used bars, reset timers, clock format, refresh interval, and provider order and visibility. Check that changes survive a restart. **Reset preferences** in Help should keep connections, local accounts, alerts and consent. In the tray's Costs tab, Today, Yesterday and 30 Days show estimated API value from recorded Claude history.
10. **Provider pages.** The Status and Usage dashboard buttons open the provider's official pages in the default browser.
11. **Disconnect and quit.** Disconnecting a provider removes its data from MeterLuma without signing you out of the provider app. **Quit MeterLuma** in the tray menu or the panel's Options menu exits completely.
12. **Uninstall (Windows).** Uninstall once without and once with "Delete the application data". With the option, `%LOCALAPPDATA%\app.meterluma.desktop` should be gone, and a reinstall should ask for consent again. Without it, that folder remains.

When reporting a problem, include the provider, plan, OS version, display setup and the exact error message. Never include credential files, tokens, session logs or unredacted screenshots.

## Known limitations

- Builds are unsigned and have no updater, startup at login, global shortcut or push notifications.
- A rate-limit cooldown cannot be cleared in the app. It lasts at most 6 hours; to clear it sooner, quit and delete `usage-cooldowns-v2.json` from `%LOCALAPPDATA%\app.meterluma.desktop` (macOS: `~/Library/Caches/app.meterluma.desktop`).
- Proxy auto-configuration (PAC/WPAD) is not supported. Proxy environment variables and the Windows or macOS manual proxy are.
- Cursor quotas use an undocumented endpoint that may change or stop working without notice.
- History covers only logs that still exist on this device, so it is not an account-wide record.
- Real-account QA, minimum OS versions, sleep/wake and installer behavior still need testing before a public release.
