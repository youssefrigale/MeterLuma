use super::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::File, io::Read};

fn record(message: &Value) -> Result<Option<(i64, u64)>, ()> {
    if message["type"] != "say" {
        return Ok(None);
    }
    if matches!(
        message["say"].as_str(),
        Some("deleted_api_reqs" | "subagent_usage")
    ) {
        return Err(());
    }
    if message["say"] != "api_req_started" {
        return Ok(None);
    }
    let data: Value = serde_json::from_str(message["text"].as_str().ok_or(())?).map_err(|_| ())?;
    if data.get("tokensIn").is_none() && data.get("tokensOut").is_none() {
        return Ok(None);
    }
    let timestamp = message["ts"].as_i64().ok_or(())?;
    let mut tokens = 0u64;
    for key in ["tokensIn", "tokensOut", "cacheWrites", "cacheReads"] {
        let value = match data.get(key) {
            Some(value) => value.as_u64().ok_or(())?,
            None if matches!(key, "cacheWrites" | "cacheReads") => 0,
            _ => return Err(()),
        };
        tokens = tokens
            .checked_add(value)
            .filter(|sum| *sum <= SAFE_TOTAL)
            .ok_or(())?;
    }
    Ok(Some((timestamp, tokens)))
}
fn read(path: &Path, budget: &mut usize) -> Result<Value, String> {
    let limit = (*budget).min(16 * 1024 * 1024);
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "A Cline ledger could not be opened.")?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "A Cline ledger could not be read.")?;
    if bytes.len() > limit {
        *budget = 0;
        return Err("The Cline history exceeds the scan limit.".into());
    }
    *budget -= bytes.len();
    serde_json::from_slice(&bytes).map_err(|_| "A Cline ledger has an unsupported format.".into())
}
fn scan(roots: &[PathBuf]) -> Result<Totals, String> {
    let mut totals = Totals::default();
    let mut seen = HashMap::<String, u64>::new();
    let mut budget = 64 * 1024 * 1024;
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for (index, entry) in entries.take(1001).enumerate() {
            if index == 1000 || budget == 0 {
                totals.partial = true;
                break;
            }
            let Ok(entry) = entry else {
                totals.partial = true;
                continue;
            };
            if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let data = match read(&entry.path().join("ui_messages.json"), &mut budget) {
                Ok(data) => data,
                Err(_) => {
                    totals.partial = true;
                    continue;
                }
            };
            let Some(messages) = data.as_array() else {
                totals.partial = true;
                continue;
            };
            for message in messages.iter().take(ROW_LIMIT + 1) {
                if seen.len() >= ROW_LIMIT {
                    totals.partial = true;
                    break;
                }
                let (timestamp, tokens) = match record(message) {
                    Ok(Some(record)) => record,
                    Ok(None) => continue,
                    Err(_) => {
                        totals.partial = true;
                        continue;
                    }
                };
                let key = format!(
                    "{:x}",
                    Sha256::digest(
                        format!("{}\0{timestamp}", entry.file_name().to_string_lossy()).as_bytes()
                    )
                );
                let previous = seen.get(&key).copied().unwrap_or(0);
                if tokens <= previous && seen.contains_key(&key) {
                    continue;
                }
                if totals.add(timestamp, tokens - previous).is_err() {
                    totals.partial = true;
                    continue;
                }
                seen.insert(key, tokens);
            }
            if messages.len() > ROW_LIMIT {
                totals.partial = true;
            }
        }
    }
    if totals.valid_records == 0 {
        return Err("No supported request-level Cline usage was found. Current SDK session formats and aggregated deleted requests are not inferred as daily usage.".into());
    }
    Ok(totals)
}
pub(super) fn snapshot(spec: &ProviderSpec) -> Result<Snapshot, String> {
    let home = dirs::home_dir().ok_or("The home directory is unavailable.")?;
    let cli = std::env::var_os("CLINE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cline/data"));
    let mut roots = vec![cli.join("tasks")];
    if let Some(config) = dirs::config_dir() {
        roots.push(config.join("Code/User/globalStorage/saoudrizwan.claude-dev/tasks"));
    }
    let totals = scan(&roots)?;
    let mut snapshot = Snapshot::new(spec);
    snapshot.amounts = totals.amounts();
    snapshot.warning = totals.partial;
    snapshot.notice=Some(if totals.partial {"Partial Cline request history. Aggregated deleted/subagent rows without original request dates are excluded. No account quota or billing inference."} else {"Cline VS Code/legacy CLI request history on this device. Cache tokens are separate in this source. No account quota, billing or account ownership inference."}.into());
    Ok(snapshot)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn request_dates_and_separate_cache_tokens_survive_copies_without_exporting_prompts() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-cline-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(root.join("task-id")).unwrap();
        let request = json!({"type":"say","say":"api_req_started","ts":chrono::Utc::now().timestamp_millis()-1000,"text":json!({"request":"private prompt","tokensIn":20,"tokensOut":5,"cacheReads":10,"cacheWrites":2}).to_string()});
        let rows = json!([request.clone(),request,{"type":"say","say":"deleted_api_reqs","ts":0,"text":"{}"}]);
        let path = root.join("task-id/ui_messages.json");
        std::fs::write(&path, rows.to_string()).unwrap();
        let original = std::fs::read(&path).unwrap();
        let totals = scan(&[root.clone(), root.clone()]).unwrap();
        assert_eq!(totals.overall, 37);
        assert!(totals.partial);
        assert!(!serde_json::to_string(&totals.amounts())
            .unwrap()
            .contains("private prompt"));
        assert_eq!(original, std::fs::read(path).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
