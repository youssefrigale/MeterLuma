use serde::Deserialize;
use crate::providers::ProviderId;

#[cfg(target_os = "macos")]
pub fn configure_spacing() {
    use objc2_foundation::{ns_string, NSArgumentDomain, NSMutableDictionary, NSNumber, NSUserDefaults};
    let defaults = NSUserDefaults::standardUserDefaults();
    // The argument domain is process-local: preserve launch arguments without writing system preferences.
    let domain = unsafe { NSArgumentDomain };
    let arguments = NSMutableDictionary::dictionaryWithDictionary(&defaults.volatileDomainForName(domain));
    arguments.insert(ns_string!("NSStatusItemSpacing"), &NSNumber::new_i32(0));
    // SAFETY: The existing domain has NSString keys and property-list values; the added value is numeric.
    unsafe { defaults.setVolatileDomain_forName(&arguments, domain); }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrayStatus {
    provider: String,
    remaining: Option<u8>,
    #[serde(default)]
    value: Option<String>,
    cached: bool,
    demo: bool,
    #[serde(default)]
    warning: bool,
}

impl TrayStatus {
    pub fn title(&self) -> Result<String, String> {
        if self.core_provider().is_none() && crate::providers::additional::catalog::ready(&self.provider).is_err() { return Err("Unknown menu-bar provider".into()); }
        let value = match (self.remaining, self.value.as_deref()) {
            (Some(remaining), None) if remaining <= 100 => format!("{remaining}%"),
            (None, Some(value)) if !value.is_empty() && value.chars().count() <= 48 && !value.chars().any(char::is_control) => value.to_string(),
            _ => return Err("Invalid menu-bar value".into()),
        };
        Ok(format!(" {}{value}{}", if self.demo { "Demo " } else { "" }, if self.cached { " (cached)" } else if self.warning { " ⚠" } else { "" }))
    }
    fn core_provider(&self) -> Option<ProviderId> { match self.provider.as_str() { "claude" => Some(ProviderId::Claude), "codex" => Some(ProviderId::Codex), "cursor" => Some(ProviderId::Cursor), _ => None } }

    #[cfg(target_os = "macos")]
    fn menu_icon(&self) -> Option<tauri::image::Image<'static>> {
        match self.provider.as_str() {
            "claude" => Some(tauri::include_image!("icons/providers/claude.png")),
            "codex" => Some(tauri::include_image!("icons/providers/codex.png")),
            "cursor" => Some(tauri::include_image!("icons/providers/cursor.png")),
            "opencode" => Some(tauri::include_image!("icons/providers/opencode.png")),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn tray_balances_keep_units_without_a_percentage_and_old_provider_statuses_still_decode() {
        let balance: TrayStatus = serde_json::from_value(json!({"provider":"deepseek","value":"CNY 8.76","cached":false,"demo":false})).unwrap();
        assert_eq!(balance.title().unwrap(), " CNY 8.76");
        let legacy: TrayStatus = serde_json::from_value(json!({"provider":"codex","remaining":75,"cached":false,"demo":false})).unwrap();
        assert_eq!(legacy.title().unwrap(), " 75%");
        for modified in [json!({"provider":"deepseek","remaining":101}), json!({"provider":"unknown","remaining":50}), json!({"provider":"deepseek","value":"private\nvalue"}), json!({"provider":"deepseek","value":"CNY 1.00","remaining":50})] {
            let mut payload = json!({"cached":false,"demo":false}); payload.as_object_mut().unwrap().extend(modified.as_object().unwrap().clone());
            assert!(serde_json::from_value::<TrayStatus>(payload).unwrap().title().is_err());
        }
    }
}

#[cfg(target_os = "macos")]
pub fn anchor(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    app.tray_by_id("meterluma")?.with_inner_tray_icon(|inner| {
        let main = MainThreadMarker::new()?;
        let window = inner.ns_status_item()?.button(main)?.window()?;
        let frame = window.frame();
        if frame.size.width <= 0.0 || frame.size.height <= 0.0 { return None; }
        // AppKit frames share logical points. Flipping around the main screen
        // avoids mixing Retina scales when the menu bar is on another display.
        let desktop = NSScreen::screens(main).firstObject()?.frame();
        Some(crate::placement::menu_status_anchor(
            (frame.origin.x, frame.origin.y), (frame.size.width, frame.size.height),
            desktop.origin.y + desktop.size.height,
        ))
    }).ok().flatten()
}

#[cfg(target_os = "macos")]
pub fn update(app: &tauri::AppHandle, tray: &tauri::tray::TrayIcon, status: Option<&TrayStatus>) -> Result<(), String> {
    let (icon, title, template) = if let Some(status) = status {
        let provider_icon = status.menu_icon();
        let template = provider_icon.is_some();
        let icon = provider_icon.or_else(|| app.default_window_icon().cloned()).ok_or("Application icon is missing")?;
        (icon, status.title()?, template)
    } else {
        (app.default_window_icon().ok_or("Application icon is missing")?.clone(), String::new(), false)
    };
    // AppKit recolors template images for light/dark menu bars and the highlighted state.
    tray.set_icon_with_as_template(Some(icon), template).map_err(|_| "The menu-bar icon could not be updated")?;
    tray.set_title(Some(title)).map_err(|_| "The menu-bar percentage could not be updated")?;
    size_menu_status(tray, status.map(|status| status.provider.clone()))
}

#[cfg(target_os = "macos")]
fn size_menu_status(tray: &tauri::tray::TrayIcon, provider: Option<String>) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSFont, NSImageScaling};
    tray.with_inner_tray_icon(move |inner| {
        let main = MainThreadMarker::new().ok_or("Menu-bar sizing requires the main thread")?;
        let item = inner.ns_status_item().ok_or("The menu-bar item is unavailable")?;
        let button = item.button(main).ok_or("The menu-bar button is unavailable")?;
        button.setFont(Some(&NSFont::menuBarFontOfSize(13.0)));
        let image = button.image().ok_or("The menu-bar image is unavailable")?;
        size_provider_image(&image, provider.as_deref());
        button.setImageScaling(NSImageScaling::ScaleNone);
        button.setImageHugsTitle(true);
        button.setImage(Some(&image));
        Ok(())
    }).map_err(|_| "The menu-bar sizing could not be updated")?
}

#[cfg(target_os = "macos")]
fn size_provider_image(image: &objc2_app_kit::NSImage, provider: Option<&str>) {
    let mut size = image.size();
    // OpenCode fills 20 of its 24 viewBox units; 16.2pt leaves a 13.5pt visible mark.
    let height = match provider { Some("opencode") => 16.2, Some("claude" | "codex" | "cursor") => 13.5, _ => 18.0 };
    size.width *= height / size.height;
    size.height = height;
    image.setSize(size);
}
