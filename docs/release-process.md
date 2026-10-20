# MeterLuma release process

This is the owner's runbook for producing a MeterLuma release. Releases are built only by
`.github/workflows/release.yml`, from a clean, tagged commit. Local builds (including the GNU/LLVM
Windows beta path under `.tools/`) are for personal testing only and are never distributed.

## What runs where

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `checks.yml` | every push to `main` and every pull request run Release metadata and Interface checks; Desktop runs only on manual dispatch (Run workflow, with "desktop" ticked) | **Release metadata**: versions agree and `THIRD_PARTY_NOTICES.txt` covers every locked package. **Interface checks**: type-check and build, then Chromium tests (dev server), release-build tests (`vite preview` of `dist`, so no demo controls) and WebKit tests. **Desktop (windows/macos)**: native tests with `--locked` (macOS also runs the Intel slice under Rosetta), `cargo test --release --lib --features updater --locked`, and an unsigned CI bundle that is not for distribution. |
| `release.yml` | a pushed tag `v*`, or manual with an existing tag | Verifies that the tag matches the versions and that the tree is clean, audits the Rust lockfile with cargo-audit 0.22.2, regenerates notices from the dependencies and rejects drift, and runs all interface tests. Then it builds the Windows x64 NSIS installer (MSVC) and the universal macOS DMG with `--locked`, keeps Windows unsigned by policy, and applies macOS signing/notarization and the updater only when their secrets exist, and writes `SHA256SUMS.txt`, `BUILD-INFO.json` and, when the updater is configured, `latest.json`. Everything is uploaded as a workflow artifact and attached to a **draft** GitHub release. |

`npm run test:release` serves the existing `dist/` through `vite preview`, so run `npm run build` first.

### Platform floor

- **Windows** 10 and 11, x64. The installer is per-user (no administrator prompt). If WebView2 is
  missing, the installer downloads it, which needs internet access. The app is not tested on Windows on Arm.
- **macOS** 13 Ventura or later, as one universal app (Apple silicon and Intel).
  `bundle.macOS.minimumSystemVersion` is `13.0`, and the frontend targets Safari 16. State both floors on the download page.

### Fixed identity

The bundle identifier stays `app.meterluma.desktop`. It names the WebView data and cache folders
(for example `%LOCALAPPDATA%\app.meterluma.desktop`), so changing it would orphan every user's
settings. The installer publisher is "Youssef Rigale" and the copyright line is
"Copyright (c) 2026 Youssef Rigale".

## One-time setup

Secrets go under GitHub → repository → Settings → Secrets and variables → Actions. Use the
**Secrets** tab for secrets and the **Variables** tab for variables. Each feature below is optional,
and the workflow skips it cleanly when all of its secrets are absent. If only some of a feature's
secrets exist, the build **fails** with a message that names the missing ones, so a half-configured
signing setup never silently produces an unsigned release.

Run the `gh` commands below from a terminal outside the repository, and delete any temporary key or
certificate files afterwards.

### 1. Updater signing keys

The updater only installs updates signed by the key whose public half is built into the app. If you lose
the private key, installed copies can never be updated again. If it leaks, anyone who also controls your
update endpoint can push code to your users. Set the updater up **before the first public build**:
users without an updater cannot be migrated later.

1. Generate the key pair outside the repository, choosing a strong password when prompted:
   ```sh
   npx tauri signer generate -w ~/.tauri/meterluma-updater.key
   ```
   This writes `~/.tauri/meterluma-updater.key` (private) and `~/.tauri/meterluma-updater.key.pub` (public).
   The repository's `.gitignore` also ignores `.tauri/`, `*.key` and `*.key.pub`.
