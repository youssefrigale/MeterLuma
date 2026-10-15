#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Bounds { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopArea { pub screen: Bounds, pub work: Bounds }

/// The screen edge that holds the tray: the Windows taskbar or the macOS menu bar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge { Bottom, Top, Left, Right }

/// A tray click lies inside the bar that reserves its edge, or at the screen edge when that bar auto-hides.
/// Without such a click (menu, second launch, resize from the panel centre) use the first reserved edge.
pub fn edge(area: DesktopArea, anchor: Option<(f64, f64)>, reach: i32) -> Edge {
    let (screen, work) = (area.screen, area.work);
    let insets = [(Edge::Bottom, screen.bottom - work.bottom), (Edge::Top, work.top - screen.top), (Edge::Left, work.left - screen.left), (Edge::Right, screen.right - work.right)];
    let near = anchor.and_then(|(x, y)| insets.iter().map(|&(edge, inset)| {
        let distance = match edge { Edge::Bottom => screen.bottom as f64 - y, Edge::Top => y - screen.top as f64, Edge::Left => x - screen.left as f64, Edge::Right => screen.right as f64 - x };
        (edge, inset, distance)
    }).filter(|&(_, inset, distance)| distance <= (inset.max(0) + reach.max(0)) as f64)
        .min_by(|a, b| a.2.total_cmp(&b.2).then((a.1 <= 0).cmp(&(b.1 <= 0)))).map(|(edge, ..)| edge));
    near.or_else(|| insets.iter().find(|(_, inset)| *inset > 0).map(|(edge, _)| *edge)).unwrap_or(Edge::Bottom)
}

/// Coordinates share one unit (physical pixels on Windows, points on macOS). Snap to the tray's edge of the usable desktop.
pub fn dock(area: DesktopArea, width: i32, height: i32, anchor: Option<(f64, f64)>) -> (i32, i32) {
    let work = area.work;
    let max_x = (work.right - width).max(work.left);
    let max_y = (work.bottom - height).max(work.top);
    let x = anchor.map(|point| (point.0 - width as f64 / 2.0).round() as i32).unwrap_or(max_x).clamp(work.left, max_x);
    let y = anchor.map(|point| (point.1 - height as f64 / 2.0).round() as i32).unwrap_or(max_y).clamp(work.top, max_y);
    match edge(area, anchor, width / 4) { Edge::Bottom => (x, max_y), Edge::Top => (x, work.top), Edge::Left => (work.left, y), Edge::Right => (max_x, y) }
}

/// An auto-hidden taskbar reserves no work area. Keep its strip free so the panel meets the taskbar exactly while it is
/// shown, whether the bar is currently shown, parked with a sliver on screen, or moved fully off this display.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn reserve(area: DesktopArea, edge: Edge, bar: Bounds) -> DesktopArea {
    let (screen, mut work) = (area.screen, area.work);
    let across = |start: i32, end: i32, low: i32, high: i32| start < high && end > low;
    let tall = (bar.bottom - bar.top).clamp(0, (screen.bottom - screen.top) / 2);
    let wide = (bar.right - bar.left).clamp(0, (screen.right - screen.left) / 2);
    let horizontal = across(bar.left, bar.right, screen.left, screen.right);
    let vertical = across(bar.top, bar.bottom, screen.top, screen.bottom);
    match edge {
        Edge::Bottom if horizontal && (screen.bottom - 2 * tall..=screen.bottom).contains(&bar.top) => work.bottom = work.bottom.min(screen.bottom - tall),
        Edge::Top if horizontal && (screen.top..=screen.top + 2 * tall).contains(&bar.bottom) => work.top = work.top.max(screen.top + tall),
        Edge::Left if vertical && (screen.left..=screen.left + 2 * wide).contains(&bar.right) => work.left = work.left.max(screen.left + wide),
        Edge::Right if vertical && (screen.right - 2 * wide..=screen.right).contains(&bar.left) => work.right = work.right.min(screen.right - wide),
        _ => {}
    }
    DesktopArea { screen, work }
}

/// Translate a visible-frame origin into an outer-window origin, retaining invisible margins.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn frame_origin(outer: Bounds, visible: Bounds, target: (i32, i32)) -> (i32, i32) {
    (outer.left + target.0 - visible.left, outer.top + target.1 - visible.top)
}

