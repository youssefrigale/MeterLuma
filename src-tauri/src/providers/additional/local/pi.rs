use super::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
fn record(entry: &Value) -> Result<Vec<jsonl::Record>, ()> {
    let payload = match entry["type"].as_str() {
        Some("message") if entry["message"]["role"] == "assistant" => &entry["message"],
        Some("usage" | "compaction" | "branch_summary") => entry,
        _ => return Ok(Vec::new()),
    };
    let Some(usage) = payload.get("usage").filter(|usage| !usage.is_null()) else {
        return Ok(Vec::new());
    };
    let tokens = usage["totalTokens"]
        .as_u64()
        .filter(|tokens| *tokens <= SAFE_TOTAL)
        .ok_or(())?;
    let id = entry["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or(())?;
    let timestamp = payload["timestamp"]
        .as_i64()
        .or_else(|| {
            entry["timestamp"]
                .as_str()
                .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
                .map(|time| time.timestamp_millis())
        })
        .ok_or(())?;
    for key in ["input", "output", "cacheRead", "cacheWrite"] {
        if let Some(raw) = usage.get(key) {
            if raw.as_u64().is_none_or(|count| count > tokens) {
                return Err(());
            }
        }
    }
    let key = format!(
        "{:x}",
        Sha256::digest(format!("{id}\0{timestamp}").as_bytes())
    );
    Ok(vec![jsonl::Record {
        key,
        timestamp,
        tokens,
    }])
}
pub(super) fn totals(root: &Path) -> Result<Totals, String> {
    jsonl::totals(jsonl::session_files(&root.join("sessions"))?, record)
}
