#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Bounds { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

#[derive(Clone, Copy, Debug)]
pub struct DesktopArea { pub screen: Bounds, pub work: Bounds }

/// Coordinates are physical pixels. Snap to the taskbar's edge of the usable desktop.
pub fn dock(area: DesktopArea, width: i32, height: i32, anchor: Option<(f64, f64)>) -> (i32, i32) {
    let work = area.work;
    let max_x = (work.right - width).max(work.left);
    let max_y = (work.bottom - height).max(work.top);
    let x = anchor.map(|point| (point.0 - width as f64 / 2.0).round() as i32).unwrap_or(max_x).clamp(work.left, max_x);
    let y = anchor.map(|point| (point.1 - height as f64 / 2.0).round() as i32).unwrap_or(max_y).clamp(work.top, max_y);
    if work.bottom < area.screen.bottom { (x, max_y) }
    else if work.top > area.screen.top { (x, work.top) }
    else if work.left > area.screen.left { (work.left, y) }
    else if work.right < area.screen.right { (max_x, y) }
    else { (x, max_y) }
}

/// Translate a visible-frame origin into an outer-window origin, retaining invisible margins.
pub fn frame_origin(outer: Bounds, visible: Bounds, target: (i32, i32)) -> (i32, i32) {
    (outer.left + target.0 - visible.left, outer.top + target.1 - visible.top)
}

