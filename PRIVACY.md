# MeterLuma privacy information

Updated 2026-10-15, provider-connection revision 4, for the current desktop implementation. Publisher: Youssef Rigale, Morocco. Proposed support/privacy contact: support@meterluma.com. Verify ownership of meterluma.com and operation of this mailbox before public release.

MeterLuma has no publisher account service, analytics, advertising, cloud sync, or automatic crash-report upload. It does not send your usage history or exports to the publisher. This describes the app; a future download website, mail host, or hosting provider may process separate access logs and messages and needs its own disclosures.

What changed in revision 4: MeterLuma no longer reads, renews or writes any Claude credential and makes no requests to Anthropic. Claude is shown only as recorded history from Claude Code's local logs.

## On your device

The WebView stores appearance preferences, provider selections, profile labels and directory paths, history range, alert rules, and the accepted license version in local storage under meterluma.settings.v2. Dismissed alerts are kept under meterluma.alert-dismissals.v1. Paths and labels may contain personal information. Provider tokens and conversation content are not stored in these preferences. The license acknowledgement is local only, not an independently verified record of agreement.

When you connect Claude or Codex, the native app reads their local session logs: Claude Code's projects folder (in ~/.claude, CLAUDE_CONFIG_DIR, or a profile folder you add) and Codex's sessions and archived_sessions folders (in ~/.codex, CODEX_HOME, or a profile folder you add). These files also contain conversation text. MeterLuma filters them locally and keeps only token counts, model names and timestamps, plus message or event identifiers used to avoid counting a record twice. It does not send conversations to the publisher or include them in exports. History is scoped to the selected directory on this device across sign-ins; it is not a verified account-wide billing record. The selected period is 30, 90, or 365 days. Scans are bounded (for example, at most the 2,000 most recently modified log files in the period); skipped or unreadable logs mark the result as partial.

History coverage: MeterLuma can only count logs that still exist. Claude Code deletes local transcripts after 30 days by default (its cleanupPeriodDays setting). Days before the first recorded day are shown and exported as "Not recorded", not as zero usage.

History results are cached in memory for 60 seconds, and a per-file cache of usage metadata (dates, model names, identifiers and token counts, never conversation text) is kept in memory while the app runs. MeterLuma does not create a persistent database of usage history. Quitting clears these memory caches; the original provider logs remain under your control.

MeterLuma keeps two small cache files in the app.meterluma.desktop folder of the operating system cache (Windows: %LOCALAPPDATA%\app.meterluma.desktop; macOS: ~/Library/Caches/app.meterluma.desktop):

- quota-snapshots-v1.json keeps the last successful Cursor quota for up to 16 profiles: a hash of the profile path, a SHA-256 fingerprint of the sign-in token, usage percentages, reset times, the plan label and the fetch time. It holds no raw tokens, account names or conversations. When a refresh fails, the same sign-in's snapshot can be shown, labeled cached, for up to 24 hours. Expired quota windows, windows without a reset time once they are 5 minutes old, and entries older than 24 hours are removed from the file each time it is loaded or saved. A different sign-in never sees an old sign-in's snapshot.
- usage-cooldowns-v2.json keeps provider rate-limit deadlines: a hash of the profile path, a hash of the sign-in fingerprint, and the deadline. It holds no tokens or usage figures. A deadline follows the provider's Retry-After, with a minimum of 30 seconds and a maximum of 6 hours, and survives restarts. It applies only to the signed-in account, so signing in with a different account is not blocked. Expired deadlines are removed. There is no in-app reset: quit and delete this file, or wait at most 6 hours.

On startup MeterLuma deletes the two cache files left by earlier versions (quota-snapshots-v1.json and usage-cooldowns-v1.json in the MeterLuma folder of the operating system cache, which on Windows is also the install folder) and nothing else in that folder.

Provider details can estimate the API value of recorded Claude tokens locally, using Anthropic's list prices checked October 15, 2026. This uses the same token and model metadata and makes no network request. Estimates are labeled, use current standard global API rates and logged cache durations (five minutes if unspecified), and value fast mode at its published 2x rate on Opus 5.5, Opus 5 and Opus 4.8. They exclude tool fees, regional premiums, historical prices and discounts, and they are not subscription charges or bills. Tokens from models without a known price are left out of dollar amounts and counted separately. Codex usage has no dollar estimate. Exports may include the estimated value.

