# Desktop usage notifications

Available in the local unreleased 0.1.2 continuation through **Settings → Desktop notifications**. Delivery currently requires the bundled Mac app. Windows and web previews show the feature as unavailable; in-app usage alerts continue working there.

Notifications start off. Reading macOS authorization does not request it. The explicit enable switch requests authorization only if needed. A denied choice stays off; **Open System Settings** opens the system app, where you can choose Notifications → MeterLuma, then return and check again. Display-preference imports and resets preserve this computer's notification choices and do not enable them.

## What fires

| Choice | Trigger | Deduplication |
| --- | --- | --- |
| Under 10% left | More than 90% and less than 100% used in a fresh returned quota | Once per selected connection, metric and reset window; unknown-reset windows use a 24-hour expiry |
| Custom thresholds | A configured enabled Claude/Codex/Cursor alert reaches its percentage | Once per rule/threshold, connection, metric and reset window |
| Pace close | Straight-line projected usage reaches 90–100% of the limit, after a healthier reading | Once in that worsening episode |
| Pace risk | Projected usage exceeds 100%, after a better reading | Once in that worsening episode |
| Reset reminder | An unexhausted returned window is within the chosen 10-minute, 1-hour, 12-hour or 24-hour lead | Once per selected lead, connection, metric and reset window |

Pace requires a known period and reset, at least 5% elapsed and usage below exhaustion. The first reading establishes a quiet baseline. Coarse pace state persists across restarts; a recovery followed by another worsening can notify again. These cutoffs describe MeterLuma's projection, not a guarantee about future usage or a provider's billing status.

Only fresh live readings qualify. Cached, expired, future-clock, history-only, disconnected, hidden and warning/error additional-provider readings are excluded. Claude also requires live-usage consent. Low-allowance, pace and reset choices support additional providers with returned quota windows; custom threshold rules currently cover Claude, Codex and Cursor. No balance, local token total or monetary amount becomes an inferred quota.

Evaluation runs after quota changes and on a lightweight 30-second timer while MeterLuma is running. A sleeping computer or suspended WebView can delay checks. Expired reminders are not replayed on wake. No additional provider request, inference, reset redemption, email or publisher service is introduced.

## Grouping and local history

At most three distinct connection/quota readings share one native notification request per minute. Higher-risk current events take precedence for the same quota; the grouped request covers its other current triggers too. Identical text from multiple accounts is shown only once, without exposing account labels. Remaining quotas can be considered at a later timer check.

Before dispatch, the app records hashed event identifiers and expiry times under `meterluma.notification-history.v1`, capped at 1,000 entries. Expired records are pruned; known-window expiry follows the returned reset plus one minute, bounded to 366 days. `meterluma.notification-pace.v1` holds at most 512 hashed metric identifiers, coarse pace levels, episode/pending-level state and expiry times. Raw account labels, profile paths, quota values, token totals, spending and credentials are absent from both stores and from notification text. These local stores are excluded from preference/usage exports and diagnostics.

Failed or uncertain native requests remain recorded as attempts and pause further dispatch; they are not described as delivered and are not replayed automatically after restart. **Clear notification history** removes both stores, allowing current low-allowance, threshold and reset events to be attempted again; pace starts with a new baseline. A storage failure stops dispatch before an unrecorded attempt can reach macOS.

The native bridge accepts only known providers, bounded quota names, fixed event kinds and up to three hashed event identifiers. No arbitrary notification text, URL, command, attachment or sound is accepted. macOS must accept the request through its completion handler; actual appearance still depends on macOS Focus, notification preferences and foreground behavior. Turning the feature off stops future requests; notifications already in Notification Center remain under macOS control.

## Verification boundary

Synthetic browser tests exercise permission refusal, opt-in, stale-data filtering, threshold grouping, pacing transitions/recovery/restart, reset boundaries, storage errors and deduplication. Rust tests validate native payload and batch limits without requesting OS authorization. Native permission inspection and notification appearance are recorded separately in the issue audit; a passing test or accepted OS request is not a claim that a banner appeared.

The Mac adapter uses Apple's [UserNotifications authorization](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications) and completion-based notification request APIs through the locked objc2 bindings. It does not use the Tauri notification plugin's desktop permission stub.
