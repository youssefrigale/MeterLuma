use super::*;
use serde_json::Value;
fn record(record: &Value) -> Result<Vec<jsonl::Record>, ()> {
    if record["type"] != "provider_usage" {
        return Ok(Vec::new());
    }
    if !matches!(record["version"].as_u64(), Some(1 | 2)) {
        return Err(());
    }
    let id = record["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or(())?;
    let timestamp = record["timestamp"]
        .as_str()
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .ok_or(())?
        .timestamp_millis();
    let usage = &record["usage"];
    let input = usage["totalInputTokens"].as_u64().ok_or(())?;
    let output = usage["outputTokens"].as_u64().ok_or(())?;
    let cached = usage["cacheReadInputTokens"].as_u64().ok_or(())?;
    let write = usage["cacheWriteInputTokens"].as_u64().ok_or(())?;
    if cached.checked_add(write).ok_or(())? > input {
        return Err(());
    }
    let tokens = input
        .checked_add(output)
        .filter(|tokens| *tokens <= SAFE_TOTAL)
        .ok_or(())?;
    Ok(vec![jsonl::Record {
        key: id.into(),
        timestamp,
        tokens,
    }])
}
pub(super) fn totals(root: &Path) -> Result<Totals, String> {
    jsonl::totals(files(&root.join("usage"), "jsonl")?, record)
}