2. Store the private key file and its password in your password manager, and keep one offline backup.
3. Add the secrets:
   ```sh
   gh secret set --repo youssefrigale/MeterLuma TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/meterluma-updater.key
   gh secret set --repo youssefrigale/MeterLuma TAURI_SIGNING_PRIVATE_KEY_PASSWORD        # paste the password at the prompt
   gh secret set --repo youssefrigale/MeterLuma METERLUMA_UPDATER_PUBKEY < ~/.tauri/meterluma-updater.key.pub
   gh secret set --repo youssefrigale/MeterLuma METERLUMA_UPDATER_ENDPOINT --body "https://downloads.example.com/meterluma/latest.json"
   ```
   In PowerShell, pipe the file instead: `Get-Content -Raw $HOME\.tauri\meterluma-updater.key | gh secret set --repo youssefrigale/MeterLuma TAURI_SIGNING_PRIVATE_KEY`.
4. Set the repository **variable** `METERLUMA_DOWNLOAD_BASE_URL` to the https folder that will hold the
   installers, for example `https://downloads.example.com/meterluma/{version}`. `{version}` is replaced
   by the release version. Without this variable the workflow still signs the updater artifacts but
   does not write `latest.json`.

When `TAURI_SIGNING_PRIVATE_KEY`, `METERLUMA_UPDATER_PUBKEY` and `METERLUMA_UPDATER_ENDPOINT` all exist,
the release build does four things:
- adds a `--config` overlay that sets `plugins.updater.pubkey`, `plugins.updater.endpoints` and `bundle.createUpdaterArtifacts: true`
- builds with `--features updater`
- produces `MeterLuma_<version>_x64-setup.exe.sig` and `MeterLuma_<version>_universal.app.tar.gz` with its `.sig`
- writes `latest.json` for the `windows-x86_64`, `darwin-aarch64` and `darwin-x86_64` platforms

The base `tauri.conf.json` never contains updater settings. Windows updates use the signed NSIS `.exe` directly, and macOS updates use `.app.tar.gz`. The updater dependency keeps TLS and system-proxy support, with its optional Windows ZIP extractor disabled; do not publish a ZIP as the Windows update payload.

To rotate the key:
1. Generate a new pair.
2. Set `METERLUMA_UPDATER_PUBKEY` to the **new** public key, but leave the **old** private key in `TAURI_SIGNING_PRIVATE_KEY`.
3. Release once. That build is signed with the old key and trusts the new one.
4. Only after that release, switch `TAURI_SIGNING_PRIVATE_KEY` and its password to the new key.

### 2. Apple Developer ID signing and notarization

1. Join the Apple Developer Program. The account holder can create **Developer ID Application**
   certificates.
2. Create a Developer ID Application certificate (Xcode → Settings → Accounts → Manage Certificates,
   or developer.apple.com → Certificates). In Keychain Access, export it together with its private key as a `.p12` file with a password.
3. Find the identity string:
   `security find-identity -v -p codesigning` shows, for example, `Developer ID Application: Youssef Rigale (ABCDE12345)`.
4. Add the signing secrets:
   ```sh
   base64 -i DeveloperID.p12 | tr -d '\n' | gh secret set --repo youssefrigale/MeterLuma APPLE_CERTIFICATE
   gh secret set --repo youssefrigale/MeterLuma APPLE_CERTIFICATE_PASSWORD          # the .p12 export password
   gh secret set --repo youssefrigale/MeterLuma APPLE_SIGNING_IDENTITY --body "Developer ID Application: Youssef Rigale (ABCDE12345)"
   ```
5. Choose **one** notarization method:
   - **App Store Connect API key (preferred).** App Store Connect → Users and Access → Integrations →
     App Store Connect API → Team Keys → generate a key with **Developer** access. Download
     `AuthKey_<KEYID>.p8`; Apple lets you download it only once. Then:
     ```sh
     gh secret set --repo youssefrigale/MeterLuma APPLE_API_KEY --body "<Key ID>"
     gh secret set --repo youssefrigale/MeterLuma APPLE_API_ISSUER --body "<Issuer ID>"
     gh secret set --repo youssefrigale/MeterLuma APPLE_API_PRIVATE_KEY < AuthKey_<KEYID>.p8
     ```
   - **Apple ID.** Create an app-specific password at account.apple.com, then set `APPLE_ID`
     (the account email), `APPLE_PASSWORD` (the app-specific password) and `APPLE_TEAM_ID`.

   If both methods are configured, the API key wins. Notarization without the three signing secrets
   is an error.

