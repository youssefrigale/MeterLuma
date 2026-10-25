# Continue MeterLuma on Mac

Windows checkpoint: [2026-10-25](windows-qa-2026-10-25.md), version 0.1.2. Continue on branch `restore-provider-logos` in `youssefrigale/MeterLuma`. The latest change fixes cancellation of a scheduled rate-limit retry; the new regression failed before the fix and passes afterward. The checkpoint distinguishes completed Windows tests from live-token, tool-blocked and hardware-dependent checks.

## Get the code

In an existing checkout, save any local Mac work before updating:

```sh
git fetch origin
git switch restore-provider-logos
git pull --ff-only
npm ci
```

For a new checkout:

```sh
git clone --branch restore-provider-logos https://github.com/youssefrigale/MeterLuma.git
cd MeterLuma
npm ci
```

Use Node.js 22.22 or newer, stable Rust, and the Xcode command-line tools. See the [development prerequisites](../README.md#develop).

## Build and check locally

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:dev
```

The panel starts hidden in the menu bar. For a local DMG for this Mac's architecture:

```sh
npm run desktop:build -- --bundles dmg
```

For browser checks, install the engines once, then run the suites sequentially:

```sh
npx playwright install chromium webkit
npm test -- --output=test-results/chromium
npm run test:webkit -- --output=test-results/webkit
npm run test:release -- --output=test-results/release
```

Run `npm run build` before the release UI suite. The project supports a universal Mac build; see [release-process.md](release-process.md) for release targets and signing. This handoff is a development checkpoint, not a published release.

## First Mac work

- Start with the default local workflow: after privacy revision 6 consent, Claude Code history, the signed-in Codex CLI and the Cursor desktop profile should appear automatically without a MeterLuma login or token entry. Test startup from Finder, detection after Refresh, missing/expired local sign-ins, explicit disconnect persistence, hidden providers and paused custom profiles. Verify the Cursor default-profile Keychain fallback. Claude must remain history-only.
- Compile and exercise the new macOS Keychain account-token path in `src-tauri/src/providers/tokens.rs`. Windows checks cannot verify this native code. Test saving, replacement, restart, disconnect, access denial and a locked Keychain without exposing tokens in screenshots or logs.
- Verify Codex external-token quotas using an up-to-date official CLI, including when MeterLuma starts from Finder. Token mode uses a separate temporary Codex home and must never fall back to local sign-ins or history. Expired tokens need replacement inside MeterLuma.
- Verify Cursor account-token limits and its Unofficial disclosures. Successful real manual-token QA remains pending on both platforms; previous Windows local-sign-in checks covered a separate path.
- Check menu-bar placement on multiple displays, full-screen Spaces, an auto-hidden menu bar, scale changes and physical sleep/wake. Test on macOS 13 or later, with Apple silicon and Intel coverage where available.
- Retain the approved Levels Clean graphite logo, no focus outlines, hidden provider/Costs icons before selecting a provider, and the footer with version left and next update minutes right. `AGENTS.md` records owner decisions.

Account-token connections above are optional advanced functionality; they are not the default onboarding workflow. Claude remains local history only. Do not collect Claude.ai session credentials. Windows builds remain intentionally unsigned; that policy does not waive macOS release signing/notarization requirements.

## What is included

Source, lockfiles, regenerated native icons, logo exploration, third-party notices, tests, release workflow changes and project memory are committed. Private Windows installers, backups, WebView profiles, local QA reports, toolchains and provider credentials are excluded. The private evidence paths in the documentation refer to the Windows machine, so their files will not appear after cloning.

Latest Windows follow-up passed 28 focused Chromium checks, 14 focused WebKit checks, three production UI checks and 11 native checks. Earlier 0.1.2 checks passed 77 native unit tests, with two local-data checks ignored, and the Rust/npm production audits reported zero vulnerabilities at that checkpoint. These results do not establish Mac readiness; see [launch.md](launch.md) and [beta-testing.md](beta-testing.md).

GitHub Actions minutes are exhausted until the recorded November 1 reset. Use local Mac builds and tests for now; do not manually trigger native CI or publish/tag a release as part of this handoff.
