mod providers;
mod history;
mod pricing;
mod profiles;
mod exports;
mod quick;
mod websites;
#[cfg(any(target_os = "windows", test))]
mod placement;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }

#[tauri::command]
fn set_tray_summary(app: tauri::AppHandle, summary: String) -> Result<(), String> {
    if summary.chars().count() > 160 {
        return Err("Tray summary is too long".into());
    }
    let tray = app.tray_by_id("meterluma").ok_or("Tray is unavailable")?;
    tray.set_tooltip(Some(format!("MeterLuma · {}", summary)))
        .map_err(|_| "The tray tooltip could not be updated".into())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(quick::QuickState::default())
        .manage(history::HistoryService::default())
        .manage(providers::ProviderService::new().expect("Provider networking could not be initialized"))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| quick::toggle(app, None)))
        .invoke_handler(tauri::generate_handler![set_tray_summary, providers::refresh_provider, history::read_usage_history, profiles::validate_profile, exports::save_usage_export, quick::show_dashboard, quick::resize_quick, websites::open_provider_page, quit_app])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            quick::create(app)?;
            let show = MenuItem::with_id(app, "show", "Open MeterLuma", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit MeterLuma", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app.default_window_icon().ok_or("Application icon is missing")?.clone();
            TrayIconBuilder::with_id("meterluma")
                .icon(icon)
                .tooltip("MeterLuma · Demo preview")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => quick::toggle(app, None),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event {
                        quick::toggle(tray.app_handle(), Some((position.x, position.y)));
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick" && matches!(event, tauri::WindowEvent::Focused(false)) {
                let _ = window.hide();
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Could not hide the MeterLuma window: {error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("MeterLuma failed to start");
}
