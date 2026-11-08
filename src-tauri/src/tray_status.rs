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

#[derive(Clone, Deserialize)]
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
        let value = self.reading()?;
        Ok(format!(" {}{value}{}", if self.demo { "Demo " } else { "" }, if self.cached { " (cached)" } else if self.warning { " ⚠" } else { "" }))
    }

    /// A whole remaining percentage, or the provider's own amount when it reports no percentage.
    fn reading(&self) -> Result<String, String> {
        if self.core_provider().is_none() && crate::providers::additional::catalog::ready(&self.provider).is_err() { return Err("Unknown menu-bar provider".into()); }
        match (self.remaining, self.value.as_deref()) {
            (Some(remaining), None) if remaining <= 100 => Ok(format!("{remaining}%")),
            (None, Some(value)) if !value.is_empty() && value.chars().count() <= 48 && !value.chars().any(char::is_control) => Ok(value.to_string()),
            _ => Err("Invalid menu-bar value".into()),
        }
    }

    /// Whether a monochrome menu-bar mark exists; other providers are named in text instead.
    fn has_mark(&self) -> bool { matches!(self.provider.as_str(), "claude" | "codex" | "cursor" | "opencode") }

    /// The text beside a provider in the strip. A cached reading is drawn dimmed rather than labeled,
    /// so it carries no warning sign, the same rule as the single title.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn strip_label(&self) -> Result<String, String> {
        let reading = self.reading()?;
        let name = if self.has_mark() { String::new() } else {
            crate::providers::additional::catalog::ready(&self.provider).map(|spec| format!("{} ", spec.name))?
        };
        Ok(format!("{name}{reading}{}", if self.warning && !self.cached { " ⚠" } else { "" }))
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


/// Several providers side by side in the macOS menu bar, chosen in Settings → Menu bar providers.
#[derive(Clone, Default)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Strip {
    items: Vec<TrayStatus>,
    more: u8,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl Strip {
    pub const MAX_ITEMS: usize = 5;

    pub fn new(items: Vec<TrayStatus>, more: u8) -> Result<Self, String> {
        if items.len() > Self::MAX_ITEMS || more > 99 || (more > 0 && items.is_empty()) {
            return Err("Invalid menu-bar providers".into());
        }
        for item in &items { item.strip_label()?; }
        Ok(Self { items, more })
    }

    /// One provider with nothing left over keeps the single icon and title.
    pub fn shows_several(&self) -> bool { self.items.len() > 1 || self.more > 0 }

    fn demo(&self) -> bool { self.items.iter().any(|item| item.demo) }
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
pub fn update(app: &tauri::AppHandle, tray: &tauri::tray::TrayIcon, status: Option<&TrayStatus>, strip: &Strip) -> Result<(), String> {
    if strip.shows_several() { return show_strip(tray, strip.clone()); }
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
        follow_button_size(&button);
        Ok(())
    }).map_err(|_| "The menu-bar sizing could not be updated")?
}

/// The tray library's click target is a subview sized to the button only when the library itself changes
/// the icon or title. Let it follow the button, so a wider reading or strip stays clickable end to end.
#[cfg(target_os = "macos")]
fn follow_button_size(button: &objc2_app_kit::NSStatusBarButton) {
    use objc2_app_kit::NSAutoresizingMaskOptions;
    let bounds = button.bounds();
    for view in button.subviews().iter() {
        if view.class().name().to_str() != Ok("TaoTrayTarget") { continue; }
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        view.setFrame(bounds);
    }
}

#[cfg(target_os = "macos")]
fn show_strip(tray: &tauri::tray::TrayIcon, strip: Strip) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSImageScaling;
    // An empty title leaves the drawn strip as the whole item.
    tray.set_title(Some("")).map_err(|_| "The menu-bar title could not be cleared")?;
    tray.with_inner_tray_icon(move |inner| {
        let main = MainThreadMarker::new().ok_or("Menu-bar drawing requires the main thread")?;
        let item = inner.ns_status_item().ok_or("The menu-bar item is unavailable")?;
        let button = item.button(main).ok_or("The menu-bar button is unavailable")?;
        let image = strip_image(&strip)?;
        button.setImageScaling(NSImageScaling::ScaleNone);
        button.setImage(Some(&image));
        follow_button_size(&button);
        Ok(())
    }).map_err(|_| "The menu-bar providers could not be updated")?
}