## Provider communications

Claude: MeterLuma reads Claude Code's local log files and keeps only token counts, model names, dates and message identifiers; conversation text is discarded and never stored or sent. It does not read the Claude sign-in (.credentials.json, the macOS Keychain or Claude Desktop), never renews or writes Claude credentials, and makes no requests to Anthropic. Claude has no quotas or alerts in MeterLuma.

Codex: Quota lookup starts the codex executable found on your PATH or in common install locations (for example npm, nvm, fnm, Volta, bun, pnpm or Homebrew folders) as "codex app-server" and asks it only for your rate limits. MeterLuma never uses a shell or the current folder to find it. The CLI handles its own sign-in and any token renewal, and may contact OpenAI or other services according to its own configuration and policies. MeterLuma does not read or copy Codex tokens and sends no prompts or inference requests. Each lookup is limited to 20 seconds and 1 MiB of output, and the process is stopped afterwards.

Cursor (Unofficial): After you connect Cursor, MeterLuma reads Cursor's existing access token, read-only, from Cursor's local state database (Cursor/User/globalStorage/state.vscdb). On macOS, for the default profile only, it falls back to the Keychain item "cursor-access-token". The token stays in process memory and is sent only to https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage, with the User-Agent MeterLuma/<app version>. This is an undocumented Cursor endpoint that is not endorsed by Cursor and may change or stop working without notice, so the app labels it Unofficial. TLS is verified against the operating system's trusted certificates plus bundled roots, redirects are not followed, requests time out after 15 seconds, responses are limited to 1 MiB, and errors omit raw response bodies and token values. A successful result is reused for 5 minutes for the same sign-in. MeterLuma never renews or writes Cursor credentials. Cursor receives the access token and ordinary request and network metadata under its own policies.

Requests follow your proxy settings (the HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and NO_PROXY environment variables, otherwise the manual proxy configured in Windows or macOS), so a configured proxy also sees them. Your network provider and each contacted service may receive ordinary connection information such as an IP address.

Updates: a build without an updater configuration never checks for updates. If the publisher enables updates in a release, that build contacts the publisher's update address about 30 seconds after start, then about once a day (after a failed check, it retries every 15 minutes until one succeeds), and when you choose "Check for updates". The request reveals your IP address and may include the app version, operating system and processor type. It sends nothing about your providers or usage, and an update installs only after you confirm.

Official status and usage pages open in your default browser only when you choose them.

## Alerts, exports, and deletion

Alerts appear in the app while it is running. They use fresh Codex or Cursor quotas only, never cached or sample values. There are no push services or notification uploads. CSV and JSON exports are created only when you request them, through a native save dialog. Exported files can reveal usage patterns, model names, and your profile labels; you control where they are saved and whether to share them. Exports omit credentials, local directory paths and conversation content.

Remove a profile or disconnect a provider to stop reading that source. Disconnecting does not sign you out of a provider or delete its original logs. Reset preferences returns display settings to their defaults and keeps connections, local accounts, alerts and license acceptance. Quitting clears in-memory results. Delete exported files separately.

Uninstalling on Windows removes the app. If you also tick "Delete the application data" in the uninstaller, it removes the %LOCALAPPDATA%\app.meterluma.desktop and %APPDATA%\app.meterluma.desktop folders, which hold the saved preferences (WebView storage) and both cache files. Without that option, those folders remain. On macOS, deleting the app does not remove its data: the ~/Library/Caches/app.meterluma.desktop folder and the WebView storage macOS keeps for app.meterluma.desktop under ~/Library remain until you delete them. Uninstalling never touches exported files, provider logs or provider sign-ins, and operating-system backups may keep copies. MeterLuma does not erase provider data.

## Support and applicable privacy rights

Do not send credentials, conversation logs, or unredacted screenshots in support requests. If you contact the publisher, the publisher and mail service will process what you send to handle that request. The mailbox provider, retention period, applicable lawful basis, any international transfers, and any required Moroccan CNDP formalities must be confirmed before support opens. This notice does not represent that those operations have already been configured or legally cleared. Contact the publisher for access, correction, deletion, or other applicable rights concerning data the publisher actually holds.

Children's data, additional telemetry, cloud sync, support uploads, a new update host, or a changed hosting setup require a fresh assessment and updated information before being introduced.
