# Worldwide launch requirements

MeterLuma is an active project. Passing interface and native checks makes it a working pre-release, not a product ready for a worldwide launch. This page lists what is done in the code as of 2026-10-15 (`release-readiness` at `1b4c9c1`) and what remains. The release mechanics are in [release-process.md](release-process.md).

## Product decisions established

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
  - Provider logos are replaced by original neutral glyphs, with a "not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor)" note.
  - Codex quotas keep using the installed Codex CLI's app-server.
  - The bundle identifier stays `app.meterluma.desktop`, because it names the app's data and cache folders.

## Done in the code

- Claude credential handling, token renewal and every Anthropic request are removed. Saved Claude alert rules and quota snapshots are dropped, and the privacy notice moved to revision 4, so existing users accept it again.
- The Cursor connection is labeled Unofficial wherever it appears, and the not-affiliated note is shown in Connections, Settings → About and the tray's Help page.
- Provider logos are replaced by original glyphs, and the incorrect OpenUsage attribution for them is gone from THIRD_PARTY_NOTICES.txt.
- THIRD_PARTY_NOTICES.txt covers every locked package (536 components, no unresolved notices). CI fails when a locked package is missing from it.
- Rate-limit cooldowns are capped at 6 hours and tied to the signed-in account. Codex lookups are shared between the two windows and reused for just under 5 minutes.
- Cache files live in the app's own cache folder, which the Windows uninstaller's "Delete the application data" option removes. Old cache files are deleted on startup.
- History marks days without logs as "Not recorded" instead of zero, values only priced tokens, and counts every Claude usage line (the old reader missed about 4.5% of tokens).
- `release.yml` builds the Windows MSVC installer and the universal macOS DMG, and applies signing, notarization and the updater only when their secrets exist. The app has a feature-gated updater that asks before installing. `docs/release-process.md` is the owner's runbook.
- Platform floors are set: macOS `minimumSystemVersion` 13.0 and a Safari 16 / Chromium 110 frontend target.
- Tray behavior is hardened (single instance, click debounce, placement on any taskbar edge including auto-hide, macOS Spaces and full-screen apps). It is covered by unit tests only, not hardware tests.
- A changelog exists: [CHANGELOG.md](../CHANGELOG.md).

## Remaining owner actions

1. **Signing certificates.** Apple Developer ID Application certificate, and Windows code signing through Azure Artifact Signing (recommended where eligible), a cloud-HSM signing service (needs its own signCommand), or an OV certificate from a CA that still supports the workflow in docs/release-process.md. Expect SmartScreen warnings on the first downloads either way.
2. **Notarization.** An App Store Connect API key (preferred) or an Apple ID with an app-specific password.
3. **Updater keys and hosting.** Generate and back up the updater key pair, set the endpoint, and host the downloads and `latest.json` over HTTPS on a domain you own. Do this before the first public build: users without an updater cannot be moved onto it later.
4. **Domain and mailbox.** Verify ownership of `meterluma.com` and that `support@meterluma.com` works, then set the bundle homepage.
5. **Lawyer's license review.** A qualified Moroccan advocate should review LICENSE 1.1, the privacy notice, the [legal issue review](legal-review.md), publisher/address disclosures and consumer requirements in the target markets.
6. **License decision on professional use** (audit finding claims-legal-policy#10). LICENSE 1.1 bans professional and employer use, yet most people who use Claude Code, Codex and Cursor use them for work. Either allow individual professional use (keeping the bans on organizational deployment and resale), or state the ban prominently on the download page and in the consent dialog.
7. **macOS hardware QA.** No macOS build of this code exists yet. Test on Apple silicon and Intel with macOS 13 or later: tray placement on each display, Spaces and full-screen apps, an auto-hidden menu bar, Codex quotas when started from Finder, the Cursor Keychain fallback, and updater dialogs.
8. **Windows installer QA.** Install, upgrade and uninstall (with and without "Delete the application data") on Windows 10 and 11, including the WebView2 download, SmartScreen, every taskbar edge, auto-hide, and mixed-DPI multi-monitor setups.
9. **Actions minutes and billing.** No CI run of this code exists, because the October minutes for the private repository are used up and the $0 budget blocks jobs. The owner has chosen not to pay for extra minutes, so wait for the reset on November 1, then get `checks.yml` green on the exact release commit, including a manual run of the native Windows and macOS jobs.

## Other work before public release

1. Real-account QA on both platforms: Codex and Cursor sign-ins, stale tokens, account changes, rate limiting, unavailable plans and provider schema changes. Missing data must stay missing, never become a fabricated zero. No real Cursor sign-in has been tested yet.
2. Replace the screenshots in `artifacts/`, which still show the former provider logos and Claude quotas.
3. Decide whether startup at login, a global shortcut, encrypted settings, safe diagnostics, and an in-app way to clear a rate-limit cooldown are needed for launch. Check sleep/wake, keyboard navigation and screen-reader labels.
4. Decide Windows on Arm support explicitly.
5. Ensure amounts, dates, reset windows, time zones, daylight saving transitions and language rendering work worldwide. Plan translated UI after the English copy is stable, with a fallback locale.
6. Prepare the launch website, owner-hosted downloads with `SHA256SUMS.txt`, installation help, the platform floor, and accurate privacy, support and license information based on the implemented behavior. Clearly state personal use only, no commercial use, no selling and no redistribution. Include the full license with distributions. Share official download links rather than third-party mirrors.
7. Make the notices generator independent of the gitignored `.tools/` folder, so CI can regenerate the notices itself.
8. Run final security, signing, update, license-packaging and crash-recovery checks, and review the exact release binaries before publishing downloads. A source publication decision is separate from binary release readiness.

## Owner information still needed

- Whether Apple Developer and Windows code-signing accounts exist.
- Domain ownership and a working support mailbox.
- Legal review of the custom license and the release's third-party obligations, and the professional-use decision above.
- Whether source will remain private or the owner explicitly accepts the platform view/fork rights of public hosting.

Never put signing keys, passwords, or provider tokens in chat or the repository. Provision deployment secrets only through the relevant secure settings, as described in [release-process.md](release-process.md).