Tauri reads these through its standard variables. It imports the certificate into a temporary
keychain, signs with the hardened runtime and notarizes and staples the app. The workflow then
notarizes and staples the DMG, and checks four things:
- the app is universal (arm64 and x86_64)
- it is signed by a Developer ID Application certificate
- both the app and the DMG have a valid stapled ticket
- `spctl` accepts the app

### 3. Windows code signing (optional future work)

Owner decision, 2026-10-20: the current Windows release will be unsigned because paid signing is outside the budget. The release workflow sets `WINDOWS_SIGNING_ENABLED` to `false`, ignores Windows signing secrets, and records `signed: false`. Windows Authenticode signing is not a release gate. State "Unsigned Windows installer" in download/release information. The options below are retained only for a possible future signed release; enabling them requires an explicit policy change and setting `WINDOWS_SIGNING_ENABLED` to `true`.

Since June 2023, publicly trusted code-signing keys must live in hardware (an HSM or a token), so
most certificate authorities no longer issue exportable `.pfx` files. Microsoft also ended EV
certificates' instant SmartScreen reputation in 2024. Expect SmartScreen warnings on the first
downloads whichever option you choose. Configure **one** of these:

- **Azure Artifact Signing**, formerly Trusted Signing (recommended for CI where you are eligible;
  identity validation for individual developers is limited to some countries):
  1. Create an Artifact Signing account in an Azure subscription, complete identity validation, and create a
     **Public Trust** certificate profile.
  2. Create an app registration (service principal) and grant it the certificate-profile signer role
     on the account. The portal has listed it as *Trusted Signing Certificate Profile Signer*, and it
     may now carry the Artifact Signing name.
  3. Add the secrets `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID`, and the
     **variables** `AZURE_ARTIFACT_SIGNING_ENDPOINT` (the regional endpoint, for example
     `https://eus.codesigning.azure.net`), `AZURE_ARTIFACT_SIGNING_ACCOUNT` and
     `AZURE_ARTIFACT_SIGNING_PROFILE`.

  The workflow installs `artifact-signing-cli` 0.11.0 and sets `bundle.windows.signCommand` through
  the overlay.
- **A certificate whose key you can export as a PFX** (OV):
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\MeterLuma.pfx")) | gh secret set --repo youssefrigale/MeterLuma WINDOWS_CERTIFICATE
  gh secret set --repo youssefrigale/MeterLuma WINDOWS_CERTIFICATE_PASSWORD
  ```
  The workflow imports it into the runner's user store and passes its thumbprint, `sha256` and an RFC 3161
  timestamp server through the overlay. The default server is `http://timestamp.digicert.com`; set the
  **variable** `WINDOWS_TIMESTAMP_URL` if your CA documents another.
- A cloud-HSM service from another CA (for example SSL.com eSigner or DigiCert KeyLocker) needs its
  own `signCommand`. The workflow does not wire one in; add it as a third branch beside the Azure one.

After the build, the workflow requires `Get-AuthenticodeSignature` to report `Valid` for both the
installer and `meterluma.exe` whenever signing is configured.

### 4. Hosting on your own domain

The repository is private, so its GitHub releases are not a public download location. They are the
build record. Host the downloads on your domain, served over HTTPS:

```
https://downloads.example.com/meterluma/latest.json                      ← METERLUMA_UPDATER_ENDPOINT
https://downloads.example.com/meterluma/0.2.0/MeterLuma_0.2.0_x64-setup.exe
https://downloads.example.com/meterluma/0.2.0/MeterLuma_0.2.0_x64-setup.exe.sig
https://downloads.example.com/meterluma/0.2.0/MeterLuma_0.2.0_universal.dmg
https://downloads.example.com/meterluma/0.2.0/MeterLuma_0.2.0_universal.app.tar.gz(.sig)
https://downloads.example.com/meterluma/0.2.0/SHA256SUMS.txt and BUILD-INFO.json
```

- Upload the versioned files first and check that each URL downloads, for example with
  `curl -fsSI <url>`. Upload `latest.json` **last**, so clients never see a manifest whose files are missing.
- Serve `latest.json` with a short cache lifetime (`Cache-Control: no-cache` or `max-age=300`). Versioned files can be cached for good.
- The endpoint URL is compiled into every build. If you move domains, keep the old `latest.json` URL working, by serving it or redirecting, until users have updated.
- Confirm that you own the domain before the first public build. The `meterluma.com` contact address used in the docs is not verified yet.

## Cutting a release

### Pre-release checklist

- [ ] `checks.yml` is green on the exact commit you will tag: Release metadata, Interface checks, Desktop (windows) and Desktop (macos).
- [ ] The version is bumped everywhere and committed:
  ```sh
  npm version 0.2.0 --no-git-tag-version                       # package.json and package-lock.json
  # edit the version in src-tauri/Cargo.toml [package] and src-tauri/tauri.conf.json
  cargo update --workspace --manifest-path src-tauri/Cargo.toml # refreshes MeterLuma's entry in Cargo.lock
  ```
- [ ] `THIRD_PARTY_NOTICES.txt` was regenerated after any dependency change (`scripts/generate-notices.py`). The Release metadata job fails when a locked package is missing.
- [ ] `PRIVACY.md` and `LEGAL_VERSION` are updated if data handling changed.
- [ ] Smoke-tested from the unsigned CI artifacts of the same commit, on real Windows 10/11 and macOS 13 or later machines (Apple silicon and Intel if possible): consent gate, tray icon, quick panel, Codex quotas, the Cursor "Unofficial" label, recorded Claude Code history, export, and the uninstaller's delete-app-data option.
- [x] Windows signing policy is decided: ship Windows unsigned (owner decision, 2026-10-20); label the download accordingly. macOS signing/notarization remain separate requirements.
- [ ] The updater private key is backed up offline, and the endpoint answers over HTTPS.
- [ ] The download page states the platform floor and links `SHA256SUMS.txt`.
- [ ] `npm run release:verify -- v0.2.0` passes on a clean checkout. It runs the same tag, version and clean-tree check as CI.

### Tag and build

```sh
git switch main && git pull --ff-only
git tag -a v0.2.0 -m "MeterLuma 0.2.0"
git push origin v0.2.0
```

Pushing the tag starts **Release MeterLuma**. To rebuild an existing tag (for example after adding
secrets), run the workflow manually from the Actions tab and enter the tag. A rebuild replaces the files
of a release that is still a draft, and refuses to touch a published one.

If the build exposes a problem in the code, fix it on `main` and release a new patch version. Reuse a tag only if nothing
was distributed, and only after deleting both the draft release and the tag:
`gh release delete v0.2.0 --yes && git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`.

### Check the draft before publishing anything

1. Download the `MeterLuma-<version>-release` artifact or the draft release's files.
2. Verify the checksums:
   ```sh
   shasum -a 256 -c SHA256SUMS.txt          # macOS
   sha256sum -c SHA256SUMS.txt              # Linux
   ```
   ```powershell
   Get-Content SHA256SUMS.txt | ForEach-Object { $hash, $name = $_ -split '\s+', 2
     if ((Get-FileHash $name -Algorithm SHA256).Hash -ne $hash.ToUpper()) { "MISMATCH $name" } else { "OK $name" } }
   ```
