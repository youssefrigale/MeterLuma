use tauri::{Manager, Size, WebviewUrl, WebviewWindowBuilder};
use std::{sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::{Duration, Instant}};

const DEFAULT_PANEL_HEIGHT: f64 = if cfg!(target_os = "macos") { 440.0 } else { 660.0 };

pub struct QuickState(Mutex<PanelState>);
// The anchor uses the platform's placement unit: physical pixels on Windows, points elsewhere.
struct PanelState { height: f64, anchor: Option<(f64, f64)>, blurred: Option<Instant> }
impl Default for QuickState {
    fn default() -> Self { Self(Mutex::new(PanelState { height: DEFAULT_PANEL_HEIGHT, anchor: None, blurred: None })) }
}

/// Clicking the tray icon to dismiss the panel blurs it on mouse-down (the taskbar takes focus) and only then
/// delivers the click on mouse-up. That click must not reopen the panel it just hid.
const REOPEN_GRACE: Duration = Duration::from_millis(300);
fn ignores_tray_click(blurred: Option<Instant>, now: Instant) -> bool {
    blurred.is_some_and(|at| now.saturating_duration_since(at) < REOPEN_GRACE)
}

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    let window = WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html".into()))
        .title("MeterLuma")
        .inner_size(360.0, DEFAULT_PANEL_HEIGHT)
        .decorations(false).resizable(false).visible(false).focused(false)
        .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true).build()?;
    #[cfg(target_os = "macos")]
    configure_macos_panel(&window)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_panel(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use objc2_app_kit::{NSColor, NSWindow, NSWindowCollectionBehavior};
    // Tauri owns this NSWindow; setup runs on the AppKit main thread and the borrow stays within setup.
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    let content = native.contentView().ok_or(tauri::Error::InvalidWindowHandle)?;
    content.setWantsLayer(true);
    let layer = content.layer().ok_or(tauri::Error::InvalidWindowHandle)?;
    // Clip the entire WebView hierarchy, including its opaque document background, at the native boundary.
    layer.setOpaque(false);
    layer.setCornerRadius(14.0);
    layer.setMasksToBounds(true);
    native.setOpaque(false);
    native.setBackgroundColor(Some(&NSColor::clearColor()));
    native.setHasShadow(true);
    native.invalidateShadow();
    native.setCollectionBehavior(native.collectionBehavior() | NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
    Ok(())
}

/// Set while a native dialog opened from the panel is showing. The dialog takes focus, but the panel must stay open behind it.
static DIALOG: AtomicBool = AtomicBool::new(false);
static PINNED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn panel_pinned() -> bool { PINNED.load(Ordering::SeqCst) }

#[tauri::command]
pub fn set_panel_pinned(pinned: bool) -> bool { PINNED.store(pinned, Ordering::SeqCst); panel_pinned() }

/// Keep the panel open while `show` runs a native dialog owned by it, then give the panel focus back.
pub fn with_dialog<T>(window: &tauri::WebviewWindow, show: impl FnOnce() -> T) -> T {
    DIALOG.store(true, Ordering::SeqCst);
    let result = show();
    DIALOG.store(false, Ordering::SeqCst);
    if window.is_visible().unwrap_or(false) { let _ = window.set_focus(); }
    result
}

/// Unpinned panels hide on blur. Remember when, so the tray click that caused the blur does not reopen them.
pub fn blurred(window: &tauri::Window) {
    if DIALOG.load(Ordering::SeqCst) || panel_pinned() || !window.is_visible().unwrap_or(false) { return; }
    let _ = window.hide();
    if let Ok(mut panel) = window.state::<QuickState>().0.lock() { panel.blurred = Some(Instant::now()); }
}

/// Left click on the tray icon: show the panel, or hide it when it is already open.
pub fn tray_click(app: &tauri::AppHandle, point: (f64, f64)) {
    let state = app.state::<QuickState>();
    if state.0.lock().map(|mut panel| ignores_tray_click(panel.blurred.take(), Instant::now())).unwrap_or(false) { return; }
    let Some(window) = app.get_webview_window("quick") else { return; };
    if window.is_visible().unwrap_or(false) { let _ = window.hide(); return; }
    open(app, Some(point));
}

/// Show the panel docked at the tray. `point` is the tray click, if there was one.
pub fn open(app: &tauri::AppHandle, point: Option<(f64, f64)>) {
    let Some(window) = app.get_webview_window("quick") else { return; };
    let state = app.state::<QuickState>();
    let height = state.0.lock().map(|panel| panel.height).unwrap_or(DEFAULT_PANEL_HEIGHT);
    let anchor = place(app, &window, point, height);
    if let Ok(mut panel) = state.0.lock() { panel.anchor = anchor; }
    let _ = window.show();
    let _ = window.set_focus();
}

fn center(window: &tauri::WebviewWindow, height: f64) {
    let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(360.0, height)));
    let _ = window.center();
}

#[cfg(target_os = "windows")]
fn place(_app: &tauri::AppHandle, window: &tauri::WebviewWindow, point: Option<(f64, f64)>, height: f64) -> Option<(f64, f64)> {
    if !position_windows(window, point, height, false) { center(window, height); }
    point
}

