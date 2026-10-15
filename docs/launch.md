# Worldwide launch requirements

MeterLuma is an active project. The initial preview is complete when its interface and native shell pass checks; this does not mean the product is ready for a worldwide launch.

## Product decisions established

- Brand: MeterLuma.
- Platforms: macOS and Windows.
- MeterLuma is free for individuals' personal, noncommercial use only.
- Selling, commercial/business/professional/organizational use, and redistribution of MeterLuma are prohibited under the custom [LICENSE](../LICENSE). Third-party components retain their own terms.
- There is no paid edition or checkout in the current release scope. Earlier Pro plans are superseded.
- Describe the product as proprietary software free for personal use, not open source.
- Copyright holder: Youssef Rigale, Morocco. Intended support email: support@meterluma.com (mailbox and domain ownership unverified).
- GitHub owner: `youssefrigale`.
- The support email uses `meterluma.com`; ownership is unverified. The earlier `getmeterluma.com` idea was not a completed registration. Confirm one official download/support domain before launch.

## Work required before public release

1. Validate current supported connections: bounded local Claude/Codex log history, multiple existing profile directories, and Codex quotas through the official app-server. Claude/Cursor local credential readers and direct fixed-endpoint quota requests are restored at the owner's instruction, using OpenUsage's general approach. Provider-policy uncertainty is documented separately; no explicit ban on all usage-only reads or provider endorsement has been established. Browser mocks are not real-account QA.
2. Test actual sign-in, stale tokens, account changes, API throttling, unavailable plans, and provider schema changes on Windows and macOS. Missing data must remain missing, never become a fabricated zero.
3. Review LICENSE 1.1 and the [legal issue review](legal-review.md) with a qualified Moroccan advocate. Owner name/country are supplied; applicable publisher/address disclosures and worldwide enforceability remain unverified. Keep the source repository private while strict no-redistribution is required. Public GitHub repositories grant view/fork rights under [GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users); public source hosting requires a separate owner decision about that exception.
4. Complete the dependency and asset license audit for the exact release, preserving required notices and any source-offer obligations. The custom license covers original MeterLuma material only; it cannot restrict separately licensed dependencies or logos. THIRD_PARTY_NOTICES.txt contains the resolved dependency inventory, collected notices and exact source links. Resolve generator-reported notice gaps and verify the exact binaries; a metadata inventory is not legal clearance. Confirm trademark permissions or use original neutral symbols.
5. Confirm Apple Developer enrollment and Windows signing setup. Sign both packages, notarize the Mac build, and configure signed update manifests. Internal unsigned artifacts are not final distribution builds.
6. Finish startup-at-login, global shortcut, refresh backoff, encrypted settings where needed, safe diagnostics, and the compact tray panel. Verify multi-monitor positions, DPI scaling, sleep/wake, keyboard navigation, and screen-reader labels.
7. Confirm minimum OS versions and hardware targets using native QA. Test Intel and Apple Silicon Macs plus Windows x64; decide Windows ARM64 support explicitly.
8. Prepare the launch website, owner-hosted downloads, download verification, a support address, installation help, changelog, and accurate privacy/support/license information using the actual implemented behavior and owner identity. Clearly state personal use only, no commercial use, no selling, and no redistribution. Include the full license with distributions. Share official download links rather than third-party mirrors.
9. Ensure amounts, dates, reset windows, time zones, daylight saving transitions, and language rendering work worldwide. Plan translated UI after the English copy is stable; provide a fallback locale.
10. Run final security, signing, update, license-packaging, and crash-recovery checks; review the concrete release before publishing downloads. A source publication decision is separate from binary release readiness.

## Owner information still needed

- Whether Apple Developer and Windows code-signing accounts exist.
- Copyright holder identity, support contact, and domain ownership.
- Legal review of the custom license and the release's third-party obligations.
- Whether source will remain private or the owner explicitly accepts the platform view/fork rights of public hosting.

Never put signing keys, passwords, or provider tokens in chat or the repository. Provision deployment secrets through the relevant secure settings only when the integration exists.
