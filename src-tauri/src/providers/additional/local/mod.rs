mod cline;
mod jetbrains;
mod jsonl;
mod kiro;
mod muse;
mod pi;
mod xal;
mod zcode;

use super::{catalog::ProviderSpec, Amount, Failure, Snapshot};
use chrono::{Days, Local, NaiveDate};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

type Reader = fn(&Path) -> Result<Totals, String>;
type SnapshotReader = fn(&ProviderSpec) -> Result<Snapshot, String>;
const SNAPSHOT_READERS: &[(&str, SnapshotReader)] = &[
    ("jetbrains", jetbrains::snapshot),
    ("cline", cline::snapshot),
    ("kiro", kiro::snapshot),
];
const READERS: &[(&str, &str, &str, Reader)] = &[
    ("xal", "XAL_HOME", ".xal", xal::totals),
    ("zcode", "ZCODE_HOME", ".zcode", zcode::totals),
    ("pi", "PI_CODING_AGENT_DIR", ".pi/agent", pi::totals),
    ("muse", "XDG_DATA_HOME", ".local/share", muse::totals),
];
const SAFE_TOTAL: u64 = 9_007_199_254_740_991;
const ROW_LIMIT: usize = 100_000;
#[derive(Default)]
struct Totals {
    days: BTreeMap<NaiveDate, u64>,
    overall: u64,
    valid_records: usize,
    partial: bool,
}
impl Totals {
    fn add(&mut self, milliseconds: i64, tokens: u64) -> Result<(), String> {
        let timestamp = chrono::DateTime::from_timestamp_millis(milliseconds)
            .ok_or("Invalid usage timestamp")?;
        if milliseconds > chrono::Utc::now().timestamp_millis() {
            return Err("Future usage timestamp".into());
        }
        let date = timestamp.with_timezone(&Local).date_naive();
        if date < cutoff() {
            self.valid_records += 1;
            return Ok(());
        }
        let overall = self
            .overall
            .checked_add(tokens)
            .filter(|total| *total <= SAFE_TOTAL)
            .ok_or("Usage count overflow")?;
        let current = self.days.get(&date).copied().unwrap_or(0);
        let total = current
            .checked_add(tokens)
            .filter(|total| *total <= SAFE_TOTAL)
            .ok_or("Usage count overflow")?;
        self.days.insert(date, total);
        self.overall = overall;
        self.valid_records += 1;
        Ok(())
    }
    fn amounts(&self) -> Vec<Amount> {
        let today = Local::now().date_naive();
        let yesterday = today.pred_opt();
        [
            ("Today", self.days.get(&today).copied().unwrap_or(0)),
            (
                "Yesterday",
                yesterday
                    .and_then(|day| self.days.get(&day))
                    .copied()
                    .unwrap_or(0),
            ),
            ("Last 30 days", self.overall),
        ]
        .into_iter()
        .map(|(label, count)| Amount {
            label: label.into(),
            value: count as f64,
            currency: None,
            unit: "tokens".into(),
        })
        .collect()
    }
}
fn cutoff() -> NaiveDate {
    Local::now()
        .date_naive()
        .checked_sub_days(Days::new(29))
        .unwrap_or(NaiveDate::MIN)
}
fn files(directory: &Path, extension: &str) -> Result<Vec<PathBuf>, String> {
    let entries = std::fs::read_dir(directory).map_err(|_| "No readable local usage directory was found. Open the provider and record some usage first.".to_string())?;
    let mut paths = Vec::new();
    for (index, entry) in entries.take(1001).enumerate() {
        if index == 1000 {
            return Err("There are too many local usage files to read safely.".into());
        }
        let entry = entry.map_err(|_| "The local usage directory could not be read.")?;
        if entry
            .file_type()
            .map_err(|_| "The local usage file could not be inspected.")?
            .is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|suffix| suffix == extension)
        {
            paths.push(entry.path());
        }
    }
    paths.sort();
    if paths.is_empty() {
        return Err("No supported local usage files were found. Open the provider and record some usage first.".into());
    }
    Ok(paths)
}
pub(super) async fn snapshot(spec: &'static ProviderSpec) -> Result<Snapshot, Failure> {
    if let Some((_, reader)) = SNAPSHOT_READERS.iter().find(|(id, _)| *id == spec.id) {
        let read = *reader;
        return tauri::async_runtime::spawn_blocking(move || read(spec))
            .await
            .map_err(|_| Failure::unavailable("The local usage scan could not complete."))?
            .map_err(Failure::unavailable);
    }
    let (_, environment, default, reader) = READERS
        .iter()
        .find(|(id, _, _, _)| *id == spec.id)
        .ok_or_else(|| Failure::unavailable("This local provider has no usage reader."))?;
    let root = std::env::var_os(environment)
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(default)))
        .ok_or_else(|| Failure::unavailable("The local provider directory is unavailable."))?;
    let read = *reader;
    let totals = tauri::async_runtime::spawn_blocking(move || read(&root))
        .await
        .map_err(|_| Failure::unavailable("The local usage scan could not complete."))?
        .map_err(Failure::unavailable)?;
    if totals.valid_records == 0 {
        return Err(Failure::unavailable(
            "Local usage records could not be interpreted. No zero usage has been inferred.",
        ));
    }
    let mut snapshot = Snapshot::new(spec);
    snapshot.amounts = totals.amounts();
    snapshot.warning = totals.partial;
    snapshot.notice = Some(if totals.partial { "Partial device history: some records could not be read. No account quota or billing status is inferred." } else { "Recorded on this device in the local time zone. This is not an account quota, invoice or subscription status." }.into());
    if spec.id == "muse" {
        snapshot.notice=Some(format!("{}Muse device history: reported total_tokens when available, otherwise recorded input_tokens + output_tokens only. Cache and reasoning fields are never added separately. This is not a subscription quota or bill.",if totals.partial {"Partial history. "} else {""}));
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn pi_replays_compaction_and_cache_warming_count_once_and_bad_records_mark_partial() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-pi-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(root.join("sessions/project")).unwrap();
        let timestamp = chrono::Utc::now().timestamp_millis() - 1000;
        let date = chrono::DateTime::from_timestamp_millis(timestamp)
            .unwrap()
            .to_rfc3339();
        let assistant = json!({"type":"message","id":"abc123","timestamp":date,"message":{"role":"assistant","timestamp":timestamp,"content":[{"type":"text","text":"private prompt"}],"usage":{"input":2,"output":3,"cacheRead":8,"cacheWrite":7,"totalTokens":20}}});
        let warming = json!({"type":"usage","id":"warm","timestamp":date,"kind":"cache_warm","usage":{"totalTokens":10}});
        let compaction =
            json!({"type":"compaction","id":"compact","timestamp":date,"usage":{"totalTokens":5}});
        let branch = json!({"type":"branch_summary","id":"branch","timestamp":date,"usage":{"totalTokens":7}});
        let source = format!("{assistant}\n{warming}\n{compaction}\n{branch}\n");
        std::fs::write(root.join("sessions/project/a.jsonl"), &source).unwrap();
        std::fs::write(root.join("sessions/project/fork.jsonl"), &source).unwrap();
        let totals = pi::totals(&root).unwrap();
        assert_eq!(totals.overall, 42);
        assert!(!totals.partial);
        assert!(!serde_json::to_string(&totals.amounts())
            .unwrap()
            .contains("private prompt"));
        let mut increased = assistant.clone();
        increased["message"]["usage"]["totalTokens"] = json!(25);
        std::fs::write(
            root.join("sessions/project/replay.jsonl"),
            format!("{increased}\n{{bad\n"),
        )
        .unwrap();
        let totals = pi::totals(&root).unwrap();
        assert_eq!(totals.overall, 47);
        assert!(totals.partial);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn local_xal_counts_cached_input_once_deduplicates_requests_and_never_serializes_record_content(
    ) {
        let root = std::env::temp_dir().join(format!(
            "meterluma-xal-fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("usage")).unwrap();
        let record = json!({"type":"provider_usage","version":2,"id":"request-1","timestamp":chrono::Utc::now().to_rfc3339(),"model":"known-model","usage":{"totalInputTokens":120,"cacheReadInputTokens":80,"cacheWriteInputTokens":0,"outputTokens":15},"prompt":"private-message"});
        let line = format!("{record}\n");
        std::fs::write(root.join("usage/a.jsonl"), format!("{line}{line}")).unwrap();
        let totals = xal::totals(&root).unwrap();
        assert!(!totals.partial);
        assert_eq!(totals.amounts()[0].value, 135.0);
        let serialized = serde_json::to_string(&totals.amounts()).unwrap();
        assert!(!serialized.contains("private-message") && !serialized.contains("request-1"));
        std::fs::write(
            root.join("usage/b.jsonl"),
            "{\"type\":\"provider_usage\",\"usage\":null}\n",
        )
        .unwrap();
        assert!(xal::totals(&root).unwrap().partial);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn zcode_database_is_read_only_and_cache_tokens_are_not_added_to_input_again() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-zcode-fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("cli/db")).unwrap();
        let path = root.join("cli/db/db.sqlite");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE model_usage(started_at INTEGER,input_tokens INTEGER,output_tokens INTEGER,cache_read_input_tokens INTEGER,cache_creation_input_tokens INTEGER);").unwrap();
        db.execute(
            "INSERT INTO model_usage VALUES (?1,120,15,80,20)",
            [chrono::Utc::now().timestamp_millis()],
        )
        .unwrap();
        drop(db);
        let original = std::fs::read(&path).unwrap();
        let totals = zcode::totals(&root).unwrap();
        assert_eq!(totals.amounts()[0].value, 135.0);
        assert_eq!(original, std::fs::read(&path).unwrap());
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute(
            "INSERT INTO model_usage VALUES (?1,10,5,80,20)",
            [chrono::Utc::now().timestamp_millis()],
        )
        .unwrap();
        drop(db);
        let totals = zcode::totals(&root).unwrap();
        assert!(totals.partial);
        assert_eq!(totals.amounts()[0].value, 135.0);
        std::fs::remove_dir_all(root).unwrap();
    }
}
