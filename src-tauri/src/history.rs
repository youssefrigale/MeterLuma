use crate::providers::ProviderId;
use chrono::{DateTime, Days, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cmp::Reverse, collections::{hash_map::Entry, BTreeMap, BinaryHeap, HashMap, HashSet}, fs, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}, sync::{Arc, Mutex as SyncMutex, MutexGuard, PoisonError}, time::{Duration, Instant, SystemTime}};
use tokio::sync::Mutex;

const LINE_LIMIT: usize = 8 * 1024 * 1024;
const TAIL: usize = 64 * 1024;
const RECORD_LIMIT: usize = 100_000;
const SAFE_TOTAL: u64 = 9_007_199_254_740_991;
// The per-file extraction cache holds usage metadata only, bounded by record and file counts.
const CACHE_RECORDS: usize = 250_000;
const CACHE_FILES: usize = 10_000;

#[derive(Clone, Copy)]
struct Limits { files: usize, candidates: usize, directories: usize, depth: usize, bytes: u64 }
const LIMITS: Limits = Limits { files: 2000, candidates: 200_000, directories: 5000, depth: 16, bytes: 8 * 1024 * 1024 * 1024 };

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens { input_tokens: u64, cached_input_tokens: u64, cache_write_tokens: u64, #[serde(skip)] cache_write_1h_tokens: u64, output_tokens: u64, total_tokens: u64 }
impl Tokens {
    fn parse(value: &Value, claude: bool) -> Option<Self> {
        let input = value["input_tokens"].as_u64()?;
        let output = value["output_tokens"].as_u64()?;
        let cached = value[if claude { "cache_read_input_tokens" } else { "cached_input_tokens" }].as_u64().unwrap_or(0);
        let write = value["cache_creation_input_tokens"].as_u64().unwrap_or(0);
        let hour_write = value.pointer("/cache_creation/ephemeral_1h_input_tokens").and_then(Value::as_u64).unwrap_or(0);
        let input = if claude { input.checked_add(cached)?.checked_add(write)? } else { input };
        if cached.checked_add(write)? > input || hour_write > write { return None; }
        let total = input.checked_add(output)?;
        if total > SAFE_TOTAL { return None; }
        Some(Self { input_tokens: input, output_tokens: output, cached_input_tokens: cached, cache_write_tokens: write, cache_write_1h_tokens: hour_write, total_tokens: total })
    }
    fn delta(&self, previous: &Self) -> Self {
        // Reasoning tokens are already part of output; cached inputs are already part of input.
        if self.total_tokens < previous.total_tokens { return self.clone(); }
        Self { input_tokens: self.input_tokens.saturating_sub(previous.input_tokens), cached_input_tokens: self.cached_input_tokens.saturating_sub(previous.cached_input_tokens), cache_write_tokens: self.cache_write_tokens.saturating_sub(previous.cache_write_tokens), cache_write_1h_tokens: self.cache_write_1h_tokens.saturating_sub(previous.cache_write_1h_tokens), output_tokens: self.output_tokens.saturating_sub(previous.output_tokens), total_tokens: self.total_tokens.saturating_sub(previous.total_tokens) }
    }
    fn add(&mut self, other: &Self) {
        self.input_tokens += other.input_tokens; self.cached_input_tokens += other.cached_input_tokens;
        self.cache_write_tokens += other.cache_write_tokens; self.output_tokens += other.output_tokens; self.total_tokens += other.total_tokens;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day { date: String, #[serde(flatten)] tokens: Tokens, unpriced_tokens: u64, estimated_cost_usd: Option<f64> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model { name: String, total_tokens: u64 }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History { period_days: u32, available: bool, partial: bool, record_count: usize, scanned_at: i64, today: String, coverage_start: Option<String>, days: Vec<Day>, models: Vec<Model> }

// Narrow rows: message content, prompts and tool data are skipped by the parser and never stored.
#[derive(Deserialize)]
struct Row { #[serde(rename = "type", default)] kind: Value, #[serde(default)] timestamp: Value, message: Option<Message>, payload: Option<Payload> }
#[derive(Deserialize)]
struct Message { #[serde(default)] id: Value, #[serde(default)] model: Value, #[serde(default)] usage: Value }
#[derive(Deserialize)]
struct Payload { #[serde(rename = "type", default)] kind: Value, #[serde(default)] model: Value, info: Option<Info> }
#[derive(Deserialize)]
struct Info { #[serde(default)] total_token_usage: Value }

#[derive(Clone, PartialEq, Eq, Hash)]
enum Key { Claude(Box<str>), Codex(i64, u64, u64, u64) }
/// One usage record of one file: a Claude message (key None when it has no id) or a Codex token delta.
struct Usage { date: NaiveDate, model: Arc<str>, key: Option<Key>, tokens: Tokens, fast: bool }
#[derive(Default)]
struct Extract { records: Vec<Usage>, partial: bool, cacheable: bool }

fn relevant(id: ProviderId, bytes: &[u8]) -> bool {
    // The whole line is searched: Claude Code writes the top-level "type" after the (often large) message.
    let text = String::from_utf8_lossy(bytes);
    let has_type = |kind: &str| text.contains(&format!("\"type\":\"{kind}\"")) || text.contains(&format!("\"type\": \"{kind}\""));
    match id {
        ProviderId::Claude => text.contains("\"usage\"") && has_type("assistant"),
        ProviderId::Codex => has_type("turn_context") || (has_type("event_msg") && has_type("token_count")),
        ProviderId::Cursor => false,
    }
}

fn extract(id: ProviderId, mut reader: impl BufRead) -> Extract {
    let claude = matches!(id, ProviderId::Claude);
    let mut out = Extract { cacheable: true, ..Extract::default() };
    let (mut model, mut previous): (Arc<str>, Tokens) = (Arc::from("Unknown model"), Tokens::default());
    let (mut messages, mut events) = (HashMap::<(Box<str>, NaiveDate), usize>::new(), HashSet::<Key>::new());
    let latest = Utc::now().timestamp_millis() + 300_000;
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        // A failed read keeps what was read so far, marks the result partial and is retried next scan.
        let Ok(length) = reader.by_ref().take(LINE_LIMIT as u64 + 1).read_until(b'\n', &mut bytes) else { out.partial = true; out.cacheable = false; break; };
        if length == 0 { break; }
        if length > LINE_LIMIT {
            // Too large to parse: skip the rest, keeping its end to tell whether it was a usage record.
            let mut tail = bytes[bytes.len() - TAIL..].to_vec();
            if bytes.last() != Some(&b'\n') {
                loop {
                    let Ok(buffer) = reader.fill_buf() else { out.partial = true; out.cacheable = false; return out; };
                    if buffer.is_empty() { break; }
                    let end = buffer.iter().position(|byte| *byte == b'\n'); let count = end.map_or(buffer.len(), |index| index + 1);
                    tail.extend_from_slice(&buffer[..count]); reader.consume(count);
                    if tail.len() > 2 * TAIL { tail.drain(..tail.len() - TAIL); }
                    if end.is_some() { break; }
                }
            }
            if relevant(id, &bytes) || relevant(id, &tail) { out.partial = true; }
            continue;
        }
        if !relevant(id, &bytes) { continue; }
        let Ok(row) = serde_json::from_slice::<Row>(&bytes) else { continue; };
        if !claude && row.kind == "turn_context" {
            let name = row.payload.as_ref().and_then(|payload| payload.model.as_str()).filter(|name| name.len() < 200).unwrap_or("Unknown model");
            if *model != *name { model = Arc::from(name); }
            continue;
        }
        let Some(timestamp) = row.timestamp.as_str().and_then(|text| DateTime::parse_from_rfc3339(text).ok()) else { continue; };
        if timestamp.timestamp_millis() > latest { out.partial = true; out.cacheable = false; continue; }
        let date = timestamp.with_timezone(&Local).date_naive();
        if out.records.len() >= RECORD_LIMIT { out.partial = true; break; }
        if claude && row.kind == "assistant" {
            let Some(message) = row.message.filter(|message| message.usage.is_object()) else { continue; };
            let Some(tokens) = Tokens::parse(&message.usage, true).filter(|tokens| tokens.total_tokens > 0) else { continue; };
            let fast = message.usage["speed"] == "fast";
            let name = message.model.as_str().filter(|name| !name.is_empty() && *name != "<synthetic>" && name.len() < 200).unwrap_or("Unknown model");
            if *model != *name { model = Arc::from(name); }
            let Some(key) = message.id.as_str().filter(|key| !key.is_empty() && key.len() < 200) else { out.records.push(Usage { date, model: model.clone(), key: None, tokens, fast }); continue; };
            // Streamed content blocks repeat one message's usage: keep one record per message and day, at its largest.
            match messages.entry((Box::from(key), date)) {
                Entry::Occupied(slot) => { let record = &mut out.records[*slot.get()]; if tokens.total_tokens > record.tokens.total_tokens { record.tokens = tokens; } record.fast |= fast; }
                Entry::Vacant(slot) => { slot.insert(out.records.len()); out.records.push(Usage { date, model: model.clone(), key: Some(Key::Claude(Box::from(key))), tokens, fast }); }
            }
        } else if !claude && row.kind == "event_msg" {
            let Some(total) = row.payload.filter(|payload| payload.kind == "token_count").and_then(|payload| payload.info).and_then(|info| Tokens::parse(&info.total_token_usage, false)) else { continue; };
            let delta = total.delta(&previous);
            let key = Key::Codex(timestamp.timestamp_millis(), total.input_tokens, total.cached_input_tokens, total.output_tokens);
            previous = total;
            // Totals are cumulative per file; copies of an event across files are removed by the scan.
            if events.insert(key.clone()) { out.records.push(Usage { date, model: model.clone(), key: Some(key), tokens: delta, fast: false }); }
        }
    }
    out.records.shrink_to_fit();
    out
}

struct Total { tokens: Tokens, unpriced: u64, cost: Option<f64> }
struct Scanner {
    claude: bool, days: BTreeMap<NaiveDate, Total>, models: HashMap<Arc<str>, u64>, seen: HashSet<Key>,
    messages: HashMap<Box<str>, (NaiveDate, Arc<str>, Tokens, bool)>, records: usize, partial: bool,
}
impl Scanner {
    fn new(id: ProviderId, today: NaiveDate, period_days: u32) -> Self {
        let days = (0..u64::from(period_days)).filter_map(|offset| today.checked_sub_days(Days::new(offset))).map(|date| (date, Total { tokens: Tokens::default(), unpriced: 0, cost: Some(0.0) })).collect();
        Self { claude: matches!(id, ProviderId::Claude), days, models: HashMap::new(), seen: HashSet::new(), messages: HashMap::new(), records: 0, partial: false }
    }
    fn add(&mut self, date: NaiveDate, model: &Arc<str>, tokens: &Tokens, fast: bool) {
        if tokens.total_tokens == 0 { return; }
        let model_total = self.models.get(model).copied().unwrap_or(0).checked_add(tokens.total_tokens);
        let Some(day) = self.days.get_mut(&date) else { return; };
        if !day.tokens.total_tokens.checked_add(tokens.total_tokens).is_some_and(|total| total <= SAFE_TOTAL) || !model_total.is_some_and(|total| total <= SAFE_TOTAL) { self.partial = true; return; }
        day.tokens.add(tokens);
        match crate::pricing::claude_value(model, tokens.input_tokens, tokens.output_tokens, tokens.cached_input_tokens, tokens.cache_write_tokens, tokens.cache_write_1h_tokens, fast) {
            Some(value) => day.cost = day.cost.map(|prior| prior + value),
            // Claude days keep the value of priced tokens and count the rest; a Codex day with any unpriced model has no value.
            None if self.claude => day.unpriced += tokens.total_tokens,
            None => day.cost = None,
        }
        *self.models.entry(model.clone()).or_default() += tokens.total_tokens;
        self.records += 1;
    }
    fn absorb(&mut self, records: &[Usage]) {
        for record in records {
            if !self.days.contains_key(&record.date) { continue; }
            match &record.key {
                None => self.partial = true,
                Some(Key::Claude(id)) => {
                    // Copied and sidechain logs repeat a message: count it once, at its largest usage.
                    if let Some(entry) = self.messages.get_mut(id) { if record.tokens.total_tokens > entry.2.total_tokens { entry.2 = record.tokens.clone(); } entry.3 |= record.fast; continue; }
                    if self.messages.len() >= RECORD_LIMIT { self.partial = true; continue; }
                    self.messages.insert(id.clone(), (record.date, record.model.clone(), record.tokens.clone(), record.fast));
                }
                Some(key) if self.seen.contains(key) => {}
                Some(_) if self.seen.len() >= RECORD_LIMIT => self.partial = true,
                Some(key) => { self.seen.insert(key.clone()); self.add(record.date, &record.model, &record.tokens, record.fast); }
            }
        }
    }
    fn finish(mut self, available: bool, today: NaiveDate) -> History {
        for (_, (date, model, tokens, fast)) in std::mem::take(&mut self.messages) { self.add(date, &model, &tokens, fast); }
        let mut models: Vec<Model> = self.models.into_iter().map(|(name, total_tokens)| Model { name: name.to_string(), total_tokens }).collect();
        models.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens).then_with(|| a.name.cmp(&b.name)));
        // Days before the first recorded usage are not recorded (missing or deleted logs), not zero-cost days.
        let coverage = self.days.iter().find(|(_, day)| day.tokens.total_tokens > 0).map(|(date, _)| *date);
        let period_days = self.days.len() as u32;
        let days = self.days.into_iter().map(|(date, day)| Day { date: date.to_string(), estimated_cost_usd: day.cost.filter(|_| coverage.is_some_and(|start| date >= start)), unpriced_tokens: day.unpriced, tokens: day.tokens }).collect();
        History { period_days, available, partial: self.partial, record_count: self.records, scanned_at: Utc::now().timestamp_millis(), today: today.to_string(), coverage_start: coverage.map(|date| date.to_string()), days, models }
    }
}

type Candidates = BinaryHeap<Reverse<(SystemTime, PathBuf)>>;
struct Walk { directories: usize, candidates: usize, cutoff: SystemTime, limits: Limits }
fn collect(root: &Path, depth: usize, files: &mut Candidates, walk: &mut Walk, partial: &mut bool) {
    if walk.directories >= walk.limits.directories || depth > walk.limits.depth { *partial = true; return; }
    walk.directories += 1;
    let Ok(entries) = fs::read_dir(root) else { *partial = true; return; };
    for entry in entries {
        let Ok(entry) = entry else { *partial = true; continue; };
        let Ok(kind) = entry.file_type() else { *partial = true; continue; };
        let path = entry.path();
        if kind.is_symlink() { continue; }
        if kind.is_dir() { collect(&path, depth + 1, files, walk, partial); continue; }
        if !kind.is_file() || !path.extension().is_some_and(|extension| extension == "jsonl") { continue; }
        // Metadata only: every candidate competes, and the newest files are kept when there are too many.
        if walk.candidates >= walk.limits.candidates { *partial = true; return; }
        walk.candidates += 1;
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else { *partial = true; continue; };
        if modified < walk.cutoff { continue; }
        files.push(Reverse((modified, path)));
        if files.len() > walk.limits.files { files.pop(); *partial = true; }
    }
}

#[derive(Default)]
struct FileCache { entries: HashMap<(bool, PathBuf), Cached>, records: usize, tick: u64, zone: Option<i32>, parses: usize }
struct Cached { len: u64, modified: SystemTime, used: u64, parsed: Arc<Extract> }
impl FileCache {
    fn zone(&mut self, offset: i32) { if self.zone.replace(offset).is_some_and(|zone| zone != offset) { self.entries.clear(); self.records = 0; } }
    fn get(&mut self, key: &(bool, PathBuf), len: u64, modified: SystemTime) -> Option<Arc<Extract>> {
        self.tick += 1; let tick = self.tick;
        let found = self.entries.get_mut(key).filter(|entry| entry.len == len && entry.modified == modified).map(|entry| { entry.used = tick; entry.parsed.clone() });
        if found.is_none() { self.parses += 1; }
        found
    }
    fn insert(&mut self, key: (bool, PathBuf), len: u64, modified: SystemTime, parsed: Arc<Extract>) {
        if let Some(old) = self.entries.remove(&key) { self.records -= old.parsed.records.len(); }
        if parsed.records.len() > CACHE_RECORDS / 4 { return; }
        self.tick += 1; self.records += parsed.records.len();
        self.entries.insert(key, Cached { len, modified, used: self.tick, parsed });
        if self.records <= CACHE_RECORDS && self.entries.len() <= CACHE_FILES { return; }
        // Evict the least recently used files down to three quarters of both bounds.
        let mut order: Vec<(u64, (bool, PathBuf))> = self.entries.iter().map(|(key, entry)| (entry.used, key.clone())).collect();
        order.sort_unstable_by_key(|(used, _)| *used);
        for (_, key) in order {
            if self.records <= CACHE_RECORDS / 4 * 3 && self.entries.len() <= CACHE_FILES / 4 * 3 { break; }
            if let Some(old) = self.entries.remove(&key) { self.records -= old.parsed.records.len(); }
        }
    }
}
fn lock<T>(mutex: &SyncMutex<T>) -> MutexGuard<'_, T> { mutex.lock().unwrap_or_else(PoisonError::into_inner) }

fn extracted(id: ProviderId, file: fs::File, path: &Path, len: u64, modified: SystemTime, cache: &SyncMutex<FileCache>) -> Arc<Extract> {
    // Unchanged files (same path, length and modification time) reuse their earlier extraction.
    let key = (matches!(id, ProviderId::Claude), path.to_path_buf());
    if let Some(hit) = lock(cache).get(&key, len, modified) { return hit; }
    let parsed = Arc::new(extract(id, BufReader::with_capacity(64 * 1024, file.take(len))));
    if parsed.cacheable { lock(cache).insert(key, len, modified, parsed.clone()); }
    parsed
}

fn scan_roots(id: ProviderId, roots: &[PathBuf], today: NaiveDate, period_days: u32, limits: Limits, cache: &SyncMutex<FileCache>) -> History {
    let mut scanner = Scanner::new(id, today, period_days);
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(u64::from(period_days + 1) * 86400)).unwrap_or(SystemTime::UNIX_EPOCH);
    let (mut walk, mut files, mut available) = (Walk { directories: 0, candidates: 0, cutoff, limits }, Candidates::new(), false);
    for root in roots.iter().filter(|root| root.is_dir()) { available = true; collect(root, 0, &mut files, &mut walk, &mut scanner.partial); }
    let mut files: Vec<(SystemTime, PathBuf)> = files.into_iter().map(|Reverse(file)| file).collect();
    files.sort_by(|a, b| b.cmp(a));
    lock(cache).zone(Local::now().offset().local_minus_utc());
    let mut remaining = limits.bytes;
    for (_, path) in files {
        // An unreadable file only makes the result partial; the other files are still counted.
        let Ok(file) = fs::File::open(&path) else { scanner.partial = true; continue; };
        let Ok(metadata) = file.metadata() else { scanner.partial = true; continue; };
        let (len, modified) = (metadata.len(), metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        // Stop at file boundaries rather than inventing deltas from a truncated cumulative stream.
        if len > remaining { scanner.partial = true; continue; }
        remaining -= len;
        let parsed = extracted(id, file, &path, len, modified, cache);
        scanner.partial |= parsed.partial;
        scanner.absorb(&parsed.records);
    }
    scanner.finish(available, today)
}

fn scan(id: ProviderId, root: Option<PathBuf>, period_days: u32, cache: &SyncMutex<FileCache>) -> History {
    let roots = match root {
        Some(root) if matches!(id, ProviderId::Claude) => vec![root.join("projects")],
        Some(root) => vec![root.join("sessions"), root.join("archived_sessions")],
        None => vec![],
    };
    scan_roots(id, &roots, Local::now().date_naive(), period_days, LIMITS, cache)
}

#[derive(Default)]
pub struct HistoryService { results: SyncMutex<HashMap<String, (Instant, History)>>, profiles: SyncMutex<HashMap<String, Arc<Mutex<()>>>>, files: Arc<SyncMutex<FileCache>> }
impl HistoryService {
    async fn read(&self, id: ProviderId, root: Option<PathBuf>, days: u32) -> Result<History, String> {
        let profile = format!("{}:{}", match id { ProviderId::Claude => "claude", ProviderId::Codex => "codex", ProviderId::Cursor => "cursor" }, root.as_deref().map(Path::to_string_lossy).unwrap_or_default());
        let key = format!("{profile}:{days}");
        // One scan per provider profile at a time; a request that waited reuses the result it waited for.
        let gate = { let mut gates = lock(&self.profiles); gates.retain(|_, gate| Arc::strong_count(gate) > 1); gates.entry(profile).or_default().clone() };
        let _turn = gate.lock().await;
        if let Some(history) = lock(&self.results).get(&key).filter(|(until, _)| *until > Instant::now()).map(|(_, history)| history.clone()) { return Ok(history); }
        let files = self.files.clone();
        let history = tauri::async_runtime::spawn_blocking(move || scan(id, root, days, &files)).await.map_err(|_| "Usage history could not be read.")?;
        let mut results = lock(&self.results);
        results.retain(|_, (until, _)| *until > Instant::now());
        if results.len() >= 16 { results.clear(); }
        results.insert(key, (Instant::now() + Duration::from_secs(60), history.clone()));
        Ok(history)
    }
}
#[tauri::command]
pub async fn read_usage_history(service: tauri::State<'_, HistoryService>, provider_id: ProviderId, config_directory: Option<String>, days: Option<u32>) -> Result<History, String> {
    let days = checked_days(days)?;
    let root = if matches!(provider_id, ProviderId::Cursor) { None } else { Some(crate::profiles::root(provider_id, config_directory.as_deref())?) };
    service.read(provider_id, root, days).await
}

fn checked_days(days: Option<u32>) -> Result<u32, String> {
    match days.unwrap_or(30) { days @ (30 | 90 | 365) => Ok(days), _ => Err("Choose a 30, 90, or 365 day history window.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    struct Temp(PathBuf);
    impl Temp { fn new(name: &str) -> Self { let path = std::env::temp_dir().join(format!("meterluma-history-{name}-{}-{}", std::process::id(), Utc::now().timestamp_nanos_opt().unwrap_or_default())); fs::create_dir_all(&path).unwrap(); Self(path) } }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn ago(minutes: i64) -> String { (Utc::now() - chrono::TimeDelta::minutes(minutes)).to_rfc3339() }
    fn write(path: &Path, lines: &[String]) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, lines.join("\n") + "\n").unwrap(); }
    fn age(path: &Path, hours: u64) { fs::File::options().write(true).open(path).unwrap().set_modified(SystemTime::now() - Duration::from_secs(hours * 3600)).unwrap(); }
    fn run(id: ProviderId, root: &Path, limits: Limits, cache: &SyncMutex<FileCache>) -> History { scan_roots(id, &[root.to_path_buf()], Local::now().date_naive(), 30, limits, cache) }
    fn total(history: &History) -> u64 { history.days.iter().map(|day| day.tokens.total_tokens).sum() }
    // A Claude Code assistant row as written to disk: the top-level "type" follows the whole message.
    // Usage: 4 fresh + 20,000 cache reads + 1,000 cache writes = 21,004 input tokens, plus `output`.
    fn claude_line(id: &str, timestamp: &str, output: u64, content: &str) -> String {
        format!(r#"{{"parentUuid":"p-1","isSidechain":false,"userType":"external","cwd":"/work/app","sessionId":"s-1","version":"2.1.0","gitBranch":"main","message":{{"id":"{id}","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{{"type":"tool_use","id":"toolu_1","name":"Write","input":{{"file_path":"/work/app/src/lib.rs","content":"{content}"}}}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{{"input_tokens":4,"cache_creation_input_tokens":1000,"cache_read_input_tokens":20000,"cache_creation":{{"ephemeral_5m_input_tokens":1000,"ephemeral_1h_input_tokens":0}},"output_tokens":{output},"service_tier":"standard"}}}},"requestId":"req-{id}","type":"assistant","uuid":"u-{id}-{output}","timestamp":"{timestamp}"}}"#)
    }
    fn user_line(timestamp: &str) -> String { format!(r#"{{"parentUuid":null,"isSidechain":false,"type":"user","message":{{"role":"user","content":"private prompt about \"usage\" and the assistant"}},"uuid":"u-0","timestamp":"{timestamp}"}}"#) }
    fn codex_count(timestamp: &str, input: u64, cached: u64, output: u64) -> String {
        format!(r#"{{"timestamp":"{timestamp}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output},"reasoning_output_tokens":5,"total_tokens":{}}},"last_token_usage":{{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}},"model_context_window":272000}},"rate_limits":{{"primary":{{"used_percent":10.0,"window_minutes":300}}}}}}}}"#, input + output)
    }

    #[test]
    fn history_periods_are_bounded_and_include_older_activity() {
        assert!(checked_days(Some(366)).is_err());
        assert_eq!(checked_days(None).unwrap(), 30);
        let today = Local::now().date_naive();
        let mut scan = Scanner::new(ProviderId::Claude, today, 365);
        scan.add(today.checked_sub_days(Days::new(180)).unwrap(), &Arc::from("older-model"), &Tokens { input_tokens: 10, output_tokens: 5, total_tokens: 15, ..Tokens::default() }, false);
        let history = scan.finish(true, today);
        assert_eq!(history.days.len(), 365);
        assert_eq!(history.models[0].total_tokens, 15);
    }
    #[test]
    fn claude_rows_with_type_after_a_large_message_are_counted() {
        let line = claude_line("msg_large", &ago(5), 350, &"fn main() {} ".repeat(500));
        assert!(line.find(r#""type":"assistant""#).unwrap() > 4096 && line.len() > 6000);
        assert!(relevant(ProviderId::Claude, line.as_bytes()));
        let temp = Temp::new("large"); write(&temp.0.join("p/session.jsonl"), &[user_line(&ago(6)), line]);
        let history = run(ProviderId::Claude, &temp.0, LIMITS, &SyncMutex::default());
        assert!(!history.partial);
        assert_eq!((history.record_count, total(&history)), (1, 21_354));
        assert_eq!(history.models[0].name, "claude-opus-5-5");
    }
    #[test]
    fn claude_streamed_chunks_and_sidechain_copies_count_one_message_at_its_largest() {
        let temp = Temp::new("stream");
        write(&temp.0.join("p/session.jsonl"), &[claude_line("msg_stream", &ago(9), 10, "a"), claude_line("msg_stream", &ago(9), 10, "b"), claude_line("msg_stream", &ago(9), 20, "c"), claude_line("msg_other", &ago(8), 1, "d")]);
        write(&temp.0.join("p/session/subagents/agent-1.jsonl"), &[claude_line("msg_stream", &ago(9), 15, "a")]);
        let history = run(ProviderId::Claude, &temp.0, LIMITS, &SyncMutex::default());
        assert_eq!((history.record_count, total(&history)), (2, 21_024 + 21_005));
    }
    #[test]
    fn codex_counts_cumulative_deltas_once_across_copied_sessions() {
        let temp = Temp::new("codex"); let (first, second) = (ago(20), ago(10));
        let header = [format!(r#"{{"timestamp":"{first}","type":"session_meta","payload":{{"id":"s","cwd":"/work","instructions":"private instructions"}}}}"#),
            format!(r#"{{"timestamp":"{first}","type":"turn_context","payload":{{"cwd":"/work","approval_policy":"on-request","model":"gpt-5-codex","user_instructions":"private"}}}}"#),
            format!(r#"{{"timestamp":"{first}","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"private prompt"}}]}}}}"#)];
        let mut lines = header.to_vec(); lines.extend([codex_count(&first, 100, 80, 10), format!(r#"{{"timestamp":"{first}","type":"event_msg","payload":{{"type":"token_count","info":null}}}}"#), codex_count(&second, 150, 100, 20)]);
        write(&temp.0.join("2026/10/15/rollout-a.jsonl"), &lines);
        // A resumed session copies earlier events; they must not be counted twice.
        write(&temp.0.join("2026/10/14/rollout-b.jsonl"), &[header[1].clone(), codex_count(&first, 100, 80, 10), codex_count(&second, 150, 100, 20)]);
        let history = run(ProviderId::Codex, &temp.0, LIMITS, &SyncMutex::default());
        assert_eq!(total(&history), 170);
        assert_eq!(history.days.iter().map(|day| day.tokens.cached_input_tokens).sum::<u64>(), 100);
        assert_eq!(history.models[0].name, "gpt-5-codex");
        assert!(history.days.iter().filter(|day| day.tokens.total_tokens > 0).all(|day| day.estimated_cost_usd.is_none() && day.unpriced_tokens == 0));
        let json = serde_json::to_string(&history).unwrap(); assert!(!json.contains("private"));
    }
    #[test]
    fn the_newest_files_are_kept_when_there_are_more_than_the_file_limit() {
        let temp = Temp::new("limit");
        for index in 0..5u64 { let path = temp.0.join(format!("p{index}/session.jsonl")); write(&path, &[claude_line(&format!("msg_{index}"), &ago(30), 1 << index, "x")]); age(&path, 5 - index); }
        let history = run(ProviderId::Claude, &temp.0, Limits { files: 3, ..LIMITS }, &SyncMutex::default());
        assert!(history.partial);
        assert_eq!((history.record_count, total(&history)), (3, 3 * 21_004 + 4 + 8 + 16));
        let all = run(ProviderId::Claude, &temp.0, LIMITS, &SyncMutex::default());
        assert!(!all.partial && all.record_count == 5);
    }
    #[test]
    fn an_unreadable_file_marks_the_result_partial_and_keeps_the_rest() {
        let temp = Temp::new("unreadable"); let locked = temp.0.join("p/locked.jsonl");
        write(&temp.0.join("p/readable.jsonl"), &[claude_line("msg_ok", &ago(5), 6, "x")]); write(&locked, &[claude_line("msg_locked", &ago(5), 7, "x")]);
        #[cfg(windows)]
        let _guard = { use std::os::windows::fs::OpenOptionsExt; fs::OpenOptions::new().read(true).share_mode(0).open(&locked).unwrap() };
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&locked, fs::Permissions::from_mode(0)).unwrap(); if fs::File::open(&locked).is_ok() { return; } }
        let history = run(ProviderId::Claude, &temp.0, LIMITS, &SyncMutex::default());
        assert!(history.partial && history.available);
        assert_eq!(total(&history), 21_010);
    }
    #[test]
    fn a_read_error_mid_file_keeps_earlier_records_and_is_not_cached() {
        struct Failing(Cursor<Vec<u8>>);
        impl Read for Failing { fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> { match self.0.read(buffer)? { 0 => Err(std::io::Error::other("device error")), count => Ok(count) } } }
        let parsed = extract(ProviderId::Claude, BufReader::new(Failing(Cursor::new((claude_line("msg_1", &ago(5), 1, "x") + "\n").into_bytes()))));
        assert!(parsed.partial && !parsed.cacheable);
        assert_eq!(parsed.records.len(), 1);
    }
    #[test]
    fn oversized_usage_lines_are_skipped_but_reported_partial() {
        let big = claude_line("msg_big", &ago(5), 1, &"y".repeat(LINE_LIMIT + 10));
        let small = claude_line("msg_small", &ago(5), 2, "z");
        let parsed = extract(ProviderId::Claude, Cursor::new(format!("{big}\n{small}\n").into_bytes()));
        assert!(parsed.partial && parsed.cacheable && parsed.records.len() == 1);
        let user = format!(r#"{{"type":"user","message":{{"content":"{}"}}}}"#, "q".repeat(LINE_LIMIT + 10));
        assert!(!extract(ProviderId::Claude, Cursor::new(format!("{user}\n{small}\n").into_bytes())).partial);
    }
    #[test]
    fn coverage_starts_at_the_first_recorded_day_and_earlier_days_have_no_value() {
        let today = Local::now().date_naive(); let mut scan = Scanner::new(ProviderId::Claude, today, 365);
        for offset in 0..30 { scan.add(today.checked_sub_days(Days::new(offset)).unwrap(), &Arc::from("claude-opus-5-5"), &Tokens { input_tokens: 1_000_000, total_tokens: 1_000_000, ..Tokens::default() }, false); }
        let history = scan.finish(true, today); let start = today.checked_sub_days(Days::new(29)).unwrap().to_string();
        assert_eq!(history.coverage_start.as_deref(), Some(start.as_str()));
        let (before, after): (Vec<&Day>, Vec<&Day>) = history.days.iter().partition(|day| day.date < start);
        assert_eq!((before.len(), after.len()), (335, 30));
        assert!(before.iter().all(|day| day.estimated_cost_usd.is_none() && day.tokens.total_tokens == 0));
        assert!(after.iter().all(|day| day.estimated_cost_usd.is_some_and(|value| (value - 4.0).abs() < 0.000001)));
        let json = serde_json::to_value(&history).unwrap();
        assert_eq!(json["coverageStart"], start.as_str()); assert_eq!(json["days"][0]["estimatedCostUsd"], Value::Null); assert_eq!(json["days"][364]["unpricedTokens"], 0);
        let empty = Scanner::new(ProviderId::Claude, today, 30).finish(true, today);
        assert!(empty.coverage_start.is_none() && empty.days.iter().all(|day| day.estimated_cost_usd.is_none()));
    }
    #[test]
    fn unpriced_models_are_counted_separately_from_the_priced_value() {
        let today = Local::now().date_naive(); let yesterday = today.checked_sub_days(Days::new(1)).unwrap(); let two_days = today.checked_sub_days(Days::new(2)).unwrap();
        let mut scan = Scanner::new(ProviderId::Claude, today, 30);
        scan.add(today, &Arc::from("claude-opus-5-5"), &Tokens { input_tokens: 1_000_000, total_tokens: 1_000_000, ..Tokens::default() }, false);
        scan.add(today, &Arc::from("claude-experimental-9"), &Tokens { input_tokens: 1, total_tokens: 1, ..Tokens::default() }, false);
        scan.add(yesterday, &Arc::from("Unknown model"), &Tokens { output_tokens: 7, total_tokens: 7, ..Tokens::default() }, false);
        scan.add(two_days, &Arc::from("us.anthropic.claude-opus-5-5-v1:0"), &Tokens { output_tokens: 1_000_000, total_tokens: 1_000_000, ..Tokens::default() }, true);
        let history = scan.finish(true, today); let days = &history.days[history.days.len() - 3..];
        assert!((days[2].estimated_cost_usd.unwrap() - 4.0).abs() < 0.000001 && days[2].unpriced_tokens == 1 && days[2].tokens.total_tokens == 1_000_001);
        assert_eq!((days[1].estimated_cost_usd, days[1].unpriced_tokens), (Some(0.0), 7));
        assert!((days[0].estimated_cost_usd.unwrap() - 40.0).abs() < 0.000001 && days[0].unpriced_tokens == 0);
        let mut codex = Scanner::new(ProviderId::Codex, today, 30);
        codex.add(yesterday, &Arc::from("gpt-5-codex"), &Tokens { input_tokens: 10, total_tokens: 10, ..Tokens::default() }, false);
        let history = codex.finish(true, today); let days = &history.days[history.days.len() - 2..];
        assert_eq!((days[0].estimated_cost_usd, days[0].unpriced_tokens), (None, 0));
        assert_eq!((days[1].estimated_cost_usd, days[1].unpriced_tokens), (Some(0.0), 0));
    }
    #[test]
    fn unchanged_files_are_served_from_the_cache_and_appends_are_reparsed() {
        let temp = Temp::new("cache"); let path = temp.0.join("p/session.jsonl"); let cache = SyncMutex::default();
        write(&path, &[claude_line("msg_1", &ago(9), 1, "x")]); write(&temp.0.join("p/other.jsonl"), &[claude_line("msg_2", &ago(9), 2, "x")]);
        assert_eq!(total(&run(ProviderId::Claude, &temp.0, LIMITS, &cache)), 42_011);
        assert_eq!(lock(&cache).parses, 2);
        assert_eq!(total(&run(ProviderId::Claude, &temp.0, LIMITS, &cache)), 42_011);
        assert_eq!(lock(&cache).parses, 2);
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all((claude_line("msg_3", &ago(1), 3, "x") + "\n").as_bytes()).unwrap();
        let history = run(ProviderId::Claude, &temp.0, LIMITS, &cache);
        assert_eq!((history.record_count, total(&history)), (3, 63_018));
        assert_eq!(lock(&cache).parses, 3);
        // The same files read as Codex logs are cached separately.
        run(ProviderId::Codex, &temp.0, LIMITS, &cache); assert_eq!(lock(&cache).parses, 5);
    }
    #[test]
    fn the_extraction_cache_is_bounded() {
        let mut cache = FileCache::default();
        let parsed = || Arc::new(Extract { records: vec![Usage { date: Local::now().date_naive(), model: Arc::from("m"), key: None, tokens: Tokens::default(), fast: false }], partial: false, cacheable: true });
        for index in 0..CACHE_FILES + 1 { cache.insert((true, PathBuf::from(format!("f{index}"))), 1, SystemTime::UNIX_EPOCH, parsed()); }
        assert!(cache.entries.len() <= CACHE_FILES && cache.records == cache.entries.len());
        assert!(cache.get(&(true, PathBuf::from(format!("f{CACHE_FILES}"))), 1, SystemTime::UNIX_EPOCH).is_some());
        assert!(cache.get(&(true, PathBuf::from("f0")), 1, SystemTime::UNIX_EPOCH).is_none());
        cache.zone(0); cache.zone(3600); assert!(cache.entries.is_empty() && cache.records == 0);
    }
    #[test]
    fn identical_requests_share_one_scan_and_its_result() {
        let temp = Temp::new("service"); write(&temp.0.join("projects/p/session.jsonl"), &[claude_line("msg_1", &ago(5), 1, "x")]);
        let service = Arc::new(HistoryService::default());
        let tasks: Vec<_> = (0..3).map(|_| { let (service, root) = (service.clone(), temp.0.clone()); tauri::async_runtime::spawn(async move { service.read(ProviderId::Claude, Some(root), 30).await }) }).collect();
        let results: Vec<History> = tasks.into_iter().map(|task| tauri::async_runtime::block_on(task).unwrap().unwrap()).collect();
        assert!(results.iter().all(|history| history.scanned_at == results[0].scanned_at && total(history) == 21_005));
        assert_eq!(lock(&service.files).parses, 1);
        let other = tauri::async_runtime::block_on(service.read(ProviderId::Claude, Some(temp.0.clone()), 90)).unwrap();
        assert_eq!((total(&other), lock(&service.files).parses), (21_005, 1));
    }
    #[test]
    fn usage_rejects_negative_counts_and_inconsistent_cache_buckets() {
        assert!(Tokens::parse(&serde_json::json!({"input_tokens":-1,"output_tokens":2}), false).is_none());
        assert!(Tokens::parse(&serde_json::json!({"input_tokens":5,"cached_input_tokens":6,"output_tokens":2}), false).is_none());
    }
    #[test]
    fn history_never_serializes_messages_or_credentials() {
        let line = r#"{"type":"assistant","timestamp":"TS","secret":"private-token","message":{"id":"id","content":"private-message","model":"model-b","usage":{"input_tokens":5,"output_tokens":20}}}"#.replace("TS", &ago(5));
        let today = Local::now().date_naive(); let mut scan = Scanner::new(ProviderId::Claude, today, 30);
        scan.absorb(&extract(ProviderId::Claude, Cursor::new(line.into_bytes())).records);
        let json = serde_json::to_string(&scan.finish(true, today)).unwrap(); assert!(!json.contains("private-token")); assert!(!json.contains("private-message"));
        assert!(json.contains("model-b"));
    }
    #[test]
    fn non_usage_records_are_ignored_before_parsing_conversation_content() {
        assert!(!relevant(ProviderId::Codex, br#"{"type":"response_item","payload":{"type":"message"}}"#));
        assert!(relevant(ProviderId::Codex, br#"{"type":"event_msg","payload":{"type":"token_count"}}"#));
        assert!(!relevant(ProviderId::Claude, br#"{"type":"user","message":{"content":"private"}}"#));
        assert!(!relevant(ProviderId::Claude, user_line(&ago(1)).as_bytes()));
        assert!(relevant(ProviderId::Claude, br#"{"message":{"usage":{}},"type": "assistant"}"#));
        let parsed = extract(ProviderId::Claude, Cursor::new(format!(r#"{{"type":"assistant","timestamp":"{}","message":{{"content":"error without usage"}}}}"#, ago(1)).into_bytes()));
        assert!(!parsed.partial && parsed.records.is_empty());
        let missing_id = extract(ProviderId::Claude, Cursor::new(format!(r#"{{"type":"assistant","timestamp":"{}","message":{{"model":"m","usage":{{"input_tokens":1,"output_tokens":1}}}}}}"#, ago(1)).into_bytes()));
        let mut scan = Scanner::new(ProviderId::Claude, Local::now().date_naive(), 30); scan.absorb(&missing_id.records); assert!(scan.partial);
    }
    #[test]
    fn future_records_are_partial_and_not_cached() {
        let future = (Utc::now() + chrono::TimeDelta::hours(2)).to_rfc3339();
        let parsed = extract(ProviderId::Claude, Cursor::new(claude_line("msg_future", &future, 1, "x").into_bytes()));
        assert!(parsed.partial && !parsed.cacheable && parsed.records.is_empty());
    }
}
