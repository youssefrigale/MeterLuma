use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::{Path, PathBuf}};
use super::ProviderId;

#[derive(Default, Deserialize, Serialize)]
pub struct Cooldowns { entries: BTreeMap<String, i64>, #[serde(skip)] path: Option<PathBuf> }

pub fn key(id: ProviderId, root: &Path) -> String {
    let provider = match id { ProviderId::Claude => "claude", ProviderId::Cursor => "cursor", ProviderId::Codex => "codex" };
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path = canonical.to_string_lossy();
    #[cfg(target_os = "windows")]
    let path = path.strip_prefix(r"\\?\").unwrap_or(&path).replace('\\', "/").to_lowercase();
    format!("{provider}:{:x}", Sha256::digest(path.as_bytes()))
}

impl Cooldowns {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut store = path.as_ref().and_then(|path| {
            let mut bytes = Vec::new();
            std::fs::File::open(path).ok()?.take(65_537).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 65_536 { return None; }
            serde_json::from_slice::<Self>(&bytes).ok()
        }).unwrap_or_default();
        store.path = path;
        let now = chrono::Utc::now().timestamp_millis();
        store.entries.retain(|key, until| key.len() <= 80 && *until > now);
        if store.entries.len() > 64 { store.entries.clear(); }
        store
    }
    pub fn until(&self, key: &str) -> Option<i64> {
        self.entries.get(key).copied().filter(|until| *until > chrono::Utc::now().timestamp_millis())
    }
    pub fn set(&mut self, key: String, seconds: u64) {
        let now = chrono::Utc::now().timestamp_millis();
        self.entries.retain(|_, until| *until > now);
        if self.entries.len() >= 64 && !self.entries.contains_key(&key) { return; }
        let until = i64::try_from(seconds).ok().and_then(|seconds| seconds.checked_mul(1000)).and_then(|delay| now.checked_add(delay)).unwrap_or(i64::MAX);
        self.entries.entry(key).and_modify(|value| *value = (*value).max(until)).or_insert(until);
        if let Some(path) = &self.path {
            // Persist only hashed profile identifiers and deadlines, never tokens or usage.
            if let Some(parent) = path.parent() {
                if std::fs::create_dir_all(parent).is_ok() {
                    if let Ok(bytes) = serde_json::to_vec(self) {
                        let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
                        if std::fs::write(&temporary, bytes).is_ok() { let _ = std::fs::rename(&temporary, path); }
                    }
                }
            }
        }
    }
}

pub fn retry_seconds(value: Option<&str>, now: i64) -> u64 {
    value.and_then(|text| text.trim().parse::<u64>().ok().or_else(|| chrono::DateTime::parse_from_rfc2822(text).ok().map(|date| date.timestamp_millis().saturating_sub(now).max(0) as u64 / 1000 + 1))).unwrap_or(300).max(30)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_http_dates_and_never_shortens_a_valid_long_retry() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-15T17:00:00Z").unwrap().timestamp_millis();
        assert_eq!(retry_seconds(Some("Thu, 15 Oct 2026 18:00:00 GMT"), now), 3601);
        assert_eq!(retry_seconds(Some("172800"), now), 172800);
        assert_eq!(retry_seconds(Some("7"), now), 30);
        assert_eq!(retry_seconds(Some("invalid"), now), 300);
    }
    #[test]
    fn deadlines_survive_restart_are_profile_scoped_and_contain_no_paths_or_credentials() {
        let path = std::env::temp_dir().join(format!("meterluma-cooldowns-{}-{}.json", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let profile = Path::new("private-profile-directory");
        let id = key(ProviderId::Claude, profile);
        let mut store = Cooldowns::load(Some(path.clone()));
        store.set(id.clone(), 3600);
        let first = store.until(&id).unwrap();
        store.set(id.clone(), 30);
        assert_eq!(store.until(&id), Some(first));
        let loaded = Cooldowns::load(Some(path.clone()));
        assert_eq!(loaded.until(&id), Some(first));
        assert_eq!(loaded.until(&key(ProviderId::Cursor, profile)), None);
        assert_eq!(loaded.until(&key(ProviderId::Claude, Path::new("other-profile"))), None);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("private-profile-directory"));
        let _ = std::fs::remove_file(path);
    }
}
