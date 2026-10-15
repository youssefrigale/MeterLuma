use super::{ProviderId, Snapshot};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read, path::PathBuf};

#[derive(Clone, Deserialize, Serialize)]
struct Saved { fingerprint: [u8; 32], snapshot: Snapshot }
#[derive(Default, Deserialize, Serialize)]
pub struct Snapshots { entries: BTreeMap<String, Saved>, #[serde(skip)] path: Option<PathBuf> }

impl Snapshots {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut store = path.as_ref().and_then(|path| {
            let mut bytes = Vec::new();
            std::fs::File::open(path).ok()?.take(1_048_577).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 1_048_576 { return None; }
            serde_json::from_slice::<Self>(&bytes).ok()
        }).unwrap_or_default();
        store.path = path;
        if store.entries.len() > 16 { store.entries.clear(); }
        store
    }
    pub fn get(&self, key: &str, fingerprint: [u8; 32], id: ProviderId, now: i64) -> Option<Snapshot> {
        let saved = self.entries.get(key)?;
        if saved.fingerprint != fingerprint || std::mem::discriminant(&saved.snapshot.id) != std::mem::discriminant(&id) { return None; }
        let mut snapshot = saved.snapshot.clone();
        let age = now.checked_sub(snapshot.fetched_at)?;
        if !(0..=86_400_000).contains(&age) || snapshot.plan.len() > 120 || snapshot.metrics.len() > 16 { return None; }
        snapshot.metrics.retain(|metric| metric.label.len() < 100 && metric.used_percent.is_finite() && metric.used_percent >= 0.0 && match metric.reset_at { Some(reset) => reset > now, None => age <= 300_000 });
        (!snapshot.metrics.is_empty()).then_some(snapshot)
    }
    pub fn put(&mut self, key: String, fingerprint: [u8; 32], snapshot: Snapshot) {
        if self.entries.len() >= 16 && !self.entries.contains_key(&key) {
            if let Some(oldest) = self.entries.iter().min_by_key(|(_, saved)| saved.snapshot.fetched_at).map(|(key, _)| key.clone()) { self.entries.remove(&oldest); }
        }
        self.entries.insert(key, Saved { fingerprint, snapshot });
        if let Some(path) = &self.path {
            if let Some(parent) = path.parent() {
                if std::fs::create_dir_all(parent).is_ok() {
                    if let Ok(bytes) = serde_json::to_vec(self) {
                        let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
                        if std::fs::write(&temporary, bytes).is_ok() { let _ = std::fs::rename(temporary, path); }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn survives_restart_but_never_crosses_credentials_or_shows_expired_windows() {
        let path = std::env::temp_dir().join(format!("meterluma-snapshots-{}-{}.json", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let now = chrono::Utc::now().timestamp_millis();
        let mut snapshot = super::super::map::map(ProviderId::Claude, &serde_json::json!({"five_hour":{"utilization":20,"resets_at":null},"seven_day":{"utilization":40,"resets_at":chrono::DateTime::from_timestamp_millis(now + 600_000).unwrap().to_rfc3339()}})).unwrap();
        snapshot.fetched_at = now;
        let mut store = Snapshots::load(Some(path.clone()));
        store.put("profile".into(), [1;32], snapshot);
        let loaded = Snapshots::load(Some(path.clone()));
        assert_eq!(loaded.get("profile", [1;32], ProviderId::Claude, now + 360_000).unwrap().metrics.len(), 1);
        assert!(loaded.get("profile", [2;32], ProviderId::Claude, now).is_none());
        assert!(loaded.get("other", [1;32], ProviderId::Claude, now).is_none());
        assert!(loaded.get("profile", [1;32], ProviderId::Cursor, now).is_none());
        assert!(loaded.get("profile", [1;32], ProviderId::Claude, now + 700_000).is_none());
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(!contents.contains("accessToken") && !contents.contains("refreshToken"));
        let _ = std::fs::remove_file(path);
    }
}
