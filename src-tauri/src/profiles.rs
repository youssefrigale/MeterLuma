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
    let home = dirs::home_dir().and_then(|path| path.canonicalize().ok()).ok_or("Your home directory could not be checked.")?;
    checked_root_in(id, directory, &home)
}

fn checked_root_in(id: ProviderId, directory: &str, home: &Path) -> Result<PathBuf, String> {
    if directory.len() > 1024 || !Path::new(directory).is_absolute() { return Err("Choose an absolute local profile directory under your home folder.".into()); }
    let path = Path::new(directory).canonicalize().map_err(|_| "The local profile directory could not be opened.")?;
    if !path.is_dir() || !within_home(&path, home) { return Err("Choose a local profile directory inside your own home folder.".into()); }
    // Markers are only checked for existence, never opened. Claude history needs projects/ and nothing else.
    let markers = match id {
        ProviderId::Claude => vec![(path.join("projects"), true)],
        ProviderId::Codex => vec![(path.join("auth.json"), false), (path.join("sessions"), true), (path.join("archived_sessions"), true)],
        ProviderId::Cursor => vec![(path.join("User/globalStorage/state.vscdb"), false)],
    };
    if !markers.iter().any(|(marker, folder)| marker.canonicalize().is_ok_and(|resolved| resolved.starts_with(&path) && (!folder || resolved.is_dir()))) {
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
    #[test]
    fn claude_profiles_need_projects_and_never_credentials() {
        let base = std::env::temp_dir().join(format!("meterluma-profiles-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
        let (raw, outside) = (base.join("home"), base.join("outside"));
        for folder in [raw.join("work").join("projects"), raw.join("credentials-only"), raw.join("linked"), outside.join("projects")] { std::fs::create_dir_all(folder).unwrap(); }
        std::fs::write(raw.join("credentials-only").join(".credentials.json"), "{}").unwrap();
        let home = raw.canonicalize().unwrap();
        let check = |id, path: PathBuf| checked_root_in(id, &path.to_string_lossy(), &home);
        let work = check(ProviderId::Claude, raw.join("work")).unwrap();
        assert_eq!(work, home.join("work"));
        // The canonical path handed back to the UI (verbatim-prefixed on Windows) validates again unchanged.
        assert_eq!(check(ProviderId::Claude, work.clone()).unwrap(), work);
        assert!(check(ProviderId::Claude, raw.join("credentials-only")).is_err());
        assert!(check(ProviderId::Codex, raw.join("work")).is_err());
        assert!(check(ProviderId::Claude, outside.clone()).is_err());
        assert!(check(ProviderId::Claude, raw.join("work").join("..").join("..").join("outside")).is_err());
        assert!(check(ProviderId::Claude, raw.clone()).is_err());
        // A projects link that leaves the profile does not count, where the platform lets the test create one.
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(outside.join("projects"), raw.join("linked").join("projects"));
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(outside.join("projects"), raw.join("linked").join("projects"));
        if linked.is_ok() { assert!(check(ProviderId::Claude, raw.join("linked")).is_err()); }
        let _ = std::fs::remove_dir_all(base);
    }
}
