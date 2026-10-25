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
            { return Ok(windows_cursor_root(&home, std::env::var_os("APPDATA").map(PathBuf::from), dirs::data_local_dir())); }
            #[cfg(target_os = "macos")]
            let base = home.join("Library/Application Support");
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let base = dirs::config_dir().ok_or("App data could not be found.")?;
            #[cfg(not(target_os = "windows"))]
            { base.join("Cursor") }
        },
    })
}

#[cfg(target_os = "windows")]
fn windows_cursor_root(home: &Path, roaming: Option<PathBuf>, local: Option<PathBuf>) -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(roaming) = roaming.filter(|path| path.is_absolute()) { candidates.push(roaming.join("Cursor")); }
    candidates.push(home.join("AppData/Roaming/Cursor"));
    // Apps launched from the Codex MSIX can inherit redirected roaming storage.
    // Check this known location only; never enumerate unrelated app packages.
    if let Some(local) = local { candidates.push(local.join("Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/Cursor")); }
    select_cursor_root(&candidates)
}

#[cfg(any(target_os = "windows", test))]
fn select_cursor_root(candidates: &[PathBuf]) -> PathBuf {
    candidates.iter().find(|path| crate::providers::has_cursor_sign_in(path))
        .or_else(|| candidates.iter().find(|path| path.join("User/globalStorage/state.vscdb").is_file()))
        .or_else(|| candidates.first()).cloned().unwrap_or_default()
}

fn detected(id: ProviderId, path: &Path) -> bool {
    match id {
        ProviderId::Claude => path.join("projects").is_dir(),
        ProviderId::Codex => path.join("auth.json").is_file() || path.join("sessions").is_dir() || path.join("archived_sessions").is_dir(),
        ProviderId::Cursor => path.join("User/globalStorage/state.vscdb").is_file(),
    }
}

// Local discovery does not contact a provider, open Claude credentials or return
// credential contents to the WebView. A detected profile is not proof of login.
#[tauri::command]
pub fn discover_local_providers(provider_ids: Vec<ProviderId>) -> Vec<ProviderId> {
    provider_ids.into_iter().take(3)
        .filter(|id| root(*id, None).is_ok_and(|path| detected(*id, &path))).collect()
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
    fn discovery_uses_history_markers_without_requiring_claude_credentials() {
        let base = std::env::temp_dir().join(format!("meterluma-discovery-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        std::fs::create_dir_all(&base).unwrap();
        assert!(!detected(ProviderId::Claude, &base));
        std::fs::write(base.join(".credentials.json"), "not-readable-as-json").unwrap();
        assert!(!detected(ProviderId::Claude, &base));
        std::fs::create_dir(base.join("projects")).unwrap();
        assert!(detected(ProviderId::Claude, &base));
        assert!(!detected(ProviderId::Codex, &base));
        std::fs::create_dir(base.join("sessions")).unwrap();
        assert!(detected(ProviderId::Codex, &base));
        assert!(!detected(ProviderId::Cursor, &base));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn cursor_discovery_uses_a_signed_in_redirected_profile_without_modifying_it() {
        let base = std::env::temp_dir().join(format!("meterluma-cursor-discovery-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let standard = base.join("standard"); let redirected = base.join("redirected");
        for (root, token) in [(&standard, ""), (&redirected, "synthetic-discovery-token")] {
            std::fs::create_dir_all(root.join("User/globalStorage")).unwrap();
            let db = rusqlite::Connection::open(root.join("User/globalStorage/state.vscdb")).unwrap();
            db.execute_batch("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)").unwrap();
            db.execute("INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', ?1)", [token]).unwrap();
        }
        let path = redirected.join("User/globalStorage/state.vscdb");
        let before = std::fs::read(&path).unwrap();
        assert_eq!(select_cursor_root(&[standard.clone(), redirected.clone()]), redirected);
        assert_eq!(std::fs::read(path).unwrap(), before);
        assert_eq!(select_cursor_root(&[standard.clone()]), standard);
        std::fs::remove_dir_all(base).unwrap();
    }
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
