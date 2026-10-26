# Worldwide launch requirements

Latest October 26 installed follow-up: richer Codex subscription details from the existing official CLI quota lookup. Chromium coverage 154 after a focused layout correction, WebKit 77, production UI 3, Rust 82 (2 opt-in ignored) and native checks 6 passed. No billing charges or renewal dates are inferred. The checkpoint below records the scope and remaining platform/release limitations.

October 26 installed follow-up: Claude explicitly marks subscription status unavailable; automatic paused-status detection remains unimplemented. All 29 targeted browser, production and native checks passed. Details are in the checkpoint below.

Latest checkpoint: [Windows QA, 2026-10-25](windows-qa-2026-10-25.md), including the installed stable-panel and Costs-layout follow-up: 68 targeted Chromium, 34 WebKit, 3 production UI and 5 native checks pass. Earlier automatic-local-connection validation passed Chromium 138, WebKit 69, Rust 79, updater Rust 80 and native local checks 11. Real Claude/Codex history and live Codex/Cursor limits pass without pasted tokens. Optional advanced-token QA, blocked native UI checks and unavailable Windows hardware/environment cases are listed separately. Continue Mac testing without treating this checkpoint as public-release approval.

MeterLuma is an active project. Passing interface and native checks makes it a working pre-release, not a product ready for a worldwide launch. This page lists what is done in the code as of 2026-10-15 (`release-readiness` at `1b4c9c1`) and what remains. The release mechanics are in [release-process.md](release-process.md).

Windows QA update, 2026-10-20: the current NSIS installer, same-version replacement, a 0.1.0 to 0.1.1 upgrade preserving settings/data, uninstall preserving data, exports, and real Claude/Codex/Cursor connections were exercised on Windows 11 x64. Cursor passed using a custom profile for the Codex package's redirected app-data folder. The uninstall data-deletion checkbox is still blocked by the UI automation tool, and Windows 10, missing-WebView2 installation and additional hardware/account scenarios remain untested. A simulated long-gap resume regression is fixed; physical sleep/wake remains untested. See the [Windows QA checkpoint](../README.md#windows-qa-checkpoint--2026-10-20) for the exact scope and evidence.

## Product decisions established

- Claude subscription/billing status is unavailable. The app labels this explicitly and keeps local history visible; live detection of a paused subscription is not implemented. A logged-in CLI and plan name are not evidence of an active subscription.
- Brand: MeterLuma.
- Platforms: Windows 10 and 11 (x64, per-user installer) and macOS 13 Ventura or later (one universal app). Windows on Arm is not tested.
- MeterLuma is free for individuals' personal, noncommercial use only.
- Selling, commercial/business/professional/organizational use, and redistribution of MeterLuma are prohibited under the custom [LICENSE](../LICENSE). Third-party components retain their own terms.
- There is no paid edition or checkout in the current release scope. Earlier Pro plans are superseded.
- Describe the product as proprietary software free for personal use, not open source.
- Copyright holder: Youssef Rigale, Morocco. Intended support email: support@meterluma.com (mailbox and domain ownership unverified).
- GitHub owner: `youssefrigale`.
- The support email uses `meterluma.com`; ownership is unverified. The earlier `getmeterluma.com` idea was not a completed registration. Confirm one official download/support domain before launch.
- Owner decisions of 2026-10-15:
  - Claude live quotas are removed. Claude is recorded history from local Claude Code logs only. MeterLuma does not read, renew or write Claude credentials and never contacts Anthropic.
  - Cursor live quotas stay, labeled **Unofficial**, and are requested with an honest `MeterLuma/<version>` User-Agent.
  - Provider logos were replaced by neutral glyphs, with a "not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor)" note. Reversed on 2026-10-16, below.
  - Codex quotas keep using the installed Codex CLI's app-server.
  - The bundle identifier stays `app.meterluma.desktop`, because it names the app's data and cache folders.
