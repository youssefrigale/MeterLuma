# Try the MeterLuma beta

This is an internal, unsigned prototype. Start by exploring the demo and then test a provider you already use. It does not charge for Pro or rotate another app's credentials.

## Windows

Run the portable `MeterLuma-Windows.exe`, or use `MeterLuma-Windows-Setup.exe` if you want to install it. The app needs Microsoft WebView2. The owner machine has it installed and the portable executable's startup check passed.

## Mac

The universal `MeterLuma-Mac.dmg` contains both Intel and Apple Silicon builds. Code compilation and provider tests passed on a Mac runner. GUI behavior and actual local sign-ins still need testing on a real Mac; signing and notarization are not configured yet.

## Explore the app

1. Confirm the default dashboard says **Demo preview**. Sample providers show live countdowns; the spend chart is explicitly sample data.
2. In Settings, change the theme and toggle remaining allowance. Close and reopen the window to check that preferences persist.
3. Left-click the tray/menu-bar icon to open the compact view. Check that it follows provider visibility and theme changes. Its footer opens the full dashboard; clicking outside hides the compact view.
4. In Connections, select a provider's **Connection options**, then **Use local sign-in**. You must already be signed in to Claude Code, Codex CLI, or Cursor. The README lists the currently supported credential locations and limitations.
5. Compare the displayed limits and reset time with that provider's own usage screen. Record only the provider, plan, OS, and any error message when reporting a problem. Do not include credential files or tokens.
6. Disconnect the provider in MeterLuma and check that its data disappears. This does not log you out of the original provider app.
7. Use **Quit MeterLuma** in the tray menu to exit fully. Closing the dashboard window keeps the app in the tray.

Live usage is cached for five minutes and shows the actual successful fetch timestamp. Unknown spend remains unavailable. The app never substitutes sample charts or invented zero values for failed live requests.

## Release limitations

Pro history, account management, custom alerts, exports, licensing, and checkout are still planned. There is no automatic updater or startup-at-login control yet. Real-account tests, platform credential variants, multiple monitors, DPI scaling, sleep/wake, and minimum supported OS versions require further QA before public release.
