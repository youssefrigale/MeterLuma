use crate::providers::ProviderId;
use chrono::{DateTime, Days, Local, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{collections::{BTreeMap, HashMap, HashSet}, fs, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}, time::{Duration, Instant}};
use tokio::sync::Mutex;

const LINE_LIMIT: usize = 8 * 1024 * 1024;
const BYTE_LIMIT: u64 = 8 * 1024 * 1024 * 1024;
const FILE_LIMIT: usize = 2000;
const RECORD_LIMIT: usize = 100_000;

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
        if total > 9_007_199_254_740_991 { return None; }
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
pub struct Day { date: String, #[serde(flatten)] tokens: Tokens, estimated_cost_usd: Option<f64> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model { name: String, total_tokens: u64 }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History { period_days: u32, available: bool, partial: bool, record_count: usize, scanned_at: i64, today: String, days: Vec<Day>, models: Vec<Model> }

struct Scanner {
    days: BTreeMap<String, Tokens>, costs: BTreeMap<String, Option<f64>>, models: BTreeMap<String, u64>, seen_codex: HashSet<String>,
    claude: HashMap<String, (String, String, Tokens)>, records: usize, partial: bool,
}

fn relevant(id: ProviderId, bytes: &[u8]) -> bool {
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let has_type = |kind: &str| prefix.contains(&format!("\"type\":\"{kind}\"")) || prefix.contains(&format!("\"type\": \"{kind}\""));
    match id {
        ProviderId::Claude => has_type("assistant"),
        ProviderId::Codex => has_type("turn_context") || (has_type("event_msg") && has_type("token_count")),
        ProviderId::Cursor => false,
    }
}
impl Scanner {
    #[cfg(test)]
    fn new(today: chrono::NaiveDate) -> Self { Self::with_days(today, 30) }
    fn with_days(today: chrono::NaiveDate, period_days: u32) -> Self {
        let days: BTreeMap<String, Tokens> = (0..u64::from(period_days)).filter_map(|offset| today.checked_sub_days(Days::new(offset))).map(|date| (date.to_string(), Tokens::default())).collect();
        let costs = days.keys().map(|date| (date.clone(), Some(0.0))).collect();
        Self { days, costs, models: BTreeMap::new(), seen_codex: HashSet::new(), claude: HashMap::new(), records: 0, partial: false }
    }
    fn add(&mut self, date: &str, model: &str, tokens: &Tokens) {
        if tokens.total_tokens == 0 || !self.days.contains_key(date) { return; }
        let day_total = self.days[date].total_tokens.checked_add(tokens.total_tokens);
        let model_total = self.models.get(model).copied().unwrap_or(0).checked_add(tokens.total_tokens);
        if !day_total.is_some_and(|total| total <= 9_007_199_254_740_991) || !model_total.is_some_and(|total| total <= 9_007_199_254_740_991) { self.partial = true; return; }
        self.days.get_mut(date).unwrap().add(tokens);
        let value = crate::pricing::claude_value(model, tokens.input_tokens, tokens.output_tokens, tokens.cached_input_tokens, tokens.cache_write_tokens, tokens.cache_write_1h_tokens);
        let cost = self.costs.get_mut(date).unwrap();
        *cost = cost.and_then(|prior| value.map(|value| prior + value));
        *self.models.entry(model.to_string()).or_default() += tokens.total_tokens;
        self.records += 1;
    }
    fn parse(&mut self, id: ProviderId, row: &Value, model: &mut String, previous: &mut Tokens) {
        if matches!(id, ProviderId::Codex) && row["type"] == "turn_context" {
            *model = row["payload"]["model"].as_str().filter(|name| name.len() < 200).unwrap_or("Unknown model").to_string(); return;
        }
        let Some(timestamp) = row["timestamp"].as_str().and_then(|text| DateTime::parse_from_rfc3339(text).ok()) else { return; };
        if timestamp.timestamp_millis() > Utc::now().timestamp_millis() + 300_000 { self.partial = true; return; }
        let date = timestamp.with_timezone(&Local).date_naive().to_string();
        match id {
            ProviderId::Codex if row["type"] == "event_msg" && row["payload"]["type"] == "token_count" => {
                let Some(total) = Tokens::parse(&row["payload"]["info"]["total_token_usage"], false) else { return; };
                let delta = total.delta(previous); *previous = total.clone();
                if !self.days.contains_key(&date) { return; }
                let key = format!("{}:{}:{}:{}", timestamp.timestamp_millis(), total.input_tokens, total.cached_input_tokens, total.output_tokens);
                if self.seen_codex.len() >= RECORD_LIMIT { self.partial = true; return; }
                if self.seen_codex.insert(key) { self.add(&date, model, &delta); }
            }
            ProviderId::Claude if row["type"] == "assistant" => {
                if !self.days.contains_key(&date) { return; }
                let message = &row["message"];
                if !message["usage"].is_object() { return; }
                let Some(tokens) = Tokens::parse(&message["usage"], true) else { return; };
                if tokens.total_tokens == 0 { return; }
                let Some(key) = message["id"].as_str().filter(|key| !key.is_empty() && key.len() < 200) else { self.partial = true; return; };
                let name = message["model"].as_str().filter(|name| !name.is_empty() && *name != "<synthetic>" && name.len() < 200).unwrap_or("Unknown model").to_string();
                if self.claude.len() >= RECORD_LIMIT { self.partial = true; return; }
                // Streamed assistant chunks and copied/subagent logs must not count the same message twice.
                self.claude.entry(key.to_string()).and_modify(|entry| { if tokens.total_tokens > entry.2.total_tokens { entry.2 = tokens.clone(); } }).or_insert((date, name, tokens));
            }
            _ => {}
        }
    }
    fn finish(mut self, available: bool, today: String) -> History {
        for (_, (date, model, tokens)) in std::mem::take(&mut self.claude) { self.add(&date, &model, &tokens); }
        let mut models: Vec<Model> = self.models.into_iter().map(|(name, total_tokens)| Model { name, total_tokens }).collect();
        models.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
        History { period_days: self.days.len() as u32, available, partial: self.partial, record_count: self.records, scanned_at: Utc::now().timestamp_millis(), today, days: self.days.into_iter().map(|(date, tokens)| { let estimated_cost_usd = self.costs.remove(&date).flatten(); Day { date, tokens, estimated_cost_usd } }).collect(), models }
    }
}

fn collect(root: &Path, files: &mut Vec<(std::time::SystemTime, PathBuf)>, directories: &mut usize, partial: &mut bool, period_days: u32) {
    if *directories >= 5000 || files.len() >= FILE_LIMIT { *partial = true; return; }
    *directories += 1;
    let Ok(entries) = fs::read_dir(root) else { *partial = true; return; };
    let cutoff = std::time::SystemTime::now().checked_sub(Duration::from_secs(u64::from(period_days + 1) * 86400)).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    for entry in entries {
        let Ok(entry) = entry else { *partial = true; continue; };
        let Ok(kind) = entry.file_type() else { *partial = true; continue; };
        if kind.is_symlink() { continue; }
        if kind.is_dir() { collect(&entry.path(), files, directories, partial, period_days); }
        else if kind.is_file() && entry.path().extension().is_some_and(|extension| extension == "jsonl") {
            if files.len() >= FILE_LIMIT { *partial = true; break; }
            match entry.metadata().and_then(|metadata| metadata.modified()) { Ok(modified) if modified >= cutoff => files.push((modified, entry.path())), Err(_) => *partial = true, _ => {} }
        }
    }
}

fn scan(id: ProviderId, directory: Option<String>, period_days: u32) -> Result<History, String> {
    let root = if matches!(id, ProviderId::Cursor) { None } else { Some(crate::profiles::root(id, directory.as_deref())?) };
    let roots = match root {
        Some(root) if matches!(id, ProviderId::Claude) => vec![root.join("projects")],
        Some(root) => vec![root.join("sessions"), root.join("archived_sessions")],
        None => vec![],
    };
    let today = Local::now().date_naive(); let mut scanner = Scanner::with_days(today, period_days);
    let mut files = Vec::new(); let mut directories = 0; let mut available = false;
    for root in roots { if root.is_dir() { available = true; collect(&root, &mut files, &mut directories, &mut scanner.partial, period_days); } }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut remaining = BYTE_LIMIT;
    for (_, path) in files {
        let Ok(file) = fs::File::open(path) else { scanner.partial = true; continue; };
        let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(BYTE_LIMIT + 1);
        // Stop at file boundaries rather than inventing deltas from a truncated cumulative stream.
        if size > remaining { scanner.partial = true; continue; }
        remaining -= size;
        let mut reader = BufReader::new(file.take(size));
        let mut model = "Unknown model".to_string(); let mut previous = Tokens::default();
        loop {
            let mut bytes = Vec::new();
            let length = reader.by_ref().take(LINE_LIMIT as u64 + 1).read_until(b'\n', &mut bytes).map_err(|_| "Local usage logs could not be read.")?;
            if length == 0 { break; }
            if length > LINE_LIMIT {
                if relevant(id, &bytes) { scanner.partial = true; }
                if bytes.last() != Some(&b'\n') {
                    loop { let buffer = reader.fill_buf().map_err(|_| "Local usage logs could not be read.")?; if buffer.is_empty() { break; } let end = buffer.iter().position(|byte| *byte == b'\n'); let count = end.map(|index| index + 1).unwrap_or(buffer.len()); reader.consume(count); if end.is_some() { break; } }
                }
                continue;
            }
            // Only usage/model metadata is returned. Conversation content is never exposed to the UI.
            if relevant(id, &bytes) { if let Ok(row) = serde_json::from_slice::<Value>(&bytes) { scanner.parse(id, &row, &mut model, &mut previous); } }
        }
    }
    Ok(scanner.finish(available, today.to_string()))
}

pub struct HistoryService { caches: Mutex<HashMap<String, (Instant, History)>> }
impl Default for HistoryService { fn default() -> Self { Self { caches: Mutex::new(HashMap::new()) } } }
#[tauri::command]
pub async fn read_usage_history(service: tauri::State<'_, HistoryService>, provider_id: ProviderId, config_directory: Option<String>, days: Option<u32>) -> Result<History, String> {
    let days = checked_days(days)?;
    let root = if matches!(provider_id, ProviderId::Cursor) { None } else { Some(crate::profiles::root(provider_id, config_directory.as_deref())?) };
    let key = format!("{}:{}:{}", match provider_id { ProviderId::Claude => "claude", ProviderId::Codex => "codex", ProviderId::Cursor => "cursor" }, root.as_ref().map(|path| path.to_string_lossy().into_owned()).unwrap_or_default(), days);
    let mut cache = service.caches.lock().await;
    cache.retain(|_, (until, _)| *until > Instant::now());
    if let Some((_, history)) = cache.get(&key) { return Ok(history.clone()); }
    let history = tauri::async_runtime::spawn_blocking(move || scan(provider_id, config_directory, days)).await.map_err(|_| "Usage history could not be read.")??;
    if cache.len() >= 16 { cache.clear(); }
    cache.insert(key, (Instant::now() + Duration::from_secs(60), history.clone()));
    Ok(history)
}

fn checked_days(days: Option<u32>) -> Result<u32, String> {
    match days.unwrap_or(30) { days @ (30 | 90 | 365) => Ok(days), _ => Err("Choose a 30, 90, or 365 day history window.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn history_periods_are_bounded_and_include_older_activity() {
        assert!(checked_days(Some(366)).is_err());
        assert_eq!(checked_days(None).unwrap(), 30);
        let today = Local::now().date_naive();
        let mut scan = Scanner::with_days(today, 365);
        let date = today.checked_sub_days(Days::new(180)).unwrap().to_string();
        scan.add(&date, "older-model", &Tokens { input_tokens: 10, output_tokens: 5, total_tokens: 15, ..Tokens::default() });
        let history = scan.finish(true, today.to_string());
        assert_eq!(history.days.len(), 365);
        assert_eq!(history.models[0].total_tokens, 15);
    }
    fn timestamp() -> String { Utc::now().to_rfc3339() }
    #[test]
    fn unknown_model_activity_does_not_turn_into_zero_or_incomplete_dollar_totals() {
        let today = Local::now().date_naive(); let date = today.to_string(); let mut scanner = Scanner::new(today);
        scanner.add(&date, "claude-opus-5-5", &Tokens { input_tokens: 1_000_000, total_tokens: 1_000_000, ..Tokens::default() });
        assert_eq!(scanner.costs[&date], Some(4.0));
        scanner.add(&date, "unknown-model", &Tokens { input_tokens: 1, total_tokens: 1, ..Tokens::default() });
        let history = scanner.finish(true, date);
        assert_eq!(history.days.last().unwrap().estimated_cost_usd, None);
        assert_eq!(history.days.last().unwrap().tokens.total_tokens, 1_000_001);
    }
    #[test]
    fn codex_counts_deltas_and_deduplicates_copied_events_without_double_counting_reasoning() {
        let today = Local::now().date_naive(); let mut scan = Scanner::new(today); let mut model = "model-a".to_string(); let mut prior = Tokens::default();
        let first = json!({"type":"event_msg","timestamp":timestamp(),"payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":10,"reasoning_output_tokens":5}}}});
        scan.parse(ProviderId::Codex, &first, &mut model, &mut prior);
        scan.parse(ProviderId::Codex, &first, &mut model, &mut Tokens::default());
        let second = json!({"type":"event_msg","timestamp":timestamp(),"payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":100,"output_tokens":20,"reasoning_output_tokens":8}}}});
        scan.parse(ProviderId::Codex, &second, &mut model, &mut prior);
        let history = scan.finish(true, today.to_string());
        assert_eq!(history.days.last().unwrap().tokens.total_tokens, 170);
        assert_eq!(history.days.last().unwrap().tokens.cached_input_tokens, 100);
    }
    #[test]
    fn claude_streamed_chunks_and_sidechains_count_one_message() {
        let today = Local::now().date_naive(); let mut scan = Scanner::new(today);
        for output in [10, 10, 20] {
            scan.parse(ProviderId::Claude, &json!({"type":"assistant","timestamp":timestamp(),"message":{"id":"same-message","model":"model-b","usage":{"input_tokens":5,"cache_read_input_tokens":80,"cache_creation_input_tokens":15,"output_tokens":output}}}), &mut String::new(), &mut Tokens::default());
        }
        let history = scan.finish(true, today.to_string()); assert_eq!(history.record_count, 1); assert_eq!(history.days.last().unwrap().tokens.total_tokens, 120);
    }
    #[test]
    fn usage_rejects_negative_counts_and_inconsistent_cache_buckets() {
        assert!(Tokens::parse(&json!({"input_tokens":-1,"output_tokens":2}), false).is_none());
        assert!(Tokens::parse(&json!({"input_tokens":5,"cached_input_tokens":6,"output_tokens":2}), false).is_none());
    }
    #[test]
    fn history_never_serializes_messages_or_credentials() {
        let today = Local::now().date_naive(); let mut scan = Scanner::new(today);
        scan.parse(ProviderId::Claude, &json!({"type":"assistant","timestamp":timestamp(),"secret":"private-token","message":{"id":"id","content":"private-message","model":"model-b","usage":{"input_tokens":5,"output_tokens":20}}}), &mut String::new(), &mut Tokens::default());
        let json = serde_json::to_string(&scan.finish(true, today.to_string())).unwrap(); assert!(!json.contains("private-token")); assert!(!json.contains("private-message"));
    }
    #[test]
    fn non_usage_records_are_ignored_before_parsing_conversation_content() {
        assert!(!relevant(ProviderId::Codex, br#"{"type":"response_item","payload":{"type":"message"}}"#));
        assert!(relevant(ProviderId::Codex, br#"{"type":"event_msg","payload":{"type":"token_count"}}"#));
        assert!(!relevant(ProviderId::Claude, br#"{"type":"user","message":{"content":"private"}}"#));
        let today = Local::now().date_naive(); let mut scanner = Scanner::new(today);
        scanner.parse(ProviderId::Claude, &json!({"type":"assistant","timestamp":timestamp(),"message":{"content":"error without usage"}}), &mut String::new(), &mut Tokens::default());
        assert!(!scanner.partial);
    }
}