/// macOS reports each display's geometry multiplied by that display's own scale, so only points form one coordinate space.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn points(position: (i32, i32), size: (u32, u32), work_position: (i32, i32), work_size: (u32, u32), scale: f64) -> DesktopArea {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let bounds = |(x, y): (i32, i32), (width, height): (u32, u32)| Bounds {
        left: (x as f64 / scale).round() as i32, top: (y as f64 / scale).round() as i32,
        right: ((x as f64 + width as f64) / scale).round() as i32, bottom: ((y as f64 + height as f64) / scale).round() as i32,
    };
    DesktopArea { screen: bounds(position, size), work: bounds(work_position, work_size) }
}

/// The display containing the point, otherwise the closest one.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn nearest(areas: &[DesktopArea], (x, y): (f64, f64)) -> Option<usize> {
    let gap = |screen: Bounds| {
        let dx = (screen.left as f64 - x).max(x - (screen.right - 1) as f64).max(0.0);
        let dy = (screen.top as f64 - y).max(y - (screen.bottom - 1) as f64).max(0.0);
        dx * dx + dy * dy
    };
    areas.iter().enumerate().min_by(|a, b| gap(a.1.screen).total_cmp(&gap(b.1.screen))).map(|(index, _)| index)
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
    #[repr(C)]
    struct AppBarData { size: u32, window: *mut c_void, message: u32, edge: u32, rect: Bounds, param: isize }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn MonitorFromPoint(point: Point, flags: u32) -> *mut c_void;
        fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
        fn GetWindowRect(window: *mut c_void, rect: *mut Bounds) -> i32;
        fn GetClientRect(window: *mut c_void, rect: *mut Bounds) -> i32;
        fn SetWindowPos(window: *mut c_void, after: *mut c_void, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }
    #[link(name = "shell32")]
    extern "system" {
        fn SHAppBarMessage(message: u32, data: *mut AppBarData) -> usize;
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
        let area = DesktopArea { screen: info.screen, work: info.work };
        Some(autohide_taskbar().map_or(area, |(edge, bar)| reserve(area, edge, bar)))
    }

    fn autohide_taskbar() -> Option<(Edge, Bounds)> {
        let mut data = AppBarData { size: std::mem::size_of::<AppBarData>() as u32, window: std::ptr::null_mut(), message: 0, edge: 0, rect: Bounds::default(), param: 0 };
        // ABM_GETSTATE reports ABS_AUTOHIDE; ABM_GETTASKBARPOS fills the edge and rectangle of the same live allocation.
        if unsafe { SHAppBarMessage(4, &mut data) } & 1 == 0 || unsafe { SHAppBarMessage(5, &mut data) } == 0 { return None; }
        Some((match data.edge { 0 => Edge::Left, 1 => Edge::Top, 2 => Edge::Right, _ => Edge::Bottom }, data.rect))
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
    fn bounds(left: i32, top: i32, right: i32, bottom: i32) -> Bounds { Bounds { left, top, right, bottom } }
    fn area() -> DesktopArea { DesktopArea { screen: bounds(0, 0, 1920, 1080), work: bounds(0, 0, 1920, 1040) } }
    fn inside(area: DesktopArea, (x, y): (i32, i32), width: i32, height: i32) -> bool {
        x >= area.work.left && y >= area.work.top && x + width <= area.work.right && y + height <= area.work.bottom
    }

    #[test]
    fn invisible_window_margins_do_not_leave_a_visible_taskbar_gap() {
        let outer = bounds(2200, 372, 2576, 1041);
        let visible = bounds(2207, 372, 2569, 1034);
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
        assert_eq!(dock(area(), 360, 660, Some((900.0, 1060.0))), (720, 380));
    }
    #[test]
    fn opening_without_click_still_docks_instead_of_centering() {
        assert_eq!(dock(area(), 360, 660, None), (1560, 380));
    }
    #[test]
    fn scaled_panel_and_negative_monitor_coordinates_stay_in_work_area() {
        let area = DesktopArea { screen: bounds(-2560, 0, 0, 1440), work: bounds(-2560, 0, 0, 1380) };
        let (x, y) = dock(area, 540, 990, Some((-2500.0, 1400.0)));
        assert_eq!((x, y), (-2560, 390)); assert_eq!(y + 990, 1380);
    }
    #[test]
    fn top_and_side_taskbars_use_their_corresponding_work_edges() {
        let top = DesktopArea { work: bounds(0, 40, 1920, 1080), ..area() };
        assert_eq!(dock(top, 360, 660, Some((1800.0, 20.0))), (1560, 40));
        let left = DesktopArea { work: bounds(60, 0, 1920, 1080), ..area() };
        assert_eq!(dock(left, 360, 660, Some((20.0, 800.0))), (60, 420));
        assert_eq!(dock(left, 360, 660, Some((20.0, 200.0))), (60, 0));
        let right = DesktopArea { work: bounds(0, 0, 1860, 1080), ..area() };
        assert_eq!(dock(right, 360, 660, Some((1900.0, 800.0))), (1500, 420));
        for (area, click) in [(top, (1800.0, 20.0)), (left, (20.0, 800.0)), (right, (1900.0, 800.0))] {
            assert!(inside(area, dock(area, 360, 660, Some(click)), 360, 660));
        }
    }
    #[test]
    fn taskbar_edges_are_used_even_without_a_click() {
        assert_eq!(dock(DesktopArea { work: bounds(0, 40, 1920, 1080), ..area() }, 360, 660, None), (1560, 40));
        assert_eq!(dock(DesktopArea { work: bounds(60, 0, 1920, 1080), ..area() }, 360, 660, None), (60, 420));
        assert_eq!(dock(DesktopArea { work: bounds(0, 0, 1860, 1080), ..area() }, 360, 660, None), (1500, 420));
    }
    #[test]
    fn auto_hidden_taskbar_follows_the_edge_that_was_clicked() {
        let hidden = DesktopArea { screen: bounds(0, 0, 1920, 1080), work: bounds(0, 0, 1920, 1080) };
        assert_eq!(edge(hidden, Some((1700.0, 1070.0)), 90), Edge::Bottom);
        assert_eq!(dock(hidden, 360, 660, Some((1700.0, 1070.0))), (1520, 420));
        assert_eq!(dock(hidden, 360, 660, Some((1700.0, 10.0))), (1520, 0));
        assert_eq!(dock(hidden, 360, 660, Some((10.0, 900.0))), (0, 420));
        assert_eq!(dock(hidden, 360, 660, Some((1910.0, 300.0))), (1560, 0));
        // Without a click near any edge (menu, panel centre) the panel falls back to the bottom-right corner.
        assert_eq!(dock(hidden, 360, 660, Some((1740.0, 750.0))), (1560, 420));
        assert_eq!(dock(hidden, 360, 660, None), (1560, 420));
    }
    #[test]
    fn auto_hidden_taskbar_strip_is_kept_free_while_shown_parked_or_off_screen() {
        let hidden = DesktopArea { screen: bounds(0, 0, 1920, 1080), work: bounds(0, 0, 1920, 1080) };
        for bar in [bounds(0, 1032, 1920, 1080), bounds(0, 1078, 1920, 1126), bounds(0, 1080, 1920, 1128)] {
            let area = reserve(hidden, Edge::Bottom, bar);
            assert_eq!(area.work, bounds(0, 0, 1920, 1032));
            assert_eq!(dock(area, 360, 660, Some((1700.0, 1060.0))).1 + 660, 1032);
        }
        assert_eq!(reserve(hidden, Edge::Top, bounds(0, -46, 1920, 2)).work, bounds(0, 48, 1920, 1080));
        assert_eq!(reserve(hidden, Edge::Left, bounds(-60, 0, 2, 1080)).work, bounds(62, 0, 1920, 1080));
        assert_eq!(reserve(hidden, Edge::Right, bounds(1918, 0, 1980, 1080)).work, bounds(0, 0, 1858, 1080));
        // A taskbar on another display, or a visible taskbar that already reserves its strip, changes nothing.
        assert_eq!(reserve(hidden, Edge::Bottom, bounds(1920, 1032, 4480, 1080)), hidden);
        assert_eq!(reserve(hidden, Edge::Bottom, bounds(0, 2112, 1920, 2160)), hidden);
        assert_eq!(reserve(area(), Edge::Bottom, bounds(0, 1040, 1920, 1080)), area());
    }
    #[test]
    fn every_scale_factor_meets_the_taskbar_exactly() {
        for (scale, screen) in [(1.0, (1920, 1080)), (1.25, (1920, 1080)), (1.5, (2560, 1440)), (2.0, (3840, 2160))] {
            let bar = (48.0_f64 * scale).round() as i32;
            let area = DesktopArea { screen: bounds(0, 0, screen.0, screen.1), work: bounds(0, 0, screen.0, screen.1 - bar) };
            let (width, height) = ((360.0_f64 * scale).round() as i32, (660.0_f64 * scale).round() as i32);
            let click = (screen.0 as f64 - 140.0 * scale, screen.1 as f64 - bar as f64 / 2.0);
            let (x, y) = dock(area, width, height, Some(click));
            assert_eq!(y + height, area.work.bottom, "scale {scale}");
            assert!(inside(area, (x, y), width, height), "scale {scale}");
            assert_eq!(edge(area, Some(click), width / 4), Edge::Bottom, "scale {scale}");
        }
    }
    #[test]
    fn panel_taller_than_a_scaled_work_area_starts_at_its_top() {
        // 1920 x 1080 at 175 %: a 660-point panel is taller than the work area and fit_window shortens it.
        let area = DesktopArea { screen: bounds(0, 0, 1920, 1080), work: bounds(0, 0, 1920, 996) };
        assert_eq!(dock(area, 630, 1155, Some((1700.0, 1040.0))), (1290, 0));
    }
    #[test]
    fn panel_that_fills_a_small_work_area_stays_inside_it() {
        let small = DesktopArea { screen: bounds(0, 0, 800, 600), work: bounds(0, 0, 800, 560) };
        assert_eq!(dock(small, 360, 560, Some((20.0, 580.0))), (0, 0));
    }
    #[test]
    fn tray_on_a_secondary_monitor_stays_on_that_monitor() {
        // Main display at the origin, the taskbar with the tray on a 150 % display to its right and higher up.
        let secondary = DesktopArea { screen: bounds(1920, -360, 4480, 1080), work: bounds(1920, -360, 4480, 1008) };
        let (x, y) = dock(secondary, 540, 990, Some((4300.0, 1044.0)));
        assert_eq!((x, y), (3940, 18)); assert!(inside(secondary, (x, y), 540, 990));
        // A display to the left of the main one has negative coordinates; a click near its left edge stays on it.
        let left = DesktopArea { screen: bounds(-1920, -200, 0, 880), work: bounds(-1920, -200, 0, 832) };
        let (x, y) = dock(left, 360, 660, Some((-1900.0, 860.0)));
        assert_eq!((x, y), (-1920, 172)); assert!(inside(left, (x, y), 360, 660));
    }
    #[test]
    fn macos_menu_bar_wins_over_the_dock() {
        // Points: a 1512 x 982 display with a 37-point menu bar, the Dock at the bottom or on the right.
        let bottom_dock = DesktopArea { screen: bounds(0, 0, 1512, 982), work: bounds(0, 37, 1512, 912) };
        assert_eq!(dock(bottom_dock, 360, 600, Some((1300.0, 18.0))), (1120, 37));
        let right_dock = DesktopArea { screen: bounds(0, 0, 1512, 982), work: bounds(0, 37, 1440, 982) };
        assert_eq!(dock(right_dock, 360, 600, Some((1300.0, 18.0))), (1080, 37));
        assert_eq!(dock(right_dock, 360, 600, Some((1435.0, 30.0))), (1080, 37));
        let hidden_menu_bar = DesktopArea { screen: bounds(0, 0, 1512, 982), work: bounds(0, 0, 1512, 912) };
        assert_eq!(dock(hidden_menu_bar, 360, 600, Some((1512.0, 0.0))), (1152, 0));
    }
    #[test]
    fn mixed_scale_displays_convert_to_one_point_space() {
        // A 2x Retina main display and a 1x display to its right, as tao reports them in physical pixels.
        let retina = points((0, 0), (2880, 1800), (0, 50), (2880, 1750), 2.0);
        let external = points((1440, 0), (1920, 1080), (1440, 25), (1920, 1055), 1.0);
        assert_eq!(retina, DesktopArea { screen: bounds(0, 0, 1440, 900), work: bounds(0, 25, 1440, 900) });
        assert_eq!(external.screen, bounds(1440, 0, 3360, 1080));
        let areas = [retina, external];
        assert_eq!(nearest(&areas, (1300.0, 10.0)), Some(0));
        assert_eq!(nearest(&areas, (2000.0, 10.0)), Some(1));
        assert_eq!(nearest(&areas, (1440.0, 10.0)), Some(1));
        assert_eq!(nearest(&areas, (5000.0, -40.0)), Some(1));
        assert_eq!(nearest(&[], (0.0, 0.0)), None);
        assert_eq!(points((0, 0), (100, 100), (0, 0), (100, 100), 0.0).screen, bounds(0, 0, 100, 100));
    }
}
