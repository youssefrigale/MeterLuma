use tauri::{Emitter, Manager, PhysicalPosition, Size, WebviewUrl, WebviewWindowBuilder};

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html".into()))
        .title("MeterLuma quick view")
        .initialization_script("window.__METERLUMA_QUICK__ = true;")
        .inner_size(360.0, 660.0)
        .decorations(false).resizable(false).visible(false).focused(false)
        .always_on_top(true).skip_taskbar(true).build()?;
    Ok(())
}

pub fn toggle(app: &tauri::AppHandle, point: Option<(f64, f64)>) {
    let Some(window) = app.get_webview_window("quick") else { return; };
    if window.is_visible().unwrap_or(false) { let _ = window.hide(); return; }
    #[cfg(target_os = "windows")]
    if position_windows(&window, point) {
        let _ = window.set_focus(); return;
    }
    if let Some((x, y)) = point {
        if let Ok(monitors) = window.available_monitors() {
            if let Some(monitor) = monitors.iter().find(|monitor| {
                let origin = monitor.position(); let size = monitor.size();
                x >= origin.x as f64 && y >= origin.y as f64 && x < origin.x as f64 + size.width as f64 && y < origin.y as f64 + size.height as f64
            }) {
                let scale = monitor.scale_factor();
                let origin = monitor.position(); let size = monitor.size();
                let logical_height = 660.0_f64.min(size.height as f64 / scale - 40.0).max(200.0);
                let logical_width = 360.0_f64.min(size.width as f64 / scale - 16.0).max(200.0);
                let width = logical_width * scale; let height = logical_height * scale;
                let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(logical_width, logical_height)));
                let left = (x - width / 2.0).clamp(origin.x as f64 + 8.0, (origin.x as f64 + size.width as f64 - width - 8.0).max(origin.x as f64 + 8.0));
                let top = if y > origin.y as f64 + size.height as f64 / 2.0 { y - height - 14.0 } else { y + 14.0 };
                let top = top.clamp(origin.y as f64 + 8.0, (origin.y as f64 + size.height as f64 - height - 8.0).max(origin.y as f64 + 8.0));
                let _ = window.set_position(PhysicalPosition::new(left as i32, top as i32));
            }
        }
    } else { let _ = window.center(); }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(target_os = "windows")]
fn position_windows(window: &tauri::WebviewWindow, point: Option<(f64, f64)>) -> bool {
    let Some(area) = super::placement::desktop_area(point) else { return false; };
    let scale = window.available_monitors().ok().and_then(|monitors| monitors.into_iter().find(|monitor| {
        monitor.position().x == area.screen.left && monitor.position().y == area.screen.top
    }).map(|monitor| monitor.scale_factor())).unwrap_or_else(|| window.scale_factor().unwrap_or(1.0));
    let width = (360.0 * scale).round() as i32;
    let height = (660.0 * scale).round() as i32;
    let (left, top) = super::placement::dock(area, width, height, point);
    // Move to the target display before measuring its actual window-frame and client margins.
    if window.set_position(PhysicalPosition::new(left, top)).is_err() { return false; }
    if window.show().is_err() { return false; }
    let Ok(handle) = window.hwnd() else { return false; };
    super::placement::fit_window(handle.0 as *mut std::ffi::c_void, area, width, height, point)
}

#[tauri::command]
pub fn show_dashboard(app: tauri::AppHandle, page: Option<String>) -> Result<(), String> {
    let page = page.as_deref().unwrap_or("dashboard");
    if !matches!(page, "dashboard" | "settings" | "connections") { return Err("Unknown page".into()); }
    app.emit_to("main", "meterluma:navigate", page).map_err(|_| "The requested page could not be opened")?;
    super::show_main(&app);
    if let Some(quick) = app.get_webview_window("quick") { let _ = quick.hide(); }
    Ok(())
}