#[cfg(target_os = "windows")]
pub use windows::{desktop_area, fit_window};

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Point { x: i32, y: i32 }
    #[repr(C)]
    #[derive(Default)]
    struct MonitorInfo { size: u32, screen: Bounds, work: Bounds, flags: u32 }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn MonitorFromPoint(point: Point, flags: u32) -> *mut c_void;
        fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
        fn GetWindowRect(window: *mut c_void, rect: *mut Bounds) -> i32;
        fn GetClientRect(window: *mut c_void, rect: *mut Bounds) -> i32;
        fn SetWindowPos(window: *mut c_void, after: *mut c_void, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(window: *mut c_void, attribute: u32, value: *mut Bounds, size: u32) -> i32;
    }
    pub fn desktop_area(point: Option<(f64, f64)>) -> Option<DesktopArea> {
    let mut cursor = Point::default();
    if let Some((x, y)) = point { cursor = Point { x: x.round() as i32, y: y.round() as i32 }; }
    // Win32 writes into correctly sized, live stack allocations; no returned pointers are dereferenced.
    else if unsafe { GetCursorPos(&mut cursor) } == 0 { return None; }
    let monitor = unsafe { MonitorFromPoint(cursor, 2) }; // MONITOR_DEFAULTTONEAREST
    if monitor.is_null() { return None; }
    let mut info = MonitorInfo { size: std::mem::size_of::<MonitorInfo>() as u32, ..Default::default() };
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 { return None; }
    Some(DesktopArea { screen: info.screen, work: info.work })
    }

    fn visible_frame(window: *mut c_void, fallback: Bounds) -> Bounds {
        let mut frame = Bounds::default();
        // The window is shown before this query. The output allocation matches Win32 RECT.
        if unsafe { DwmGetWindowAttribute(window, 9, &mut frame, std::mem::size_of::<Bounds>() as u32) } >= 0
            && frame.right > frame.left && frame.bottom > frame.top { frame } else { fallback }
    }

    pub fn fit_window(window: *mut c_void, area: DesktopArea, width: i32, height: i32, anchor: Option<(f64, f64)>) -> bool {
        let mut outer = Bounds::default(); let mut client = Bounds::default();
        // These calls use an OS-managed HWND and correctly sized, live output allocations.
        if unsafe { GetWindowRect(window, &mut outer) } == 0 || unsafe { GetClientRect(window, &mut client) } == 0 { return false; }
        let frame = visible_frame(window, outer);
        let client_width = client.right - client.left; let client_height = client.bottom - client.top;
        if client_width <= 0 || client_height <= 0 { return false; }
        let visible_extra_width = (frame.right - frame.left - client_width).max(0);
        let visible_extra_height = (frame.bottom - frame.top - client_height).max(0);
        let client_width_target = width.min(area.work.right - area.work.left - visible_extra_width).max(1);
        let client_height_target = height.min(area.work.bottom - area.work.top - visible_extra_height).max(1);
        let outer_width = client_width_target + outer.right - outer.left - client_width;
        let outer_height = client_height_target + outer.bottom - outer.top - client_height;
        // Resize using measured client-to-frame margins, avoiding an assumed Windows caption size.
        if unsafe { SetWindowPos(window, std::ptr::null_mut(), 0, 0, outer_width, outer_height, 0x0002 | 0x0004 | 0x0010) } == 0 { return false; }
        if unsafe { GetWindowRect(window, &mut outer) } == 0 { return false; }
        let frame = visible_frame(window, outer);
        let target = dock(area, frame.right - frame.left, frame.bottom - frame.top, anchor);
        let (left, top) = frame_origin(outer, frame, target);
        unsafe { SetWindowPos(window, std::ptr::null_mut(), left, top, 0, 0, 0x0001 | 0x0004 | 0x0010) != 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn area() -> DesktopArea {
        DesktopArea { screen: Bounds { left: 0, top: 0, right: 1920, bottom: 1080 }, work: Bounds { left: 0, top: 0, right: 1920, bottom: 1040 } }
    }
    #[test]
    fn invisible_window_margins_do_not_leave_a_visible_taskbar_gap() {
        let outer = Bounds { left: 2200, top: 372, right: 2576, bottom: 1041 };
        let visible = Bounds { left: 2207, top: 372, right: 2569, bottom: 1034 };
        let target = (2198, 370);
        let moved = frame_origin(outer, visible, target);
        assert_eq!(moved, (2191, 370));
        assert_eq!(visible.bottom + moved.1 - outer.top, 1032);
        assert_eq!(visible.right + moved.0 - outer.left, 2560);
    }
    #[test]
    fn tray_click_lands_exactly_above_bottom_taskbar() {
        let (x, y) = dock(area(), 360, 660, Some((1880.0, 1060.0)));
        assert_eq!((x, y), (1560, 380)); assert_eq!(y + 660, 1040);
    }
    #[test]
    fn opening_without_click_still_docks_instead_of_centering() {
        assert_eq!(dock(area(), 360, 660, None), (1560, 380));
    }
    #[test]
    fn scaled_panel_and_negative_monitor_coordinates_stay_in_work_area() {
        let area = DesktopArea { screen: Bounds { left: -2560, top: 0, right: 0, bottom: 1440 }, work: Bounds { left: -2560, top: 0, right: 0, bottom: 1380 } };
        let (x, y) = dock(area, 540, 990, Some((-2500.0, 1400.0)));
        assert_eq!((x, y), (-2560, 390)); assert_eq!(y + 990, 1380);
    }
    #[test]
    fn top_and_side_taskbars_use_their_corresponding_work_edges() {
        let mut top = area(); top.work.top = 40; top.work.bottom = 1080;
        assert_eq!(dock(top, 360, 660, Some((1800.0, 20.0))).1, 40);
        let mut left = area(); left.work.left = 60; left.work.bottom = 1080;
        assert_eq!(dock(left, 360, 660, Some((20.0, 800.0))).0, 60);
        let mut right = area(); right.work.right = 1860; right.work.bottom = 1080;
        assert_eq!(dock(right, 360, 660, Some((1900.0, 800.0))).0 + 360, 1860);
    }
    #[test]
    fn panel_that_fills_a_small_work_area_stays_inside_it() {
        let small = DesktopArea { screen: Bounds { left: 0, top: 0, right: 800, bottom: 600 }, work: Bounds { left: 0, top: 0, right: 800, bottom: 560 } };
        assert_eq!(dock(small, 360, 560, Some((20.0, 580.0))), (0, 0));
    }
}