#[cfg(target_os = "macos")]
fn provider_mark(provider: &str) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSImage;
    let png: &'static [u8] = match provider {
        "claude" => include_bytes!("../icons/providers/claude.png"),
        "codex" => include_bytes!("../icons/providers/codex.png"),
        "cursor" => include_bytes!("../icons/providers/cursor.png"),
        "opencode" => include_bytes!("../icons/providers/opencode.png"),
        _ => return None,
    };
    let image = NSImage::initWithData(NSImage::alloc(), &objc2_foundation::NSData::with_bytes(png))?;
    size_provider_image(&image, Some(provider));
    Some(image)
}

/// Marks and readings drawn into one template image, so AppKit tints the whole strip for light and dark
/// menu bars and the highlighted state, exactly as it does the single provider icon.
#[cfg(target_os = "macos")]
fn strip_image(strip: &Strip) -> Result<objc2::rc::Retained<objc2_app_kit::NSImage>, String> {
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::{AnyObject, Bool}, AllocAnyThread};
    use objc2_app_kit::{NSAttributedStringNSStringDrawing, NSColor, NSCompositingOperation, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSImage, NSStatusBar};
    use objc2_foundation::{NSAttributedString, NSAttributedStringKey, NSDictionary, NSPoint, NSRect, NSSize, NSString};

    // Points between a mark and its reading, and between providers.
    const MARK_GAP: f64 = 4.0;
    const ITEM_GAP: f64 = 10.0;
    // A cached reading is dimmed; the tooltip and the panel name it as cached.
    const CACHED_ALPHA: f64 = 0.45;

    enum Piece { Mark(Retained<NSImage>), Text(Retained<NSAttributedString>) }
    let height = NSStatusBar::systemStatusBar().thickness();
    let font = NSFont::menuBarFontOfSize(13.0);
    let mut pieces: Vec<(Piece, NSRect, f64)> = Vec::new();
    let mut x = 0.0_f64;
    // Half-point positions stay sharp on Retina displays.
    let half = |value: f64| (value * 2.0).round() / 2.0;
    let text = |pieces: &mut Vec<(Piece, NSRect, f64)>, x: &mut f64, string: &str, alpha: f64| {
        let color = NSColor::colorWithWhite_alpha(0.0, alpha);
        // SAFETY: Both keys are AppKit's attributed-string constants, valid for the process lifetime.
        let keys: [&NSAttributedStringKey; 2] = unsafe { [NSFontAttributeName, NSForegroundColorAttributeName] };
        let values: [&AnyObject; 2] = [&font, &color];
        let attributes = NSDictionary::from_slices(&keys, &values);
        // SAFETY: The font and color attributes have the types AppKit expects for these keys.
        let string = unsafe { NSAttributedString::initWithString_attributes(NSAttributedString::alloc(), &NSString::from_str(string), Some(&attributes)) };
        let size = string.size();
        pieces.push((Piece::Text(string), NSRect::new(NSPoint::new(*x, half((height - size.height) / 2.0)), size), 1.0));
        *x += size.width.ceil();
    };

    if strip.demo() { text(&mut pieces, &mut x, "Demo", 1.0); }
    for item in &strip.items {
        if !pieces.is_empty() { x += ITEM_GAP; }
        let alpha = if item.cached { CACHED_ALPHA } else { 1.0 };
        if let Some(mark) = provider_mark(&item.provider) {
            let size = mark.size();
            // OpenCode's artwork keeps 2 of its 24 units clear on each side; spacing follows the visible mark.
            let clear = if item.provider == "opencode" { size.width / 12.0 } else { 0.0 };
            pieces.push((Piece::Mark(mark), NSRect::new(NSPoint::new(half(x - clear), half((height - size.height) / 2.0)), size), alpha));
            x += (size.width - 2.0 * clear).ceil() + MARK_GAP;
        }
        text(&mut pieces, &mut x, &item.strip_label()?, alpha);
    }
    if strip.more > 0 { x += ITEM_GAP; text(&mut pieces, &mut x, &format!("+{}", strip.more), 1.0); }

    let handler = RcBlock::new(move |_: NSRect| -> Bool {
        for (piece, rect, alpha) in &pieces {
            match piece {
                Piece::Mark(image) => image.drawInRect_fromRect_operation_fraction(*rect, NSRect::ZERO, NSCompositingOperation::SourceOver, *alpha),
                Piece::Text(string) => string.drawAtPoint(rect.origin),
            }
        }
        Bool::YES
    });
    let image = NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(x.ceil(), height), false, &handler);
    image.setTemplate(true);
    Ok(image)
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

    fn status(value: serde_json::Value) -> TrayStatus {
        let mut payload = json!({"cached":false,"demo":false}); payload.as_object_mut().unwrap().extend(value.as_object().unwrap().clone());
        serde_json::from_value(payload).unwrap()
    }

    #[test]
    fn strip_names_providers_without_a_mark_and_dims_cached_readings_without_a_warning() {
        let strip = Strip::new(vec![
            status(json!({"provider":"claude","remaining":78})),
            status(json!({"provider":"codex","remaining":12,"warning":true})),
            status(json!({"provider":"cursor","remaining":5,"warning":true,"cached":true})),
            status(json!({"provider":"deepseek","value":"CNY 8.76"})),
        ], 2).unwrap();
        let labels: Vec<String> = strip.items.iter().map(|item| item.strip_label().unwrap()).collect();
        assert_eq!(labels, ["78%", "12% ⚠", "5%", "DeepSeek CNY 8.76"]);
        assert!(strip.shows_several());
        assert!(!strip.demo());
    }

    /// Writes TIFF previews of the drawn strip: `METERLUMA_STRIP_PREVIEW=<folder> cargo test --lib strip_preview -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "writes preview images to the folder named by METERLUMA_STRIP_PREVIEW"]
    fn strip_preview() {
        let folder = std::path::PathBuf::from(std::env::var("METERLUMA_STRIP_PREVIEW").expect("METERLUMA_STRIP_PREVIEW"));
        let three = || vec![status(json!({"provider":"claude","remaining":78})), status(json!({"provider":"codex","remaining":12,"warning":true})), status(json!({"provider":"cursor","remaining":64}))];
        let mut five = three();
        five.push(status(json!({"provider":"opencode","remaining":100})));
        five.push(status(json!({"provider":"deepseek","value":"CNY 8.76","cached":true})));
        for (name, strip) in [("three", Strip::new(three(), 0)), ("five-more", Strip::new(five, 2))] {
            let image = strip_image(&strip.unwrap()).unwrap();
            std::fs::write(folder.join(format!("{name}.tiff")), image.TIFFRepresentation().unwrap().to_vec()).unwrap();
        }
    }

    #[test]
    fn one_provider_keeps_the_single_status_and_bad_strips_are_refused() {
        assert!(!Strip::new(vec![status(json!({"provider":"codex","remaining":40}))], 0).unwrap().shows_several());
        assert!(!Strip::default().shows_several());
        assert!(Strip::new(vec![status(json!({"provider":"codex","remaining":40}))], 1).unwrap().shows_several());
        let six = (0..6).map(|_| status(json!({"provider":"claude","remaining":50}))).collect();
        assert!(Strip::new(six, 0).is_err(), "at most five providers");
        assert!(Strip::new(vec![], 3).is_err(), "a count of hidden providers needs shown ones");
        assert!(Strip::new(vec![status(json!({"provider":"claude","remaining":50}))], 100).is_err());
        assert!(Strip::new(vec![status(json!({"provider":"unknown","remaining":50}))], 0).is_err());
        assert!(Strip::new(vec![status(json!({"provider":"claude","remaining":101}))], 0).is_err());
    }
}
