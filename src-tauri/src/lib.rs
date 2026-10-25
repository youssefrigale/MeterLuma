mod providers;
mod history;
mod pricing;
mod profiles;
mod exports;
mod quick;
mod websites;
mod placement;

use std::time::{Duration, SystemTime};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }

/// Windows keeps 127 UTF-16 units of a notification-area tooltip; shorten on a character boundary instead.
fn tooltip(summary: &str) -> String {
    let text = format!("MeterLuma · {summary}");
    if text.encode_utf16().count() <= 127 { return text; }
    let mut units = 0;
    let mut short: String = text.chars().take_while(|character| { units += character.len_utf16(); units <= 126 }).collect();
    short.push('…');
    short
}

#[tauri::command]
fn set_tray_summary(app: tauri::AppHandle, summary: String) -> Result<(), String> {
    if summary.chars().count() > 160 {
        return Err("Tray summary is too long".into());
    }
    let tray = app.tray_by_id("meterluma").ok_or("Tray is unavailable")?;
    tray.set_tooltip(Some(tooltip(&summary)))
        .map_err(|_| "The tray tooltip could not be updated".into())
}

const UPDATE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// The release workflow embeds `plugins.updater` only when signing keys exist. The plugin refuses to start without a
/// public key or with a non-HTTPS endpoint, so it is registered only when the embedded configuration has both.
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
fn updater_configured(config: Option<&serde_json::Value>) -> bool {
    config.is_some_and(|config| config.get("pubkey").and_then(|key| key.as_str()).is_some_and(|key| !key.trim().is_empty())
        && config.get("endpoints").and_then(|endpoints| endpoints.as_array()).is_some_and(|endpoints| !endpoints.is_empty()
            && endpoints.iter().all(|endpoint| endpoint.as_str().is_some_and(|endpoint| endpoint.starts_with("https://")))))
}

/// Wall-clock time, so a computer that sleeps through the day still checks once a day.
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
fn update_due(last: Option<SystemTime>, now: SystemTime) -> bool {
    last.is_none_or(|last| now.duration_since(last).map_or(true, |elapsed| elapsed >= UPDATE_INTERVAL))
}

#[cfg(feature = "updater")]
mod updates {
    use std::{sync::atomic::{AtomicBool, Ordering}, time::{Duration, SystemTime}};
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    static BUSY: AtomicBool = AtomicBool::new(false);
    static ASKED: AtomicBool = AtomicBool::new(false);

    /// The plugin parses `plugins.updater` while the app starts and aborts start-up if that fails, so parse it first.
    pub fn accepts(config: Option<&serde_json::Value>) -> bool {
        config.is_some_and(|config| super::updater_configured(Some(config)) && serde_json::from_value::<tauri_plugin_updater::Config>(config.clone()).is_ok())
    }

