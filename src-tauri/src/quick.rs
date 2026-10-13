use tauri::{Emitter, Manager, PhysicalPosition, Size, WebviewUrl, WebviewWindowBuilder};
use std::sync::Mutex;

pub struct QuickState(Mutex<PanelState>);
struct PanelState { height: f64, anchor: Option<(f64, f64)> }
impl Default for QuickState {
    fn default() -> Self { Self(Mutex::new(PanelState { height: 660.0, anchor: None })) }
}

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
    let state = app.state::<QuickState>();
    let height = if let Ok(mut panel) = state.0.lock() { panel.anchor = point; panel.height } else { 660.0 };
    #[cfg(target_os = "windows")]
    if position_windows(&window, point, height, false) {
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
                let logical_height = height.min(size.height as f64 / scale - 40.0).max(200.0);
                let logical_width = 360.0_f64.min(size.width as f64 / scale - 16.0).max(200.0);
                let width = logical_width * scale; let height = logical_height * scale;
                let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(logical_width, logical_height)));
                let left = (x - width / 2.0).clamp(origin.x as f64 + 8.0, (origin.x as f64 + size.width as f64 - width - 8.0).max(origin.x as f64 + 8.0));
                let top = if y > origin.y as f64 + size.height as f64 / 2.0 { y - height - 14.0 } else { y + 14.0 };
                let top = top.clamp(origin.y as f64 + 8.0, (origin.y as f64 + size.height as f64 - height - 8.0).max(origin.y as f64 + 8.0));
                let _ = window.set_position(PhysicalPosition::new(left as i32, top as i32));
            }
        }
    } else {
        let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(360.0, height)));
        let _ = window.center();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(target_os = "windows")]
fn position_windows(window: &tauri::WebviewWindow, point: Option<(f64, f64)>, logical_height: f64, keep_display: bool) -> bool {
    // Page changes must keep the panel on its current display even if the pointer moved.
    let current_center = if keep_display {
        window.outer_position().ok().zip(window.outer_size().ok()).map(|(origin, size)| (origin.x as f64 + size.width as f64 / 2.0, origin.y as f64 + size.height as f64 / 2.0))
    } else { None };
    let Some(area) = super::placement::desktop_area(current_center.or(point)) else { return false; };
    let point = if keep_display { point.or(current_center) } else { point };
    let scale = window.available_monitors().ok().and_then(|monitors| monitors.into_iter().find(|monitor| {
        monitor.position().x == area.screen.left && monitor.position().y == area.screen.top
    }).map(|monitor| monitor.scale_factor())).unwrap_or_else(|| window.scale_factor().unwrap_or(1.0));
    let width = (360.0 * scale).round() as i32;
    let height = (logical_height * scale).round() as i32;
    let (left, top) = super::placement::dock(area, width, height, point);
    // Move to the target display before measuring its actual window-frame and client margins.
    if window.set_position(PhysicalPosition::new(left, top)).is_err() { return false; }
    if window.show().is_err() { return false; }
    let Ok(handle) = window.hwnd() else { return false; };
    super::placement::fit_window(handle.0 as *mut std::ffi::c_void, area, width, height, point)
}

#[tauri::command]
pub fn resize_quick(window: tauri::WebviewWindow, app: tauri::AppHandle, height: f64) -> Result<(), String> {
    if window.label() != "quick" || !height.is_finite() || !(300.0..=660.0).contains(&height) {
        return Err("Invalid panel resize request".into());
    }
    let state = app.state::<QuickState>();
    let anchor = {
        let mut panel = state.0.lock().map_err(|_| "Panel state is unavailable")?;
        panel.height = height;
        panel.anchor
    };
    // Do not make the panel visible during startup or while the dashboard is open.
    if !window.is_visible().unwrap_or(false) { return Ok(()); }
    #[cfg(target_os = "windows")]
    {
        return if position_windows(&window, anchor, height, true) { Ok(()) } else { Err("Panel positioning failed".into()) };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = anchor;
        let position = window.outer_position().map_err(|_| "Panel position is unavailable")?;
        let monitor = window.current_monitor().map_err(|_| "Panel display is unavailable")?;
        let height = monitor.as_ref().map(|monitor| height.min(monitor.size().height as f64 / monitor.scale_factor() - 40.0).max(200.0)).unwrap_or(height);
        window.set_size(Size::Logical(tauri::LogicalSize::new(360.0, height))).map_err(|_| "Panel resize failed")?;
        let position = monitor.as_ref().map(|monitor| {
            let origin = monitor.position(); let size = monitor.size(); let scale = monitor.scale_factor();
            PhysicalPosition::new(
                position.x.clamp(origin.x + 8, (origin.x + size.width as i32 - (360.0 * scale).round() as i32 - 8).max(origin.x + 8)),
                position.y.clamp(origin.y + 8, (origin.y + size.height as i32 - (height * scale).round() as i32 - 8).max(origin.y + 8)))
        }).unwrap_or(position);
        window.set_position(position).map_err(|_| "Panel positioning failed")?;
        Ok(())
    }
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
