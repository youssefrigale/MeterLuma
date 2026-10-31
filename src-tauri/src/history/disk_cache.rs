use super::{Extract, Key, Tokens, Usage, CACHE_FILES, RECORD_LIMIT, SAFE_TOTAL};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Arc, time::SystemTime};

const MAX_ENTRY: u64 = 16 * 1024 * 1024;
const MAX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct DiskCache(PathBuf);
#[derive(Deserialize, Serialize)]
struct StoredExtract { version: u32, len: u64, modified: String, zone: i32, partial: bool, records: Vec<StoredUsage> }
#[derive(Deserialize, Serialize)]
struct StoredUsage { date: String, model: String, key: Option<Key>, tokens: Tokens, hour_writes: u64, fast: bool }

impl DiskCache {
    pub(super) fn new(root: PathBuf) -> Option<Self> {
        if fs::symlink_metadata(&root).is_ok_and(|metadata| metadata.file_type().is_symlink()) { return None; }
        fs::create_dir_all(&root).ok()?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).ok()?; }
        Some(Self(root))
    }
    fn path(&self, key: &(bool, PathBuf)) -> PathBuf {
        let mut hash = Sha256::new(); hash.update([u8::from(key.0)]); hash.update(key.1.as_os_str().as_encoded_bytes());
        self.0.join(format!("{:x}.json", hash.finalize()))
    }
    pub(super) fn load(&self, key: &(bool, PathBuf), len: u64, modified: SystemTime) -> Option<Arc<Extract>> {
        let path = self.path(key);
        if !fs::symlink_metadata(&path).ok()?.file_type().is_file() { return None; }
        let mut bytes = Vec::new(); fs::File::open(path).ok()?.take(MAX_ENTRY + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() as u64 > MAX_ENTRY { return None; }
        let stored: StoredExtract = serde_json::from_slice(&bytes).ok()?;
        if stored.version != 2 || stored.len != len || stored.modified != stamp(modified)? || stored.zone != Local::now().offset().local_minus_utc() || stored.records.len() > RECORD_LIMIT { return None; }
        let records = stored.records.into_iter().map(record).collect::<Option<Vec<_>>>()?;
        Some(Arc::new(Extract { records, partial: stored.partial, cacheable: true }))
    }
    // Cache failures only cost a future rescan. Authoritative history always comes from the source logs.
    pub(super) fn save(&self, key: &(bool, PathBuf), len: u64, modified: SystemTime, parsed: &Extract) {
        let Some(modified) = stamp(modified) else { return; };
        let stored = StoredExtract { version: 2, len, modified, zone: Local::now().offset().local_minus_utc(), partial: parsed.partial, records: parsed.records.iter().map(|row| StoredUsage { date: row.date.to_string(), model: row.model.to_string(), key: row.key.clone(), tokens: row.tokens.clone(), hour_writes: row.tokens.cache_write_1h_tokens, fast: row.fast }).collect() };
        let Ok(bytes) = serde_json::to_vec(&stored) else { return; };
        if bytes.len() as u64 > MAX_ENTRY { return; }
        let target = self.path(key); let temporary = target.with_extension(format!("tmp-{}", std::process::id()));
        let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        if let Ok(mut file) = options.open(&temporary) {
            if file.write_all(&bytes).is_ok() { let _ = fs::rename(&temporary, target); }
            let _ = fs::remove_file(temporary);
        }
    }
    pub(super) fn prune(&self) {
        let Ok(entries) = fs::read_dir(&self.0) else { return; };
        let mut files = Vec::new();
        for entry in entries.take(CACHE_FILES * 2).flatten() {
            let path = entry.path();
            if !cache_name(&path) { continue; }
            let Ok(metadata) = fs::symlink_metadata(&path) else { continue; };
            if metadata.file_type().is_file() { files.push((metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH), metadata.len(), path)); }
        }
        files.sort_by_key(|(modified, _, _)| *modified);
        let (mut count, mut bytes) = (files.len(), files.iter().map(|(_, len, _)| *len).sum::<u64>());
        for (_, len, path) in files {
            if count <= CACHE_FILES && bytes <= MAX_BYTES { break; }
            if fs::remove_file(path).is_ok() { count -= 1; bytes = bytes.saturating_sub(len); }
        }
    }
}

fn cache_name(path: &Path) -> bool { path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.len() == 69 && name.ends_with(".json") && name.as_bytes()[..64].iter().all(u8::is_ascii_hexdigit)) }
fn stamp(modified: SystemTime) -> Option<String> { Some(modified.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_nanos().to_string()) }
fn record(stored: StoredUsage) -> Option<Usage> {
    let mut tokens = stored.tokens; tokens.cache_write_1h_tokens = stored.hour_writes;
    if tokens.input_tokens.checked_add(tokens.output_tokens)? != tokens.total_tokens || tokens.total_tokens > SAFE_TOTAL || tokens.cached_input_tokens.checked_add(tokens.cache_write_tokens)? > tokens.input_tokens || tokens.cache_write_1h_tokens > tokens.cache_write_tokens || stored.model.len() > 200 { return None; }
    match &stored.key {
        Some(Key::Claude(id)) if id.len() > 200 => return None,
        Some(Key::Codex(_, input, cached, output)) if input.checked_add(*output)? > SAFE_TOTAL || cached > input => return None,
        _ => {}
    }
    Some(Usage { date: stored.date.parse().ok()?, model: Arc::from(stored.model), key: stored.key, tokens, fast: stored.fast })
}