    pub fn schedule(app: &tauri::AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(30));
            let mut last = None;
            loop {
                if super::update_due(last, SystemTime::now()) && check(&app, false) { last = Some(SystemTime::now()); }
                std::thread::sleep(Duration::from_secs(15 * 60));
            }
        });
    }

    /// From the tray menu. A check already running reports its result as if asked.
    pub fn check_now(app: &tauri::AppHandle) {
        ASKED.store(true, Ordering::SeqCst);
        let app = app.clone();
        std::thread::spawn(move || { check(&app, true); });
    }

    // Runs on its own thread: the dialogs block until answered and must not run on the main thread.
    fn check(app: &tauri::AppHandle, asked: bool) -> bool {
        if BUSY.swap(true, Ordering::SeqCst) { return false; }
        let result = tauri::async_runtime::block_on(async { app.updater()?.check().await });
        // A failed check is retried at the next 15-minute poll instead of waiting a day.
        let checked = result.is_ok();
        let asked = asked || ASKED.load(Ordering::SeqCst);
        match result {
            Ok(Some(update)) => {
                let question = format!("MeterLuma {} is available. You have version {}.\n\nDownload and install it now? MeterLuma restarts to finish the update.", update.version, env!("CARGO_PKG_VERSION"));
                let install = app.dialog().message(question).title("Update available").kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom("Install and restart".into(), "Later".into())).blocking_show();
                if install {
                    match tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {})) {
                        Ok(()) => app.restart(),
                        Err(error) => tell(app, MessageDialogKind::Error, "Update failed", format!("The update could not be installed. {error}")),
                    }
                }
            }
            Ok(None) if asked => tell(app, MessageDialogKind::Info, "MeterLuma is up to date", format!("Version {} is the latest version.", env!("CARGO_PKG_VERSION"))),
            Err(error) if asked => tell(app, MessageDialogKind::Error, "Update check failed", format!("MeterLuma could not check for updates. {error}")),
            Err(error) => eprintln!("Automatic update check failed: {error}"),
            Ok(None) => {}
        }
        ASKED.store(false, Ordering::SeqCst);
        BUSY.store(false, Ordering::SeqCst);
        checked
    }

    fn tell(app: &tauri::AppHandle, kind: MessageDialogKind, title: &str, message: String) {
        app.dialog().message(message).title(title).kind(kind).buttons(MessageDialogButtons::Ok).blocking_show();
    }
}

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(feature = "updater")]
    let updates = updates::accepts(context.config().plugins.0.get("updater"));
    #[cfg(not(feature = "updater"))]
    let updates = false;
    let builder = tauri::Builder::default()
        // First, so a second launch hands over to the running app before any other plugin starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| quick::open(app, None)))
        .plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "updater")]
    let builder = if updates { builder.plugin(tauri_plugin_updater::Builder::new().build()) } else { builder };
    builder
        .manage(quick::QuickState::default())
        .manage(history::HistoryService::default())
        .invoke_handler(tauri::generate_handler![set_tray_summary, providers::refresh_provider, providers::manual::connect_account_token, providers::manual::forget_account_token, history::read_usage_history, profiles::validate_profile, profiles::discover_local_providers, exports::save_usage_export, quick::resize_quick, websites::open_provider_page, quit_app])
        .setup(move |app| {
            // Created here rather than on the builder so a second instance exits before touching the provider caches.
            app.manage(providers::ProviderService::new().map_err(|error| format!("Provider networking could not be initialized: {error}"))?);
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            quick::create(app)?;
            let version = MenuItem::with_id(app, "version", format!("MeterLuma {}", env!("CARGO_PKG_VERSION")), false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Open MeterLuma", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit MeterLuma", true, None::<&str>)?;
            let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&version, &separator, &show];
            if updates { items.push(&update); }
            items.push(&quit);
            let menu = Menu::with_items(app, &items)?;
            let icon = app.default_window_icon().ok_or("Application icon is missing")?.clone();
            TrayIconBuilder::with_id("meterluma")
                .icon(icon)
                .tooltip("MeterLuma")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => quick::open(app, None),
                    #[cfg(feature = "updater")]
                    "update" => updates::check_now(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, position, .. } => quick::tray_click(tray.app_handle(), (position.x, position.y)),
                    // Windows only. The second press blurs and hides the panel, so a double click ends with it open.
                    TrayIconEvent::DoubleClick { button: MouseButton::Left, position, .. } => quick::open(tray.app_handle(), Some((position.x, position.y))),
                    _ => {}
                })
                .build(app)?;
            #[cfg(feature = "updater")]
            if updates { updates::schedule(app.handle()); }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(false) if window.label() == "quick" => quick::blurred(window),
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Could not hide the MeterLuma window: {error}");
                }
            }
            _ => {}
        })
        .run(context)
        .expect("MeterLuma failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn tray_tooltip_is_neutral_and_fits_the_windows_limit() {
        assert_eq!(tooltip("Codex 42% left"), "MeterLuma · Codex 42% left");
        let long = tooltip(&"Cursor 80% · ".repeat(12));
        assert_eq!(long.encode_utf16().count(), 127);
        assert!(long.ends_with('…'));
        let wide = tooltip(&"😀".repeat(80));
        assert!(wide.encode_utf16().count() <= 127 && wide.ends_with('…'));
    }
    #[test]
    fn updater_starts_only_with_a_key_and_https_endpoints() {
        let endpoint = json!(["https://updates.example.com/{{target}}/{{arch}}/{{current_version}}"]);
        assert!(updater_configured(Some(&json!({ "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6", "endpoints": endpoint }))));
        assert!(!updater_configured(None));
        assert!(!updater_configured(Some(&json!({ "endpoints": endpoint }))));
        assert!(!updater_configured(Some(&json!({ "pubkey": "  ", "endpoints": endpoint }))));
        assert!(!updater_configured(Some(&json!({ "pubkey": "key", "endpoints": [] }))));
        assert!(!updater_configured(Some(&json!({ "pubkey": "key", "endpoints": ["http://updates.example.com/latest.json"] }))));
        assert!(!updater_configured(Some(&json!({ "pubkey": "key", "endpoints": "https://updates.example.com/latest.json" }))));
    }
    #[cfg(feature = "updater")]
    #[test]
    fn updater_plugin_is_skipped_when_its_configuration_would_abort_start_up() {
        let endpoints = json!(["https://updates.example.com/latest.json"]);
        assert!(updates::accepts(Some(&json!({ "pubkey": "key", "endpoints": endpoints }))));
        assert!(updates::accepts(Some(&json!({ "pubkey": "key", "endpoints": endpoints, "windows": { "installMode": "passive" } }))));
        assert!(!updates::accepts(Some(&json!({ "pubkey": "key", "endpoints": endpoints, "windows": { "installMode": "sideways" } }))));
        assert!(!updates::accepts(Some(&json!({ "endpoints": endpoints }))));
        assert!(!updates::accepts(None));
    }
    #[test]
    fn update_check_runs_at_start_and_then_daily() {
        let now = SystemTime::now();
        assert!(update_due(None, now));
        assert!(!update_due(Some(now), now + Duration::from_secs(60 * 60)));
        assert!(!update_due(Some(now), now + UPDATE_INTERVAL - Duration::from_secs(1)));
        assert!(update_due(Some(now), now + UPDATE_INTERVAL));
        // A clock set backwards does not postpone the next check indefinitely.
        assert!(update_due(Some(now + Duration::from_secs(3600)), now));
    }
}
