# MeterLuma project memory

## Owner decisions

- **2026-10-20 - Hide Costs without providers.** Hide the Costs sidebar icon below the logo whenever no provider connection/active profile is selected and visible. Restore it after choosing a provider; return to Overview if the last provider is removed while viewing Costs.

- **2026-10-20 - Footer layout.** Show `MeterLuma <version>` on the left and `Next update in <minutes>m` on the right. Use the selected refresh interval when no live refresh is scheduled. The version label opens the existing Options menu; fetch/cache/retry details remain in the update tooltip and provider views.

- **2026-10-20 - Provider sidebar shows chosen connections only.** Default-enabled visibility settings do not count as choosing a provider. Include selected default/token connections or active local profiles, keep paused profiles hidden, and remove the provider entry after its final connection is removed. Windows draws the panel's outer frame/corners; avoid a second rounded HTML border inside it.

- **2026-10-20 - No focus outlines.** The owner explicitly requested removal of all focus outlines throughout the app, including default WebView rings on disclosure summaries. Keep keyboard focus and activation behavior working.

- **2026-10-20 - Account-token subscription limits.** The owner wants Codex and Cursor limits from supplied account/session access tokens, not local provider files or API billing keys. Default to token connections; upgrades pause previous local connections until explicitly selected again. Keep tokens out of chat, preferences, logs, exports and source control. Store accepted tokens with Windows user-bound DPAPI or macOS Keychain, and never fall back to local sign-ins when a token fails. Claude remains optional local history only; do not collect Claude.ai session credentials.

- **2026-10-20 — Windows releases will be unsigned.** The owner cannot fund Windows code signing and explicitly removed it from the current release requirements. Do not ask the owner to buy signing or report the absence of Windows Authenticode signing as a release blocker. Describe Windows downloads accurately as unsigned. Paid Windows signing is optional future work.
- This Windows decision does not change macOS signing/notarization requirements or waive functional QA. Distinguish passed tests from cases that could not be exercised.
- The owner wants remaining implementation and QA work completed autonomously where tools and available environments permit it. Preserve the owner's installed app data and provider sign-ins during tests.

- **2026-10-20 - Approved logo: Levels Clean in graphite.** The owner chose Clean after reviewing the monochrome reference: flat white level bars with translucent tracks, a charcoal rounded tile, subtle gray illumination and a fine top edge. Canonical artwork: `public/mark.svg`. Regenerate native icons from it with `npm run icons`; keep the native tray, app, installer and frontend branding consistent. Earlier concepts in `design/logo-review/` are exploration only.

## Owner installation

- **2026-10-20, 23:20 UTC:** Installed and reopened the 0.1.2 Costs visibility follow-up. Costs hides without a selected visible provider and returns to Overview if the last provider is removed while Costs is open. All 307 existing app-data files were unchanged before launch; binary matches the candidate apart from the expected NSIS marker. Focused Chromium 28, WebKit 14, production UI 3 and native checks 11 passed. Latest candidate: `artifacts/local/windows-qa-2026-10-20-v012-costs-hidden/`; owner backup: `artifacts/local/windows-install-2026-10-20-232008/`. This supersedes the earlier 0.1.2 binaries below.

- **2026-10-20, 21:25 UTC:** Installed and reopened the 0.1.2 footer follow-up. Footer left is `MeterLuma 0.1.2` (Options trigger); right is `Next update in <minutes>m`, using the chosen interval even without a provider. Existing fetch/cache/retry details are in the update tooltip. All 306 existing app-data files were unchanged before launch; binary matches the candidate apart from the expected NSIS marker. Chromium 126, WebKit 63, production UI 3 and native checks 10 passed, including all four intervals, reload persistence, footer alignment and Options keyboard behavior. Latest candidate: `artifacts/local/windows-qa-2026-10-20-v012-footer/`; owner backup: `artifacts/local/windows-install-2026-10-20-212554/`. This supersedes the earlier 0.1.2 binaries below.

- **2026-10-20, 21:17 UTC:** Installed and reopened the 0.1.2 panel cleanup. Windows uses only its native outer frame, and the provider rail lists selected connections/active profiles only. All 305 existing app-data files were unchanged before launch; binary matches the candidate apart from the expected NSIS marker. Chromium 126, WebKit 63, production UI 3 and native panel checks 7 passed. Native tests accepted consent only in a disposable WebView and made no provider connection. Latest candidate: `artifacts/local/windows-qa-2026-10-20-v012-panel-cleanup/`; owner backup: `artifacts/local/windows-install-2026-10-20-211715/`. This supersedes the earlier 0.1.2 binaries below.

- **2026-10-20, 21:07 UTC:** Installed the owner's no-focus-outline follow-up, still version 0.1.2, and reopened the panel normally. All 306 existing app-data files were unchanged before launch; installed binary matches the candidate apart from its expected NSIS marker. Three production UI checks and four native focus checks passed, including both themes and keyboard activation/navigation. Candidate: `artifacts/local/windows-qa-2026-10-20-v012-no-focus/`; backup/install evidence: `artifacts/local/windows-install-2026-10-20-210721/`. This supersedes the earlier 0.1.2 binary below.

- **2026-10-20, 21:01 UTC:** Upgraded the owner from 0.1.1 to unsigned 0.1.2 with account-token connections and patched TLS dependencies. All 305 existing app-data files were unchanged before launch. The installed binary matches the candidate apart from the expected three-byte NSIS marker. It is running normally with its panel opened; no debug endpoint, owner consent acceptance or real manual-token entry was performed. Backup/evidence: gitignored `artifacts/local/windows-install-2026-10-20-210100/`; candidate and six passing synthetic native checks: `artifacts/local/windows-qa-2026-10-20-v012-tokens/`. Positive live manual-token QA remains pending owner entry inside MeterLuma. This supersedes the 0.1.1 installation below.

- **2026-10-20:** At the owner's request, upgraded the actual Windows installation from 0.1.0 to the unsigned 0.1.1 Levels Clean build. All 301 existing app-data files were byte-for-byte unchanged before launch; the installed executable matches the verified build with its expected NSIS bundle marker. MeterLuma was launched and its panel opened. Backup and evidence: gitignored `artifacts/local/windows-install-2026-10-20-202452/`.
- The newest entry above is the owner's current installation. Do not restore older QA installation/registration backups over it unless the owner asks for rollback.

## Release evidence

- Keep the current readiness status in `README.md` and `docs/launch.md`, and release mechanics in `docs/release-process.md`.
- Private local QA reports and binaries live under gitignored `artifacts/local/windows-qa-*` directories. They are not public releases. Do not commit provider credentials, private usage exports, or WebView profiles.

## Mac continuation

- The owner requested pushing all project changes to GitHub to continue on a Mac. Use branch `restore-provider-logos`; [docs/mac-handoff.md](docs/mac-handoff.md) contains checkout/build commands and the outstanding Mac QA. Include project memory, source, assets, tests and docs; keep private local evidence and credentials excluded.
- macOS native compilation, Keychain storage, hardware behavior and positive real manual-token QA remain pending. Use local builds while the recorded GitHub Actions allowance is exhausted; do not dispatch workflows or tag/publish a release for this handoff.
