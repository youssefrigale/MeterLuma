use crate::providers::ProviderId;
use std::path::{Path, PathBuf};

pub fn root(id: ProviderId, directory: Option<&str>) -> Result<PathBuf, String> {
    if let Some(directory) = directory { return checked_root(id, directory); }
    let home = dirs::home_dir().ok_or("Your home directory could not be found.")?;
    Ok(match id {
        ProviderId::Claude => std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or(home.join(".claude")),
        ProviderId::Codex => std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or(home.join(".codex")),
        ProviderId::Cursor => {
            #[cfg(target_os = "windows")]
            let base = std::env::var_os("APPDATA").map(PathBuf::from).ok_or("Windows app data could not be found.")?;
            #[cfg(target_os = "macos")]
            let base = home.join("Library/Application Support");
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let base = dirs::config_dir().ok_or("App data could not be found.")?;
            base.join("Cursor")
        },
    })
}

fn within_home(path: &Path, home: &Path) -> bool { path != home && path.starts_with(home) }

fn checked_root(id: ProviderId, directory: &str) -> Result<PathBuf, String> {
    if directory.len() > 1024 || !Path::new(directory).is_absolute() { return Err("Choose an absolute local profile directory under your home folder.".into()); }
    let home = dirs::home_dir().and_then(|path| path.canonicalize().ok()).ok_or("Your home directory could not be checked.")?;
    let path = Path::new(directory).canonicalize().map_err(|_| "The local profile directory could not be opened.")?;
    if !path.is_dir() || !within_home(&path, &home) { return Err("Choose a local profile directory inside your own home folder.".into()); }
    let markers = match id {
        ProviderId::Claude => vec![path.join("projects"), path.join(".credentials.json")],
        ProviderId::Codex => vec![path.join("auth.json"), path.join("sessions"), path.join("archived_sessions")],
        ProviderId::Cursor => vec![path.join("User/globalStorage/state.vscdb")],
    };
    if !markers.iter().any(|marker| marker.canonicalize().is_ok_and(|resolved| resolved.starts_with(&path))) {
        return Err("No supported provider profile was found in that directory.".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn validate_profile(provider_id: ProviderId, directory: String) -> Result<String, String> {
    let path = checked_root(provider_id, &directory)?;
    if root(provider_id, None).ok().and_then(|root| root.canonicalize().ok()).is_some_and(|default| default == path) {
        return Err("This is the default provider profile. Use its connection above instead of adding it twice.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_scope_uses_components_not_string_prefixes() {
        assert!(within_home(Path::new("/home/user/profiles/personal"), Path::new("/home/user")));
        assert!(!within_home(Path::new("/home/username/profile"), Path::new("/home/user")));
        assert!(!within_home(Path::new("/home/user"), Path::new("/home/user")));
        assert!(checked_root(ProviderId::Codex, "relative/profile").is_err());
    }
}
