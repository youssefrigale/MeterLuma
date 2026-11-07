use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Permission { NotDetermined, Denied, Authorized, Provisional, #[cfg(not(target_os = "macos"))] Unsupported, Unavailable }

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind { Low, Threshold, PaceClose, PaceRisk, Reset }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageNotice {
    id: String,
    provider_id: String,
    metric_label: String,
    kind: NoticeKind,
}

fn notice_text(notice: &UsageNotice) -> Result<String, String> {
    if notice.id.len() != 64 || !notice.id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || notice.metric_label.trim().is_empty() || notice.metric_label.chars().count() > 64
        || notice.metric_label.chars().any(char::is_control) { return Err("Invalid usage notification.".into()); }
    let name = match notice.provider_id.as_str() {
        "claude" => "Claude", "codex" => "Codex", "cursor" => "Cursor",
        id => &super::providers::additional::catalog::ready(id)?.name,
    };
    let message = match notice.kind {
        NoticeKind::Low => "under 10% allowance left",
        NoticeKind::Threshold => "your usage threshold was reached",
        NoticeKind::PaceClose => "usage is close to the limit at the current pace",
        NoticeKind::PaceRisk => "usage may reach the limit before reset at the current pace",
        NoticeKind::Reset => "the allowance resets soon",
    };
    Ok(format!("{name} · {}: {message}.", notice.metric_label))
}

#[tauri::command]
pub async fn notification_permission() -> Result<Permission, String> {
    tauri::async_runtime::spawn_blocking(platform::permission).await.map_err(|_| "Notification settings could not be read.".to_string())?
}

#[tauri::command]
pub async fn request_notification_permission(window: tauri::WebviewWindow) -> Result<Permission, String> {
    tauri::async_runtime::spawn_blocking(move || super::quick::with_dialog(&window, platform::request_permission))
        .await.map_err(|_| "Notification permission could not be requested.".to_string())?
}

#[tauri::command]
pub async fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(|| {
        let status = std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .status().map_err(|_| "System Settings could not be opened.")?;
        if status.success() { Ok(()) } else { Err("System Settings could not be opened.".into()) }
    }).await.map_err(|_| "System Settings could not be opened.".to_string())?;
    #[cfg(not(target_os = "macos"))]
    Err("Open notification settings through your operating system.".into())
}

#[tauri::command]
pub async fn queue_usage_notification(notices: Vec<UsageNotice>) -> Result<(), String> {
    if notices.is_empty() || notices.len() > 3 { return Err("Choose one to three usage notifications.".into()); }
    let mut lines = notices.iter().map(notice_text).collect::<Result<Vec<_>, _>>()?;
    let mut unique = std::collections::HashSet::new();
    lines.retain(|line| unique.insert(line.clone()));
    let body = lines.join("\n");
    let identifier = notices[0].id.clone();
    tauri::async_runtime::spawn_blocking(move || platform::queue(&identifier, &body))
        .await.map_err(|_| "The usage notification could not be queued.".to_string())?
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::Permission;
    pub fn permission() -> Result<Permission, String> { Ok(Permission::Unsupported) }
    pub fn request_permission() -> Result<Permission, String> { permission() }
    pub fn queue(_: &str, _: &str) -> Result<(), String> { Err("Desktop notifications require the bundled Mac app in this build.".into()) }
    pub fn present_while_active() {}
}

/// Lets macOS show usage alerts while MeterLuma is the active app, such as when its panel is open.
pub fn present_while_active() { platform::present_while_active(); }

