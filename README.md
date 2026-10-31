<p align="center">
  <img src="docs/assets/mark.svg" width="88" height="88" alt="MeterLuma">
</p>

<h1 align="center">MeterLuma</h1>

<p align="center"><strong>All your AI usage, one glance.</strong><br>
A menu-bar and system-tray companion for your AI tools.</p>

<p align="center">
  macOS & Windows · Version 0.1.2 pre-release · Free for personal use
</p>

<p align="center">
  <a href="https://meterluma.com">Website</a> ·
  <a href="#features">Features</a> ·
  <a href="#supported-providers">Providers</a> ·
  <a href="#availability">Availability</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="LICENSE">License</a>
</p>

MeterLuma brings usage limits, reset times and recorded token activity into a compact desktop popup. Use your existing local provider connections, check your allowance, and get back to work.

**Project status:** this is a pre-release source repository. No public installer release is published yet. Local builds are available for development and testing; signing, installer validation and platform QA remain release work.

<p align="center">
  <img src="docs/assets/overview-dark.png" width="360" alt="MeterLuma development Overview with its yellow ring logo and sample Claude, Codex and OpenCode allowances">
  <br><sub>Current development preview. All displayed values are sample data.</sub>
</p>

## Features

- **Usage at a glance.** See remaining or used allowance and reset times when a provider supplies them.
- **Existing local connections.** Detect Claude Code history, a signed-in Codex CLI and Cursor desktop profiles after the connection notice. No separate MeterLuma account is required.
- **Recorded activity.** Explore 30, 90 or 365 days of available Claude Code and Codex history, token trends and model breakdowns.
- **Multiple profiles.** Keep supported local profile folders separate and give them readable labels.
- **Quota alerts.** Set in-app usage thresholds for live Codex and Cursor allowances.
- **Local exports.** Save recorded usage as CSV or JSON through the system save dialog.
- **Your display preferences.** Choose light, dark or system appearance, allowance direction, reset-time format and refresh interval.

## Supported providers

The three connections in the published source are **Claude Code** (local history), **Codex** (subscription limits and local history), and **Cursor** (monthly allowance through an unofficial endpoint).

The current desktop development build also includes opt-in live Claude session/weekly limits and the integrations below. These additional integrations are local development work; they are not included in the published `main` source or a public installer yet. Availability depends on the provider and selected connection.

| Provider | Data available in the development build | Connection |
| --- | --- | --- |
| **DeepSeek** | API credit balance, including USD and CNY balances. | API key |
| **OpenRouter** | Reported key spending and account credit balance when your key permits it. | API key |
| **ElevenLabs** | Monthly character allowance and reported subscription tier. | API key |
| **Synthetic** | Current subscription request allowance and renewal time. | API key |
| **Venice** | Reported USD and DIEM balances. DIEM is not treated as dollars. | API key |
| **CrofAI** | Available requests and credits reported by the usage API. | API key |
| **Nous Portal** | Reported balance, monthly cap and subscription credits. | API key or account access token |
| **Pioneer** | Reported billing usage and remaining free credits. | API key |
| **Antigravity** | Production Cloud Code quota summary using a supplied Google OAuth access token. Shared and Argon pools stay separate. No local port discovery or token renewal. | Antigravity OAuth access token |
| **Gemini CLI** | Gemini Code Assist model quotas for a supplied OAuth access token and Cloud project. No project onboarding or credential renewal. | Gemini OAuth access token |
| **GitHub Copilot** | Personal AI Credits quota when the account exposes it. Organization billing is excluded. | GitHub OAuth access token |
| **Windsurf** | Reported daily/weekly remaining quotas and extra balance. No credential renewal. | Existing companion app API key |
| **Devin** | Reported daily/weekly remaining quotas and extra balance. No credential renewal. | Existing companion app API key |
| **Factory Droid** | Default-organization Standard and Droid Core windows plus extra balance. Explicit short-lived access token; no credential renewal or encrypted login discovery. | Factory access token |
| **Factory Droid Europe** | Default-organization Standard and Droid Core windows plus extra balance. Explicit short-lived access token; no credential renewal or encrypted login discovery. EU endpoint only. | Factory access token |
| **Grok** | Grok CLI shared weekly pool. No OAuth refresh or credential writes. | Grok CLI account access token |
| **Kimi Code** | Counter-based session and weekly usage. No credential refresh. | API key or account access token |
| **MiniMax** | Reported session and weekly Token Plan quota percentages. | API key |
| **MiniMax China** | Mainland China Token Plan quota. Uses a separate regional key. | API key |
| **Z.ai** | GLM Coding Plan session, weekly and web-search quotas. | API key |
| **Z.ai China (BigModel)** | China-region GLM Coding Plan quotas. Its key is never tried against the international endpoint. | BigModel API key |
| **Ollama Cloud** | Ollama Cloud monthly included and purchased credits, or legacy session/weekly limits. Uses your Cloud API key; local models are excluded. | Ollama Cloud API key |
| **OpenCode Go / Go Plus** | Session, weekly and monthly subscription quotas for OpenCode Go and Go Plus. Connect with your Go API key or Console OAuth access token. Zen pay-as-you-go balance and local request history are excluded. | Go API key or Console OAuth access token |
| **Kiro** | Saved Kiro IDE credit quota. Cached at its own timestamp for at most 15 minutes; refresh Kiro account dashboard to update it. No live request or credential refresh. | No key required |
| **Qoder** | Account quotas from the installed Qoder CLI control protocol. No prompt is sent. Qoder manages its own login; install and sign in through Qoder first. | Uses installed Qoder CLI |
| **Meta Muse** | Muse Code local session token records. Cache and reasoning fields are not added twice. Subscription quotas, billing and active account ownership are not inferred. | No key required |
| **Command Code** | Reported session/weekly caps and remaining credit-value units. No inferred monthly allowance. | Command Code API key |
| **Zcode** | Token counts from the local Zcode SQLite databases. No account limits or network requests. | No key required |
| **Cline** | Request-level local history from Cline VS Code and legacy CLI. Deleted aggregates and current SDK-only sessions are excluded; no quota or billing inference. | No key required |
| **Amp** | Reported Agent/Orb allowance, free balance and individual credits. Renewal days are not exact reset times. | Amp API key |
| **Zed** | Personal Zed edit-prediction usage from its account API. This does not measure Agent tokens, model budgets or billing. | Zed access token |
| **Perplexity** | Experimental consumer query/research counts using a supplied account access token. No app/browser credential extraction or challenge bypass. API billing balance is excluded. | Perplexity account access token |
| **Vercel AI Gateway** | Team USD credit balance and lifetime spend. No inferred percentage. | AI Gateway API key |
| **Fireworks** | Rated billing costs for the last 30 UTC dates using a Fireworks API key and account ID. Not a credit balance or Fire Pass allowance. | Fireworks API key |
| **Neuralwatt** | USD credit balance and billing-period energy allowance. | API key |
| **Alibaba Cloud Coding Plan** | Coding Plan request quotas using a supplied Model Studio console access token. Inference/API keys are not console sign-ins. No token renewal or browser credential reading. | Model Studio console access token |
| **Alibaba Coding Plan China** | Coding Plan request quotas using a supplied Model Studio console access token. Inference/API keys are not console sign-ins. No token renewal or browser credential reading. | Model Studio console access token |
| **BytePlus Coding Plan** | Personal and bound team-seat Coding Plan quotas from the installed BytePlus Ark CLI. The CLI manages its existing sign-in. No profile changes, login flow or inference. | Uses installed BytePlus Ark CLI |
| **Warp** | Legacy Warp credit-account quota and user bonus credits. Dollar-billed accounts may not expose these fields. No dollar conversion. | Warp access token |
| **JetBrains AI** | Saved AI Assistant quota from the most recently updated IDE. Cached values expire after 24 hours; separate IDE accounts are not combined. | No key required |
| **pi** | Local Pi session token records, including cache warming and compaction. No account quota or billing inference. | No key required |
| **Xal** | Token counts from the local Xal usage ledger. No account limits or network requests. | No key required |

