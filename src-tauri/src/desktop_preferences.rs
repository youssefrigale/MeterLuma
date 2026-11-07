use std::path::Path;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

fn initialize_default(marker: &Path, enable: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    if marker.try_exists().map_err(|_| "The saved login default could not be read.")? { return Ok(()); }
    enable()?;
    std::fs::write(marker, b"initialized\n").map_err(|_| "The login default could not be saved.".into())
}

/// A copy opened from a mounted disk image, or from the temporary location macOS uses for unsigned
/// downloads ("App Translocation"), goes away later, so it must not be registered to open at login.
fn transient_location(executable: &Path) -> bool {
    let path = executable.to_string_lossy();
    path.starts_with("/Volumes/") || path.contains("/AppTranslocation/")
}

/// Points an existing login entry at this copy when the app was moved, for example from the
/// Downloads folder to Applications, so Start at login does not silently open nothing.
#[cfg(target_os = "macos")]
fn refresh_login_location(app: &tauri::AppHandle, executable: &Path) {
    let Some(agent) = dirs::home_dir().map(|home| home.join("Library/LaunchAgents").join(format!("{}.plist", app.package_info().name))) else { return };
    let Ok(plist) = std::fs::read_to_string(&agent) else { return };
    if !plist.contains(&*executable.to_string_lossy()) { let _ = app.autolaunch().enable(); }
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    // Development runs must not register a temporary executable to launch at login.
    if tauri::is_dev() { return Ok(()); }
    let executable = std::env::current_exe().and_then(|path| path.canonicalize()).map_err(|_| "The app location could not be read.")?;
    if transient_location(&executable) { return Ok(()); }
    #[cfg(target_os = "macos")]
    refresh_login_location(app, &executable);
    let directory = app.path().app_data_dir().map_err(|_| "The login settings folder is unavailable.")?;
    std::fs::create_dir_all(&directory).map_err(|_| "The login settings folder could not be created.")?;
    initialize_default(&directory.join("startup-default-v1"), || {
        let startup = app.autolaunch();
        if !startup.is_enabled().map_err(|_| "The system login setting could not be read.")? {
            startup.enable().map_err(|_| "Start at login could not be enabled. Check Settings.")?;
        }
        if !startup.is_enabled().map_err(|_| "The system login setting could not be verified.")? {
            return Err("The system did not confirm Start at login. Check Settings.".into());
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn startup_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || app.autolaunch().is_enabled().map_err(|_| "The system login setting could not be read.".into()))
        .await.map_err(|_| "The system login setting could not be checked.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_default_is_applied_once_and_later_system_opt_out_is_preserved() {
        let directory = std::env::temp_dir().join(format!("meterluma-startup-{}-once", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("startup-default-v1");
        let enabled = std::cell::Cell::new(false);
        initialize_default(&marker, || { enabled.set(true); Ok(()) }).unwrap();
        assert!(enabled.get());
        assert!(marker.is_file());
        enabled.set(false);
        initialize_default(&marker, || { enabled.set(true); Ok(()) }).unwrap();
        assert!(!enabled.get(), "A later OS or app opt-out must survive restarting.");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn copies_on_a_disk_image_or_in_quarantine_are_not_registered_for_login() {
        assert!(transient_location(Path::new("/Volumes/MeterLuma/MeterLuma.app/Contents/MacOS/meterluma")));
        assert!(transient_location(Path::new("/private/var/folders/xy/T/AppTranslocation/1A2B/d/MeterLuma.app/Contents/MacOS/meterluma")));
        assert!(!transient_location(Path::new("/Applications/MeterLuma.app/Contents/MacOS/meterluma")));
        assert!(!transient_location(Path::new("/Users/someone/Applications/MeterLuma.app/Contents/MacOS/meterluma")));
    }

    #[test]
    fn failed_login_registration_remains_retryable() {
        let directory = std::env::temp_dir().join(format!("meterluma-startup-{}-retry", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("startup-default-v1");
        assert!(initialize_default(&marker, || Err("permission denied".into())).is_err());
        assert!(!marker.exists());
        initialize_default(&marker, || Ok(())).unwrap();
        assert!(marker.is_file());
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[tauri::command]
pub async fn set_startup_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let startup = app.autolaunch();
        if enabled { startup.enable() } else { startup.disable() }.map_err(|_| "The system login setting could not be changed. Check your system permissions.".to_string())?;
        startup.is_enabled().map_err(|_| "The changed login setting could not be verified.".to_string())
    }).await.map_err(|_| "The system login setting could not be changed.".to_string())?
}
