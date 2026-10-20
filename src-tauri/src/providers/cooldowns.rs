use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::{Path, PathBuf}};
use super::ProviderId;

pub const CAP_SECONDS: u64 = 6 * 60 * 60;

#[derive(Clone, Deserialize, Serialize)]
struct Entry { until: i64, credential: String }
#[derive(Default, Deserialize, Serialize)]
pub struct Cooldowns { entries: BTreeMap<String, Entry>, #[serde(skip)] path: Option<PathBuf> }

pub fn key(id: ProviderId, root: &Path) -> String {
    let provider = match id { ProviderId::Claude => "claude", ProviderId::Cursor => "cursor", ProviderId::Codex => "codex" };
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path = canonical.to_string_lossy();
    #[cfg(target_os = "windows")]
    let path = path.strip_prefix(r"\\?\").unwrap_or(&path).replace('\\', "/").to_lowercase();
    format!("{provider}:{:x}", Sha256::digest(path.as_bytes()))
}

// A one-way hash of the credential fingerprint tells sign-ins apart without storing either.
fn credential(fingerprint: &[u8; 32]) -> String { format!("{:x}", Sha256::digest(fingerprint)) }

impl Cooldowns {
    pub fn remove(&mut self, key: &str) { if self.entries.remove(key).is_some() { super::persist(&self.path, self); } }

    pub fn load(path: Option<PathBuf>) -> Self {
        let mut store = path.as_ref().and_then(|path| {
            let mut bytes = Vec::new();
            std::fs::File::open(path).ok()?.take(65_537).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 65_536 { return None; }
            serde_json::from_slice::<Self>(&bytes).ok()
        }).unwrap_or_default();
        store.path = path;
        if store.prune(chrono::Utc::now().timestamp_millis()) { super::persist(&store.path, &store); }
        store
    }
    fn prune(&mut self, now: i64) -> bool {
        let (before, latest) = (self.entries.len(), now.saturating_add(CAP_SECONDS as i64 * 1000));
        let mut changed = false;
        self.entries.retain(|key, entry| key.len() <= 80 && entry.credential.len() == 64 && entry.until > now);
        for entry in self.entries.values_mut() { if entry.until > latest { entry.until = latest; changed = true; } }
        if self.entries.len() > 64 { self.entries.clear(); }
        changed || self.entries.len() != before
    }
    pub fn until(&self, key: &str, fingerprint: &[u8; 32]) -> Option<i64> {
        self.entries.get(key).filter(|entry| entry.until > chrono::Utc::now().timestamp_millis() && entry.credential == credential(fingerprint)).map(|entry| entry.until)
    }
    pub fn set(&mut self, key: String, fingerprint: &[u8; 32], seconds: u64) {
        let now = chrono::Utc::now().timestamp_millis();
        self.prune(now);
        if self.entries.len() >= 64 && !self.entries.contains_key(&key) { return; }
        let (until, credential) = (now.saturating_add(seconds.min(CAP_SECONDS) as i64 * 1000), credential(fingerprint));
        // The same sign-in never shortens its deadline; a different sign-in replaces the old account's one.
        let until = self.entries.get(&key).filter(|entry| entry.credential == credential).map_or(until, |entry| entry.until.max(until));
        self.entries.insert(key, Entry { until, credential });
        // Persist only hashed profile and sign-in identifiers with deadlines, never tokens or usage.
        super::persist(&self.path, &*self);
    }
}

pub fn retry_seconds(value: Option<&str>, now: i64) -> u64 {
    value.and_then(|text| text.trim().parse::<u64>().ok().or_else(|| chrono::DateTime::parse_from_rfc2822(text).ok().map(|date| date.timestamp_millis().saturating_sub(now).max(0) as u64 / 1000 + 1))).unwrap_or(300).clamp(30, CAP_SECONDS)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary(name: &str) -> PathBuf { std::env::temp_dir().join(format!("meterluma-{name}-{}-{}.json", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap())) }
    #[test]
    fn parses_http_dates_and_caps_every_retry_at_six_hours() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-15T17:00:00Z").unwrap().timestamp_millis();
        assert_eq!(retry_seconds(Some("Thu, 15 Oct 2026 18:00:00 GMT"), now), 3601);
        assert_eq!(retry_seconds(Some("Thu, 22 Oct 2026 18:00:00 GMT"), now), CAP_SECONDS);
        assert_eq!(retry_seconds(Some("172800"), now), CAP_SECONDS);
        assert_eq!(retry_seconds(Some("18446744073709551615"), now), CAP_SECONDS);
        assert_eq!(retry_seconds(Some("7"), now), 30);
        assert_eq!(retry_seconds(Some("invalid"), now), 300);
        let mut store = Cooldowns::default();
        store.set("cursor:profile".into(), &[1; 32], u64::MAX);
        let until = store.until("cursor:profile", &[1; 32]).unwrap();
        assert!(until <= chrono::Utc::now().timestamp_millis() + CAP_SECONDS as i64 * 1000);
    }
    #[test]
    fn deadlines_survive_restart_are_profile_and_sign_in_scoped_and_contain_no_paths_or_credentials() {
        let path = temporary("cooldowns");
        let profile = Path::new("private-profile-directory");
        let id = key(ProviderId::Cursor, profile);
        let (first_sign_in, second_sign_in) = ([7; 32], [9; 32]);
        let mut store = Cooldowns::load(Some(path.clone()));
        store.set(id.clone(), &first_sign_in, 3600);
        let first = store.until(&id, &first_sign_in).unwrap();
        store.set(id.clone(), &first_sign_in, 30);
        assert_eq!(store.until(&id, &first_sign_in), Some(first));
        assert_eq!(store.until(&id, &second_sign_in), None);
        let loaded = Cooldowns::load(Some(path.clone()));
        assert_eq!(loaded.until(&id, &first_sign_in), Some(first));
        assert_eq!(loaded.until(&key(ProviderId::Codex, profile), &first_sign_in), None);
        assert_eq!(loaded.until(&key(ProviderId::Cursor, Path::new("other-profile")), &first_sign_in), None);
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(!contents.contains("private-profile-directory") && !contents.contains("0707070707") && !contents.contains("[7,7"));
        let mut store = loaded;
        store.set(id.clone(), &second_sign_in, 60);
        assert_eq!(store.until(&id, &first_sign_in), None);
        assert!(store.until(&id, &second_sign_in).unwrap() < first);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn expired_and_oversized_deadlines_are_pruned_and_capped_on_load_and_save() {
        let path = temporary("cooldowns-prune");
        let now = chrono::Utc::now().timestamp_millis();
        let mut raw = Cooldowns::default();
        raw.entries.insert("cursor:forever".into(), Entry { until: i64::MAX, credential: credential(&[1; 32]) });
        raw.entries.insert("cursor:expired".into(), Entry { until: now - 1, credential: credential(&[1; 32]) });
        raw.entries.insert("cursor:invalid".into(), Entry { until: now + 60_000, credential: "short".into() });
        std::fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
        let loaded = Cooldowns::load(Some(path.clone()));
        assert_eq!(loaded.entries.len(), 1);
        let capped = loaded.until("cursor:forever", &[1; 32]).unwrap();
        assert!(capped > now && capped <= chrono::Utc::now().timestamp_millis() + CAP_SECONDS as i64 * 1000);
        let saved: Cooldowns = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.entries.keys().collect::<Vec<_>>(), ["cursor:forever"]);
        assert_eq!(saved.entries["cursor:forever"].until, capped);
        let _ = std::fs::remove_file(path);
    }
}
