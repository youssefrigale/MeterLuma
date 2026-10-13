# Worldwide launch requirements

MeterLuma is an active project. The initial preview is complete when its interface and native shell pass checks; this does not mean the product is ready for a worldwide launch.

## Product decisions established

- Brand: MeterLuma.
- Platforms: macOS and Windows.
- Core tracking stays free.
- MeterLuma Pro is a one-time purchase.
- GitHub owner: `youssefrigale`.
- Proposed domain: `getmeterluma.com`; registration has not been verified or purchased.

## Work required before public release

1. Implement real Claude, Codex, and Cursor connections with separate platform credential readers and account-isolated caches. Keep credentials out of the frontend, telemetry, logs, and exported usage.
2. Test actual sign-in, stale tokens, account changes, API throttling, unavailable plans, and provider schema changes on Windows and macOS. Missing data must remain missing, never become a fabricated zero.
3. Implement Pro features that will actually be sold. Define the one-time price, supported devices, upgrade policy, offline license behavior, and transfer policy before integrating checkout.
4. Configure an owner-controlled merchant-of-record or payment account, verified webhook handling, license issuance, refunds, and tax handling. Real checkout needs the owner's business and payout setup.
5. Confirm Apple Developer enrollment and Windows signing setup. Sign both packages, notarize the Mac build, and configure signed update manifests. Internal unsigned artifacts are not final distribution builds.
6. Finish startup-at-login, global shortcut, refresh backoff, encrypted settings where needed, safe diagnostics, and the compact tray panel. Verify multi-monitor positions, DPI scaling, sleep/wake, keyboard navigation, and screen-reader labels.
7. Confirm minimum OS versions and hardware targets using native QA. Test Intel and Apple Silicon Macs plus Windows x64; decide Windows ARM64 support explicitly.
8. Prepare the launch website, download verification, a support address, installation help, changelog, and accurate privacy/support/refund documents using the actual implemented behavior and owner identity.
9. Ensure amounts, dates, reset windows, time zones, daylight saving transitions, and language rendering work worldwide. Plan translated UI after the English copy is stable; provide a fallback locale.
10. Run final security, signing, update, payment, and crash-recovery checks; review the concrete release before making the repository or downloads public.

## Owner information still needed

- Whether Apple Developer and Windows code-signing accounts exist.
- Legal business/individual identity, support contact, domain ownership, and payment-account setup.
- Pro price and license terms.
- Source-code license and public repository preference.

Never put signing keys, payment secrets, passwords, or provider tokens in chat or the repository. Provision deployment secrets through the relevant secure settings only when the integration exists.