#[cfg(not(target_os = "windows"))]
fn place(app: &tauri::AppHandle, window: &tauri::WebviewWindow, point: Option<(f64, f64)>, height: f64) -> Option<(f64, f64)> {
    // Read the current status-item frame even for app, menu and shortcut opens.
    // The event coordinates mix display scales; the cursor is only a fallback.
    let cursor = cursor_point(app);
    #[cfg(target_os = "macos")]
    let anchor = super::tray_status::anchor(app).or(point.and(cursor));
    #[cfg(not(target_os = "macos"))]
    let anchor = point.and(cursor);
    let anchor = position_points(window, anchor, cursor, height);
    if anchor.is_none() { center(window, height); }
    anchor
}

/// The cursor in points. tao reports the macOS cursor in points multiplied by the main display's scale.
#[cfg(not(target_os = "windows"))]
fn cursor_point(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let scale = app.primary_monitor().ok().flatten().map(|monitor| monitor.scale_factor()).filter(|scale| *scale > 0.0).unwrap_or(1.0);
    app.cursor_position().ok().map(|point| (point.x / scale, point.y / scale))
}

/// Dock the panel in points on the display holding `anchor` (else `hint`). Returns the anchor it used, which is the
/// status item or tray click, with a screen-edge fallback if neither is available.
#[cfg(not(target_os = "windows"))]
fn position_points(window: &tauri::WebviewWindow, anchor: Option<(f64, f64)>, hint: Option<(f64, f64)>, logical_height: f64) -> Option<(f64, f64)> {
    let areas: Vec<_> = window.available_monitors().ok()?.iter().map(|monitor| {
        let work = monitor.work_area();
        super::placement::points((monitor.position().x, monitor.position().y), (monitor.size().width, monitor.size().height), (work.position.x, work.position.y), (work.size.width, work.size.height), monitor.scale_factor())
    }).collect();
    let area = *areas.get(super::placement::nearest(&areas, anchor.or(hint)?)?)?;
    #[cfg(target_os = "macos")]
    let area = super::placement::menu_panel_area(area);
    let anchor = anchor.unwrap_or((area.work.right as f64, area.screen.top as f64));
    let width = 360.min(area.work.right - area.work.left).max(1);
    let height = (logical_height.round() as i32).min(area.work.bottom - area.work.top).max(1);
    let (left, top) = super::placement::dock(area, width, height, Some(anchor));
    window.set_size(Size::Logical(tauri::LogicalSize::new(width as f64, height as f64))).ok()?;
    window.set_position(tauri::LogicalPosition::new(left as f64, top as f64)).ok()?;
    Some(anchor)
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
    if window.set_position(tauri::PhysicalPosition::new(left, top)).is_err() { return false; }
    if window.show().is_err() { return false; }
    let Ok(handle) = window.hwnd() else { return false; };
    super::placement::fit_window(handle.0, area, width, height, point)
}

#[tauri::command]
pub fn resize_quick(window: tauri::WebviewWindow, app: tauri::AppHandle, height: Option<f64>) -> Result<(), String> {
    let height = height.unwrap_or(DEFAULT_PANEL_HEIGHT);
    let maximum = if cfg!(target_os = "macos") { 4096.0 } else { 660.0 };
    if window.label() != "quick" || !height.is_finite() || !(300.0..=maximum).contains(&height) {
        return Err("Invalid panel resize request".into());
    }
    let state = app.state::<QuickState>();
    let anchor = {
        let mut panel = state.0.lock().map_err(|_| "Panel state is unavailable")?;
        panel.height = height;
        panel.anchor
    };
    // Do not make the panel visible during startup or while it is hidden.
    if !window.is_visible().unwrap_or(false) { return Ok(()); }
    #[cfg(target_os = "windows")]
    {
        if position_windows(&window, anchor, height, true) { Ok(()) } else { Err("Panel positioning failed".into()) }
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let anchor = super::tray_status::anchor(&app).or(anchor);
        let current = window.outer_position().ok().zip(window.outer_size().ok()).zip(window.scale_factor().ok()).map(|((origin, size), scale)| {
            ((origin.x as f64 + size.width as f64 / 2.0) / scale, (origin.y as f64 + size.height as f64 / 2.0) / scale)
        });
        position_points(&window, anchor, current, height).map(|_| ()).ok_or_else(|| "Panel positioning failed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tray_click_right_after_a_blur_hide_is_ignored() {
        let now = Instant::now();
        assert!(ignores_tray_click(Some(now), now));
        assert!(ignores_tray_click(Some(now), now + Duration::from_millis(120)));
        assert!(ignores_tray_click(Some(now), now + Duration::from_millis(299)));
    }
    #[test]
    fn later_or_unrelated_tray_clicks_toggle_normally() {
        let now = Instant::now();
        assert!(!ignores_tray_click(None, now));
        assert!(!ignores_tray_click(Some(now), now + Duration::from_millis(300)));
        assert!(!ignores_tray_click(Some(now), now + Duration::from_secs(5)));
    }
    #[test]
    fn a_blur_timestamp_from_the_future_does_not_panic() {
        let now = Instant::now();
        assert!(ignores_tray_click(Some(now + Duration::from_millis(50)), now));
    }
}
