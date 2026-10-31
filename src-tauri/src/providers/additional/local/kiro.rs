use super::*;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
fn count(raw: &Value, precise: &str, fallback: &str) -> Option<f64> {
    raw.get(precise)
        .or_else(|| raw.get(fallback))?
        .as_f64()
        .filter(|value| value.is_finite() && (0.0..=SAFE_TOTAL as f64).contains(value))
}
fn metric(label: &str, raw: &Value, reset: Option<i64>) -> Option<crate::providers::Metric> {
    let (used, limit) = (
        count(raw, "currentUsageWithPrecision", "currentUsage")?,
        count(raw, "usageLimitWithPrecision", "usageLimit").filter(|value| *value > 0.0)?,
    );
    Some(crate::providers::Metric {
        label: label.into(),
        used_percent: used / limit * 100.0,
        reset_at: reset,
        period_minutes: None,
    })
}
fn timestamp(value: &Value) -> Option<i64> {
    value
        .as_str()
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .map(|date| date.timestamp_millis())
}
fn parse(spec: &ProviderSpec, raw: &Value, now: i64) -> Result<Snapshot, String> {
    let state = &raw["kiro.resourceNotifications.usageState"];
    let saved = state["timestamp"]
        .as_i64()
        .ok_or("Kiro has no dated saved quota. Open its account dashboard first.")?;
    if !(0..=900_000).contains(&now.saturating_sub(saved)) {
        return Err("Kiro's saved quota is older than 15 minutes or has a future timestamp. Refresh the account dashboard in Kiro.".into());
    }
    let mut snapshot = Snapshot::new(spec);
    snapshot.cached = true;
    snapshot.warning = true;
    snapshot.fetched_at = saved;
    for pool in state["usageBreakdowns"]
        .as_array()
        .into_iter()
        .flatten()
        .take(16)
    {
        let reset = timestamp(&pool["nextDateReset"]).or_else(|| timestamp(&pool["resetDate"]));
        if reset.is_some_and(|reset| reset <= now) {
            continue;
        }
        let label = match pool["resourceType"]
            .as_str()
            .or_else(|| pool["type"].as_str())
        {
            Some("CREDIT") => "Saved credits",
            _ => continue,
        };
        snapshot.metrics.extend(metric(label, pool, reset));
        let trial = pool
            .get("freeTrialInfo")
            .or_else(|| pool.get("freeTrialUsage"))
            .unwrap_or(&Value::Null);
        let reset =
            timestamp(&trial["freeTrialExpiry"]).or_else(|| timestamp(&trial["expiryDate"]));
        if trial["freeTrialStatus"] == "ACTIVE" && reset.is_some_and(|reset| reset > now) {
            snapshot
                .metrics
                .extend(metric("Saved trial credits", trial, reset));
        }
        for bonus in pool["bonuses"].as_array().into_iter().flatten().take(8) {
            let reset = timestamp(&bonus["expiresAt"]).or_else(|| timestamp(&bonus["expiryDate"]));
            if matches!(bonus["status"].as_str(), Some("ACTIVE" | "EXHAUSTED"))
                && reset.is_some_and(|reset| reset > now)
            {
                snapshot
                    .metrics
                    .extend(metric("Saved bonus credits", bonus, reset));
            }
        }
    }
    if snapshot.metrics.is_empty() {
        return Err(
            "Kiro has no supported unexpired saved quota. No zero allowance was inferred.".into(),
        );
    }
    snapshot.notice=Some("Cached Kiro IDE quota at its saved timestamp, valid for at most 15 minutes. Open Kiro's account dashboard to update it. No credential read, token refresh or live request.".into());
    Ok(snapshot)
}
pub(super) fn snapshot(spec: &ProviderSpec) -> Result<Snapshot, String> {
    let path = dirs::config_dir()
        .ok_or("The configuration directory is unavailable.")?
        .join("Kiro/User/globalStorage/state.vscdb");
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "No readable Kiro IDE state was found.")?;
    db.busy_timeout(std::time::Duration::from_millis(500))
        .map_err(|_| "The Kiro database could not be configured.")?;
    let text:String=db.query_row("SELECT value FROM ItemTable WHERE key='kiro.kiroAgent' AND length(CAST(value AS BLOB))<=1048576 LIMIT 1",[],|row|row.get(0)).map_err(|_|"No bounded saved Kiro quota was found.")?;
    let raw = serde_json::from_str(&text)
        .map_err(|_| "The saved Kiro quota has an unsupported format.")?;
    parse(spec, &raw, chrono::Utc::now().timestamp_millis())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn saved_credits_keep_precision_and_never_masquerade_as_fresh_live_data() {
        let spec = crate::providers::additional::catalog::provider("kiro").unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let raw = json!({"kiro.resourceNotifications.usageState":{"timestamp":now-2000,"usageBreakdowns":[{"resourceType":"CREDIT","currentUsage":1,"currentUsageWithPrecision":1.5,"usageLimit":10,"nextDateReset":"2030-01-01T00:00:00Z"}]}});
        let snapshot = parse(spec, &raw, now).unwrap();
        assert_eq!(snapshot.metrics[0].used_percent, 15.0);
        assert!(snapshot.cached && snapshot.warning);
        assert_eq!(snapshot.fetched_at, now - 2000);
        assert!(parse(spec, &raw, now + 900001).is_err());
        assert!(parse(spec, &json!({}), now).is_err());
    }
}