**Research only:** Microsoft Copilot, Duck.ai. Tracking is unavailable; these are not working connections.

Provider data can be unavailable, expired or rate limited. Cached results retain their original fetch time. Cursor's undocumented endpoint may change independently of MeterLuma.

History covers logs that still exist on the selected device and profile. Missing days are marked **Not recorded**. Local history and saved plan labels do not establish whether a subscription is active, paused or paid.

The Costs view estimates the API-equivalent value of recorded tokens using the bundled price table. **These estimates are not your subscription bill or actual provider charges.**

## Privacy

MeterLuma has no analytics, advertising, publisher account service or cloud sync. Recorded usage and conversation content are not uploaded to a MeterLuma server.

- Local logs are processed on your device for usage metadata.
- Provider requests run in the native app. Credentials are sent only to the relevant provider endpoint or handled by its installed CLI.
- Optional account tokens use macOS Keychain or Windows account-bound DPAPI storage, rather than WebView preferences.
- Exports omit credentials, profile directory paths and conversation content.
- Disconnecting in MeterLuma does not sign you out of the provider or delete its original logs.

Read the full [privacy information](PRIVACY.md) before connecting a provider. Keep tokens and unredacted usage exports out of issues and screenshots.

## Availability

The [website](https://meterluma.com) introduces the desktop app, its providers and an interactive preview using sample data.

MeterLuma is in development for macOS and Windows. Public desktop installers are not published yet. Follow this repository for release updates.

Working on the app? See the [developer guide](docs/development.md) for source setup, builds and checks.

## Documentation

- [Privacy and local data handling](PRIVACY.md)
- [Changelog](CHANGELOG.md)
- [Developer setup and checks](docs/development.md)
- [Build and release process](docs/release-process.md)
- [Beta testing](docs/beta-testing.md)
- [Third-party notices](THIRD_PARTY_NOTICES.txt)

Report reproducible bugs through [GitHub Issues](https://github.com/youssefrigale/MeterLuma/issues), including your operating system, app version and steps to reproduce. For a possible credential exposure, do not post the credential publicly.

## License and attribution

MeterLuma is **source available**, under the [MeterLuma Personal Use License 1.1](LICENSE). Personal, noncommercial use and private modification are permitted. Commercial use, sale and redistribution require separate permission. Making the repository public does not change those terms.

Third-party components retain their own licenses. Provider names and logos belong to their respective owners and identify those services only. MeterLuma is independent and is not affiliated with or endorsed by these providers.