- Owner decision of 2026-10-16: the provider logos are back, as each owner's official file, unmodified (Anthropic press kit, OpenAI and Cursor brand pages). The owner accepted OpenAI's Marks usage terms to download the Blossom. The not-affiliated note stays.
- Owner decision of 2026-10-20: Windows releases will be unsigned because paid code signing is outside the budget. Windows signing is not a release blocker. Download and installation information must state that Windows builds are unsigned. This decision does not waive functional testing or change macOS requirements. It is also recorded in the project's `AGENTS.md` memory.

Account-token update, 2026-10-20 (0.1.2): Codex and Cursor default to user-supplied access tokens, stored with Windows DPAPI or macOS Keychain. Previous local connections pause on upgrade and remain opt-in. Token mode never falls back to provider sign-in files or history. Claude session tokens remain unsupported. Privacy revision 5 covers the change. Frontend and Windows encrypted-storage checks pass; successful manual-token provider QA requires the owner to enter tokens inside the app. Earlier local-account QA does not cover that path, and the new macOS storage code still requires native compilation and hardware QA.

The patched 0.1.2 installer upgraded the owner's Windows installation from 0.1.1, preserving all 305 existing app-data files before launch. Six native checks using synthetic invalid tokens passed. Rust unit tests: 77 passed and two opt-in local-data checks ignored; Rust and npm production audits report zero vulnerabilities. This verifies the upgrade and rejection paths, not successful live manual-token access.

## Done in the code

- Claude credential handling, token renewal and every Anthropic request are removed. Saved Claude alert rules and quota snapshots are dropped, and privacy revision 5 now documents supplied-token storage and connection migration, so existing users accept it again.
- The Cursor connection is labeled Unofficial wherever it appears, and the not-affiliated note is shown in Connections and the tray's Help page.
- Provider logos are the owners' official files, unmodified, documented in src/assets/providers/README.md. THIRD_PARTY_NOTICES.txt names each logo's owner and source, and no earlier third-party logo files or attribution remain.
- THIRD_PARTY_NOTICES.txt covers every locked package (531 locked packages plus two runtime components after the 2026-10-20 dependency follow-up, no unresolved notices). CI fails when a locked package is missing from it. The release workflow also audits Rust dependencies and verifies regenerated notices; the modified workflow still needs its first GitHub run.
- Rate-limit cooldowns are capped at 6 hours and tied to the signed-in account. Concurrent Codex lookups share one CLI process, and a result is reused for just under 5 minutes.
- Cache files live in the app's own cache folder, which the Windows uninstaller's "Delete the application data" option removes. Old cache files are deleted on startup.
- History marks days without logs as "Not recorded" instead of zero, values only priced tokens, and counts every Claude usage line (the old reader missed about 4.5% of tokens).
- `release.yml` builds the Windows MSVC installer and the universal macOS DMG, and keeps Windows unsigned by policy and applies macOS signing/notarization and the updater only when their secrets exist. The app has a feature-gated updater that asks before installing. `docs/release-process.md` is the owner's runbook.
- Platform floors are set: macOS `minimumSystemVersion` 13.0 and a Safari 16 / Chromium 110 frontend target.
- Tray behavior is hardened (single instance, click debounce, placement on any taskbar edge including auto-hide, macOS Spaces and full-screen apps). Unit tests cover the placement and click logic. Windows 11 native checks passed for second-instance handoff and zero-gap panel placement on four pages on the current display; other hardware configurations and real tray-icon click sequences still need testing.
- Reopening after a long wall-clock gap refreshes stale usage and reset timers without duplicate in-flight resume requests. Chromium and WebKit regression tests pass; this is not a physical sleep/wake test.
- A changelog exists: [CHANGELOG.md](../CHANGELOG.md).

## Remaining owner actions

