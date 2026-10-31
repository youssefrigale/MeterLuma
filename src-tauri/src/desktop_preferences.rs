use std::path::Path;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

fn initialize_default(marker: &Path, enable: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    if marker.try_exists().map_err(|_| "The saved login default could not be read.")? { return Ok(()); }
    enable()?;
    std::fs::write(marker, b"initialized\n").map_err(|_| "The login default could not be saved.".into())
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    // Development runs must not register a temporary executable to launch at login.
    if tauri::is_dev() { return Ok(()); }
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
