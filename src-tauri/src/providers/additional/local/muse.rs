use super::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
fn bare(entry: &Value) -> Result<Option<jsonl::Record>, ()> {
    if entry["payload_type"] != "runtime.session"
        || entry["payload"]["event"]["kind"] != "model_completed"
    {
        return Ok(None);
    }
    let event = &entry["payload"]["event"];
    let usage = &event["usage"];
    let micros = entry["recorded_at"].as_i64().ok_or(())?;
    let input = usage["input_tokens"].as_u64().ok_or(())?;
    let output = usage["output_tokens"].as_u64().ok_or(())?;
    let sum = input
        .checked_add(output)
        .filter(|sum| *sum <= SAFE_TOTAL)
        .ok_or(())?;
    let tokens = match usage.get("total_tokens") {
        Some(total) => total
            .as_u64()
            .filter(|total| *total >= sum && *total <= SAFE_TOTAL)
            .ok_or(())?,
        None => sum,
    };
    let model = event["model"]
        .as_str()
        .filter(|model| !model.is_empty() && model.len() <= 256)
        .ok_or(())?;
    let sequence = entry["sequence"].as_u64().ok_or(())?;
    let key = format!(
        "{:x}",
        Sha256::digest(format!("{micros}\0{sequence}\0{model}").as_bytes())
    );
    Ok(Some(jsonl::Record {
        key,
        timestamp: micros / 1000,
        tokens,
    }))
}
fn records(entry: &Value) -> Result<Vec<jsonl::Record>, ()> {
    if let Some(children) = entry["children"].as_array() {
        if children.len() > 128 {
            return Err(());
        }
        let mut records = Vec::new();
        for child in children {
            let raw = child["record_json"].as_str().ok_or(())?;
            let value = serde_json::from_str(raw).map_err(|_| ())?;
            records.extend(bare(&value)?);
        }
        return Ok(records);
    }
    Ok(bare(entry)?.into_iter().collect())
}
pub(super) fn totals(root: &Path) -> Result<Totals, String> {
    jsonl::totals(jsonl::session_files(&root.join("muse/sessions"))?, records)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn retained_and_bare_records_deduplicate_without_adding_reasoning_or_cache_twice() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-muse-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(root.join("muse/sessions/2026/10/27/a")).unwrap();
        let entry = json!({"sequence":1,"recorded_at":chrono::Utc::now().timestamp_micros()-1000000,"payload_type":"runtime.session","payload":{"event":{"kind":"model_completed","model":"new-unpriced-model","usage":{"input_tokens":100,"output_tokens":20,"reasoning_tokens":10,"cache_read_tokens":80},"prompt":"private content"}}});
        let retained = json!({"retained_frame":{},"children":[{"record_json":entry.to_string()}]});
        std::fs::write(
            root.join("muse/sessions/2026/10/27/a/session.jsonl"),
            format!("{entry}\n{retained}\n"),
        )
        .unwrap();
        let totals = totals(&root).unwrap();
        assert_eq!(totals.overall, 120);
        assert!(!totals.partial);
        assert!(!serde_json::to_string(&totals.amounts())
            .unwrap()
            .contains("private content"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