#[cfg(target_os = "macos")]
mod platform {
    use super::Permission;
    use block2::{DynBlock, RcBlock};
    use objc2::{define_class, msg_send, rc::{autoreleasepool, Retained}, runtime::{Bool, ProtocolObject}, AllocAnyThread};
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter, UNUserNotificationCenterDelegate, UNAuthorizationOptions};
    use std::{ptr::NonNull, sync::mpsc, time::Duration};

    // macOS hides banners from the active app unless its notification-center delegate asks to show them.
    const FOREGROUND_PRESENTATION: UNNotificationPresentationOptions = UNNotificationPresentationOptions(UNNotificationPresentationOptions::Banner.0 | UNNotificationPresentationOptions::List.0);

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class adds no ivars or Drop.
        #[unsafe(super(NSObject))]
        #[name = "MeterLumaNotificationPresenter"]
        struct Presenter;

        unsafe impl NSObjectProtocol for Presenter {}

        unsafe impl UNUserNotificationCenterDelegate for Presenter {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(&self, _center: &UNUserNotificationCenter, _notification: &UNNotification, completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
                completion.call((FOREGROUND_PRESENTATION,));
            }
        }
    );

    impl Presenter {
        fn new() -> Retained<Self> { unsafe { msg_send![Self::alloc(), init] } }
    }

    pub fn present_while_active() {
        // The notification center is unavailable to an unbundled development binary.
        if !bundled() { return; }
        let presenter = Presenter::new();
        UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(ProtocolObject::from_ref(&*presenter)));
        // The center holds its delegate weakly; this one lives as long as the app.
        std::mem::forget(presenter);
    }

    fn bundled() -> bool {
        std::env::current_exe().ok().is_some_and(|path| path.parent().is_some_and(|parent|
            parent.file_name().is_some_and(|name| name == "MacOS") && parent.parent().is_some_and(|contents|
                contents.file_name().is_some_and(|name| name == "Contents") && contents.parent().is_some_and(|bundle| bundle.extension().is_some_and(|extension| extension == "app")))))
    }

    fn permission_from_status(status: isize) -> Permission {
        match status { 0 => Permission::NotDetermined, 1 => Permission::Denied, 2 => Permission::Authorized, 3 => Permission::Provisional, _ => Permission::Unavailable }
    }

    pub fn permission() -> Result<Permission, String> {
        if !bundled() { return Ok(Permission::Unavailable); }
        autoreleasepool(|_| {
            let (send, receive) = mpsc::channel();
            let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // Apple owns the settings during this callback; retain only the scalar authorization state.
                let status = unsafe { settings.as_ref() }.authorizationStatus().0;
                let _ = send.send(permission_from_status(status));
            });
            UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&callback);
            receive.recv_timeout(Duration::from_secs(10)).map_err(|_| "macOS notification settings did not respond. Try again.".into())
        })
    }

    pub fn request_permission() -> Result<Permission, String> {
        let current = permission()?;
        if current != Permission::NotDetermined { return Ok(current); }
        autoreleasepool(|_| {
            let (send, receive) = mpsc::channel();
            let callback = RcBlock::new(move |granted: Bool, error: *mut NSError| {
                let _ = send.send(if error.is_null() { Ok(granted.as_bool()) } else { Err("macOS could not request notification permission.".to_string()) });
            });
            UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &callback);
            receive.recv_timeout(Duration::from_secs(60)).map_err(|_| "The notification request is still unanswered. Check macOS and try again.".to_string())??;
            permission()
        })
    }

    pub fn queue(identifier: &str, body: &str) -> Result<(), String> {
        if !matches!(permission()?, Permission::Authorized | Permission::Provisional) { return Err("Notifications are not allowed. Check Settings before trying again.".into()); }
        autoreleasepool(|_| {
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str("MeterLuma usage")); content.setBody(&NSString::from_str(body));
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(identifier), &content, None);
            let (send, receive) = mpsc::channel();
            let callback = RcBlock::new(move |error: *mut NSError| { let _ = send.send(error.is_null()); });
            UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, Some(&callback));
            match receive.recv_timeout(Duration::from_secs(10)) {
                Ok(true) => Ok(()), Ok(false) => Err("macOS did not accept the usage notification.".into()),
                Err(_) => Err("macOS did not confirm the usage notification. Check notification settings.".into()),
            }
        })
    }

    #[cfg(test)]
    #[test]
    fn the_presenter_shows_alerts_while_the_app_is_active() {
        use objc2::{runtime::NSObjectProtocol as _, sel};
        let presenter = Presenter::new();
        assert!(presenter.respondsToSelector(sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:)));
        assert!(FOREGROUND_PRESENTATION.contains(UNNotificationPresentationOptions::Banner));
        assert!(FOREGROUND_PRESENTATION.contains(UNNotificationPresentationOptions::List));
    }

    #[cfg(test)]
    #[test]
    fn an_unknown_os_permission_never_becomes_granted() {
        assert_eq!(permission_from_status(2), Permission::Authorized);
        for status in [-1, 4, 99] { assert_eq!(permission_from_status(status), Permission::Unavailable); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_notices_accept_catalog_providers_and_reject_injected_labels_ids_and_unknown_providers() {
        let mut notice = UsageNotice { id: "a".repeat(64), provider_id: "zed".into(), metric_label: "Edit predictions".into(), kind: NoticeKind::Low };
        assert_eq!(notice_text(&notice).unwrap(), "Zed · Edit predictions: under 10% allowance left.");
        for label in ["".into(), "\nspoofed".into(), "x".repeat(65)] { notice.metric_label = label; assert!(notice_text(&notice).is_err()); }
        notice.metric_label = "Weekly".into(); notice.provider_id = "unknown".into(); assert!(notice_text(&notice).is_err());
        notice.provider_id = "codex".into(); notice.id = "z".repeat(64); assert!(notice_text(&notice).is_err());
        notice.id = "a".repeat(63); assert!(notice_text(&notice).is_err());
    }

    #[test]
    fn empty_and_oversized_notification_batches_never_reach_the_os() {
        for length in [0, 4] {
            let notices = (0..length).map(|_| UsageNotice { id: "a".repeat(64), provider_id: "codex".into(), metric_label: "Weekly".into(), kind: NoticeKind::Low }).collect();
            assert_eq!(tauri::async_runtime::block_on(queue_usage_notification(notices)).unwrap_err(), "Choose one to three usage notifications.");
        }
    }
}
