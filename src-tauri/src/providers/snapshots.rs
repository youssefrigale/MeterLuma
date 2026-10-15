use super::{ProviderId, Snapshot};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read, path::PathBuf};

const MAX_AGE: i64 = 86_400_000;

#[derive(Clone, Deserialize, Serialize)]
struct Saved { fingerprint: [u8; 32], snapshot: Snapshot }
#[derive(Default, Deserialize, Serialize)]
pub struct Snapshots { entries: BTreeMap<String, Saved>, #[serde(skip)] path: Option<PathBuf> }

fn size(entries: &BTreeMap<String, Saved>) -> usize { entries.values().map(|saved| saved.snapshot.metrics.len() + 1).sum() }
fn current(age: i64, reset_at: Option<i64>, now: i64) -> bool { match reset_at { Some(reset) => reset > now, None => age <= 300_000 } }

impl Snapshots {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut store = path.as_ref().and_then(|path| {
            let mut bytes = Vec::new();
            std::fs::File::open(path).ok()?.take(1_048_577).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 1_048_576 { return None; }
            serde_json::from_slice::<Self>(&bytes).ok()
        }).unwrap_or_default();
        store.path = path;
        if store.prune(chrono::Utc::now().timestamp_millis()) { super::persist(&store.path, &store); }
        store
    }
    // Expired windows, entries older than a day and Claude entries (live quotas were removed) never stay on disk.
    fn prune(&mut self, now: i64) -> bool {
        let before = size(&self.entries);
        self.entries.retain(|_, saved| {
            let Some(age) = now.checked_sub(saved.snapshot.fetched_at).filter(|age| (0..=MAX_AGE).contains(age)) else { return false; };
            saved.snapshot.metrics.retain(|metric| current(age, metric.reset_at, now));
            !matches!(saved.snapshot.id, ProviderId::Claude) && !saved.snapshot.metrics.is_empty()
        });
        if self.entries.len() > 16 { self.entries.clear(); }
        size(&self.entries) != before
    }
    pub fn get(&self, key: &str, fingerprint: [u8; 32], id: ProviderId, now: i64) -> Option<Snapshot> {
        let saved = self.entries.get(key)?;
        if saved.fingerprint != fingerprint || std::mem::discriminant(&saved.snapshot.id) != std::mem::discriminant(&id) || matches!(id, ProviderId::Claude) { return None; }
        let mut snapshot = saved.snapshot.clone();
        let age = now.checked_sub(snapshot.fetched_at)?;
        if !(0..=MAX_AGE).contains(&age) || snapshot.plan.len() > 120 || snapshot.metrics.len() > 16 { return None; }
        snapshot.metrics.retain(|metric| metric.label.len() < 100 && metric.used_percent.is_finite() && metric.used_percent >= 0.0 && current(age, metric.reset_at, now));
        (!snapshot.metrics.is_empty()).then_some(snapshot)
    }
    pub fn put(&mut self, key: String, fingerprint: [u8; 32], snapshot: Snapshot) {
        self.prune(chrono::Utc::now().timestamp_millis());
        if self.entries.len() >= 16 && !self.entries.contains_key(&key) {
            if let Some(oldest) = self.entries.iter().min_by_key(|(_, saved)| saved.snapshot.fetched_at).map(|(key, _)| key.clone()) { self.entries.remove(&oldest); }
        }
        self.entries.insert(key, Saved { fingerprint, snapshot });
        super::persist(&self.path, &*self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::Metric;
    fn snapshot(id: ProviderId, fetched_at: i64, resets: &[Option<i64>]) -> Snapshot {
        let metrics = resets.iter().enumerate().map(|(index, reset_at)| Metric { label: format!("Window {index}"), used_percent: 20.0 + index as f64, reset_at: *reset_at }).collect();
        Snapshot { id, name: "Provider".into(), plan: "Subscription".into(), color: "#000000".into(), initials: "P".into(), spend_today: None, metrics, fetched_at }
    }
    fn temporary(name: &str) -> PathBuf { std::env::temp_dir().join(format!("meterluma-{name}-{}-{}.json", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap())) }
    #[test]
    fn survives_restart_but_never_crosses_credentials_or_shows_expired_windows() {
        let path = temporary("snapshots");
        let now = chrono::Utc::now().timestamp_millis();
        let mut store = Snapshots::load(Some(path.clone()));
        store.put("profile".into(), [1;32], snapshot(ProviderId::Cursor, now, &[None, Some(now + 600_000)]));
        let loaded = Snapshots::load(Some(path.clone()));
        assert_eq!(loaded.get("profile", [1;32], ProviderId::Cursor, now).unwrap().metrics.len(), 2);
        assert_eq!(loaded.get("profile", [1;32], ProviderId::Cursor, now + 360_000).unwrap().metrics.len(), 1);
        assert!(loaded.get("profile", [2;32], ProviderId::Cursor, now).is_none());
        assert!(loaded.get("other", [1;32], ProviderId::Cursor, now).is_none());
        assert!(loaded.get("profile", [1;32], ProviderId::Codex, now).is_none());
        assert!(loaded.get("profile", [1;32], ProviderId::Cursor, now + 700_000).is_none());
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(!contents.contains("accessToken") && !contents.contains("refreshToken"));
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn load_and_save_prune_claude_entries_expired_windows_and_day_old_entries() {
        let path = temporary("snapshots-prune");
        let now = chrono::Utc::now().timestamp_millis();
        let mut raw = Snapshots::default();
        for (key, value) in [
            ("claude", snapshot(ProviderId::Claude, now, &[Some(now + 600_000)])),
            ("stale", snapshot(ProviderId::Cursor, now - MAX_AGE - 1, &[Some(now + 600_000)])),
            ("future", snapshot(ProviderId::Cursor, now + 600_000, &[Some(now + 900_000)])),
            ("expired", snapshot(ProviderId::Codex, now - 600_000, &[Some(now - 1), None])),
            ("live", snapshot(ProviderId::Cursor, now - 600_000, &[Some(now - 1), Some(now + 600_000), None])),
        ] { raw.entries.insert(key.into(), Saved { fingerprint: [1; 32], snapshot: value }); }
        std::fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
        let loaded = Snapshots::load(Some(path.clone()));
        assert_eq!(loaded.entries.keys().collect::<Vec<_>>(), ["live"]);
        assert_eq!(loaded.entries["live"].snapshot.metrics.len(), 1);
        let saved: Snapshots = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.entries.keys().collect::<Vec<_>>(), ["live"]);
        assert_eq!(saved.entries["live"].snapshot.metrics[0].reset_at, Some(now + 600_000));
        let mut store = saved;
        store.path = Some(path.clone());
        store.entries.get_mut("live").unwrap().snapshot.fetched_at = now - MAX_AGE - 1;
        store.put("fresh".into(), [2; 32], snapshot(ProviderId::Cursor, now, &[Some(now + 600_000)]));
        let saved: Snapshots = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.entries.keys().collect::<Vec<_>>(), ["fresh"]);
        let _ = std::fs::remove_file(path);
    }
}
