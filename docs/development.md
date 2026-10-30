# Development

Build MeterLuma from source for development or testing. Public desktop installers have not been published.

Install **Node.js 22.22 or newer**, **stable Rust**, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Desktop builds require the Xcode command-line tools on macOS, or the MSVC C++ build tools and Windows SDK on Windows. The macOS deployment target is 13.0 or newer.

```sh
git clone https://github.com/youssefrigale/MeterLuma.git
cd MeterLuma
npm ci
npm run desktop:dev
```

The desktop app starts in the menu bar or system tray. Click its icon and open **Connections** to choose a provider. If Codex limits are unavailable, check that the official Codex CLI is installed and signed in. If a local profile is not detected, select its supported folder under **Multiple local accounts**.

For a browser-only development preview:

```sh
npm run dev
```

Open `http://127.0.0.1:1420`. Browser previews cannot read native provider connections; sample data is available only in development.

### Build and check

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx playwright install chromium webkit
npm test
npm run test:webkit
npm run test:release
```

Build the desktop application for the current operating system:

```sh
npm run desktop:build
```

Windows builds are unsigned. macOS distribution requires Developer ID signing and notarization. See the [release process](release-process.md) for packaging and updater configuration.