3. Read `BUILD-INFO.json`:
   - `commit` equals `git rev-list -n 1 v0.2.0`, and `cleanTree` is `true`
   - `signing` and `updater` match what you configured
   - every entry under `tests` is non-null with `failed: 0`
   - `toolchain` records the exact rustc, cargo, Node, npm, Tauri CLI, Xcode and runner image used
4. Verify the signatures on a clean machine:
   - Windows: `Get-AuthenticodeSignature .\MeterLuma_0.2.0_x64-setup.exe` must show `Valid` and your name.
   - macOS: `spctl -a -vv -t install MeterLuma_0.2.0_universal.dmg`, `xcrun stapler validate MeterLuma_0.2.0_universal.dmg`, and,
     after installing, `spctl -a -vv /Applications/MeterLuma.app` must report `source=Notarized Developer ID`.
5. Install over the previous version and confirm that settings survive.

### Publish

1. Upload the installers, the `.sig` files, `SHA256SUMS.txt` and `BUILD-INFO.json` to the versioned folder, then `latest.json`.
2. With the updater enabled, confirm that an installed previous version offers the update, asks for confirmation, and restarts into the new version.
3. Publish the GitHub draft, or leave it as a draft; it stays private either way as the build record.

## Secrets and variables reference

| Name | Kind | Used for | Value |
| --- | --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | updater | contents of `meterluma-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | updater | that key's password |
| `METERLUMA_UPDATER_PUBKEY` | secret | updater | contents of `meterluma-updater.key.pub` (one line) |
| `METERLUMA_UPDATER_ENDPOINT` | secret | updater | https URL of `latest.json` |
| `APPLE_CERTIFICATE` | secret | macOS signing | base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | secret | macOS signing | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | secret | macOS signing | `Developer ID Application: Name (TEAMID)` |
| `APPLE_API_KEY` | secret | notarization (API key) | App Store Connect key ID |
| `APPLE_API_ISSUER` | secret | notarization (API key) | App Store Connect issuer ID |
| `APPLE_API_PRIVATE_KEY` | secret | notarization (API key) | contents of `AuthKey_<KEYID>.p8` |
| `APPLE_ID` | secret | notarization (Apple ID) | Apple account email |
| `APPLE_PASSWORD` | secret | notarization (Apple ID) | app-specific password |
| `APPLE_TEAM_ID` | secret | notarization (Apple ID) | 10-character team ID |
| `WINDOWS_CERTIFICATE` | secret | Windows PFX signing | base64 of the `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | secret | Windows PFX signing | the `.pfx` password |
| `AZURE_CLIENT_ID` | secret | Azure Artifact Signing | app registration client ID |
| `AZURE_CLIENT_SECRET` | secret | Azure Artifact Signing | app registration client secret |
| `AZURE_TENANT_ID` | secret | Azure Artifact Signing | directory (tenant) ID |
| `AZURE_ARTIFACT_SIGNING_ENDPOINT` | variable | Azure Artifact Signing | regional endpoint URL |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT` | variable | Azure Artifact Signing | account name |
| `AZURE_ARTIFACT_SIGNING_PROFILE` | variable | Azure Artifact Signing | certificate profile name |
| `WINDOWS_TIMESTAMP_URL` | variable, optional | Windows PFX signing | RFC 3161 server (default `http://timestamp.digicert.com`) |
| `METERLUMA_DOWNLOAD_BASE_URL` | variable, optional | `latest.json` | https folder of the installers; `{version}` is substituted |

`GITHUB_TOKEN` is provided automatically. Only the final release job gets `contents: write`, to create the draft.
The workflow never echoes secret values. It passes Tauri only the variables of the features in use,
because Tauri treats an empty `APPLE_*` or `TAURI_SIGNING_*` variable as set. It writes key files only
under the runner's temporary directory and removes them when the job ends.

On a paid GitHub plan, you can harden this further. Move these secrets into a `release` environment that only `v*` tags may use, and
add `environment: release` to the `build` and `publish` jobs.