1. **macOS signing certificate.** Apple Developer ID Application certificate. Windows code signing is deliberately out of scope for this release; the workflow explicitly disables Windows signing, and Windows downloads must be identified as unsigned.
2. **Notarization.** An App Store Connect API key (preferred) or an Apple ID with an app-specific password.
3. **Updater keys and hosting.** Generate and back up the updater key pair, set the endpoint, and host the downloads and `latest.json` over HTTPS on a domain you own. Do this before the first public build: users without an updater cannot be moved onto it later.
4. **Domain and mailbox.** Verify ownership of `meterluma.com` and that `support@meterluma.com` works, then set the bundle homepage.
5. **Lawyer's license review.** A qualified Moroccan advocate should review LICENSE 1.1, the privacy notice, the [legal issue review](legal-review.md), publisher/address disclosures and consumer requirements in the target markets.
6. **License decision on professional use** (audit finding claims-legal-policy#10). LICENSE 1.1 bans professional and employer use, yet most people who use Claude Code, Codex and Cursor use them for work. Either allow individual professional use (keeping the bans on organizational deployment and resale), or state the ban prominently on the download page and in the consent dialog.
7. **macOS hardware QA.** No macOS build of this code exists yet. Test on Apple silicon and Intel with macOS 13 or later: tray placement on each display, Spaces and full-screen apps, an auto-hidden menu bar, Codex quotas when started from Finder, the Cursor Keychain fallback, and updater dialogs.
8. **Windows installer QA.** Install, upgrade and uninstall (with and without "Delete the application data") on Windows 10 and 11, including the WebView2 download, SmartScreen, every taskbar edge, auto-hide, and mixed-DPI multi-monitor setups.
9. **Actions minutes and billing.** No CI run of this code exists, because the October minutes for the private repository are used up and the $0 budget blocks jobs. The owner has chosen not to pay for extra minutes, so wait for the reset on November 1, then get `checks.yml` green on the exact release commit, including a manual run of the native Windows and macOS jobs.

## Other work before public release

1. Real-account QA on both platforms: Windows live Codex and Cursor lookups now pass for one signed-in account each (2026-10-20; Cursor uses an explicit redirected profile). the new manual-token flow, macOS, stale tokens, real account changes, live rate limiting, unavailable plans and provider schema changes still need coverage. Missing data must stay missing, never become a fabricated zero.
2. Replace the screenshots in `artifacts/`, which still show the removed Claude quotas and older logo files.
3. Check OpenAI's and Cursor's brand guidelines again just before launch.
4. Decide whether startup at login, a global shortcut, encrypted settings, safe diagnostics, and an in-app way to clear a rate-limit cooldown are needed for launch. Check sleep/wake, keyboard navigation and screen-reader labels.
5. Decide Windows on Arm support explicitly.
6. Ensure amounts, dates, reset windows, time zones, daylight saving transitions and language rendering work worldwide. Plan translated UI after the English copy is stable, with a fallback locale.
7. Prepare the launch website, owner-hosted downloads with `SHA256SUMS.txt`, installation help, the platform floor, and accurate privacy, support and license information based on the implemented behavior. Clearly state personal use only, no commercial use, no selling and no redistribution. Include the full license with distributions. Share official download links rather than third-party mirrors.
8. Completed 2026-10-20: the notices generator obtains locked Cargo metadata itself and creates its cache when needed; it no longer requires a precomputed `.tools/` file. The release workflow regenerates notices from dependencies and rejects drift. That workflow change still needs a GitHub Actions run.
9. Run final security, update, license-packaging and crash-recovery checks, applicable macOS signing/notarization checks, and review the exact release binaries before publishing downloads. Windows Authenticode signing is not required for this release. A source publication decision is separate from binary release readiness.

## Owner information still needed

- Whether an Apple Developer account exists. A Windows code-signing account is not needed for this release.
- Domain ownership and a working support mailbox.
- Legal review of the custom license and the release's third-party obligations, and the professional-use decision above.
- Whether source will remain private or the owner explicitly accepts the platform view/fork rights of public hosting.

Never put signing keys, passwords, or provider tokens in chat or the repository. Provision deployment secrets only through the relevant secure settings, as described in [release-process.md](release-process.md).
