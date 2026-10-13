use super::{Metric, ProviderId, Snapshot};
use chrono::DateTime;
use serde_json::Value;

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok())).filter(|value| value.is_finite() && *value >= 0.0)
}
fn timestamp(value: &Value) -> Option<i64> {
    value.as_str().and_then(|value| DateTime::parse_from_rfc3339(value).ok()).map(|date| date.timestamp_millis())
}
fn metric(label: &str, used: Option<f64>, reset_at: Option<i64>) -> Option<Metric> {
    used.map(|used_percent| Metric { label: label.into(), used_percent, reset_at })
}

pub fn map(id: ProviderId, value: &Value) -> Result<Snapshot, String> {
    let (name, color, initials) = match id {
        ProviderId::Claude => ("Claude", "#dca18b", "✳"),
        ProviderId::Codex => ("Codex", "#9dcbb8", "⌘"),
        ProviderId::Cursor => ("Cursor", "#b8b7df", "↗"),
    };
    let mut metrics = Vec::new();
    match id {
        ProviderId::Claude => {
            for (key, label) in [("five_hour", "Session"), ("seven_day", "Weekly"), ("seven_day_sonnet", "Sonnet")] {
                let window = &value[key];
                if let Some(row) = metric(label, number(&window["utilization"]), timestamp(&window["resets_at"])) { metrics.push(row); }
            }
        }
        ProviderId::Codex => {
            for (key, fallback) in [("primary_window", "Session"), ("secondary_window", "Weekly")] {
                let window = &value["rate_limit"][key];
                let label = match window["limit_window_seconds"].as_i64() {
                    Some(seconds) if seconds >= 604_800 => "Weekly",
                    Some(seconds) if seconds <= 18_000 => "Session",
                    _ => fallback,
                };
                let reset = window["reset_at"].as_i64().and_then(|seconds| seconds.checked_mul(1000));
                if let Some(row) = metric(label, number(&window["used_percent"]), reset) { metrics.push(row); }
            }
        }
        ProviderId::Cursor => {
            if value["enabled"].as_bool() == Some(false) { return Err("No active Cursor allowance is available for this account.".into()); }
            let plan = &value["planUsage"];
            let reset = timestamp(&value["billingCycleEnd"]).or_else(|| timestamp(&value["billingCycleEndDate"]));
            let total = number(&plan["totalPercentUsed"]).or_else(|| {
                let limit = number(&plan["limit"])?;
                if limit <= 0.0 { return None; }
                let spend = number(&plan["totalSpend"]).or_else(|| number(&plan["remaining"]).map(|remaining| (limit - remaining).max(0.0)))?;
                Some(spend / limit * 100.0)
            });
            if let Some(row) = metric("Monthly", total, reset) { metrics.push(row); }
            if metrics.is_empty() {
                for (key, label) in [("autoPercentUsed", "Cursor models"), ("apiPercentUsed", "Other models")] {
                    if let Some(row) = metric(label, number(&plan[key]), reset) { metrics.push(row); }
                }
            }
        }
    }
    if metrics.is_empty() { return Err("The provider returned no supported usage limits. No values have been invented.".into()); }
    Ok(Snapshot {
        id, name: name.into(), plan: value["plan_type"].as_str().unwrap_or("Subscription").into(),
        color: color.into(), initials: initials.into(), spend_today: None, metrics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_payload_is_not_zero_usage() {
        assert!(map(ProviderId::Claude, &json!({"futureSchema": true})).is_err());
        assert!(map(ProviderId::Cursor, &json!({"planUsage": {"limit": 2000}})).is_err());
    }
    #[test]
    fn claude_preserves_an_unstarted_window_without_inventing_a_reset() {
        let snapshot = map(ProviderId::Claude, &json!({"five_hour": {"utilization": 0, "resets_at": null}})).unwrap();
        assert_eq!(snapshot.metrics[0].used_percent, 0.0);
        assert_eq!(snapshot.metrics[0].reset_at, None);
        assert_eq!(snapshot.spend_today, None);
    }
    #[test]
    fn codex_uses_the_window_duration_instead_of_its_position() {
        let snapshot = map(ProviderId::Codex, &json!({"rate_limit": {"primary_window": {"limit_window_seconds": 604800, "used_percent": 27, "reset_at": 1900000000}}})).unwrap();
        assert_eq!(snapshot.metrics[0].label, "Weekly");
        assert_eq!(snapshot.metrics[0].reset_at, Some(1900000000000));
    }
    #[test]
    fn cursor_derives_usage_only_when_both_spend_and_limit_exist() {
        let snapshot = map(ProviderId::Cursor, &json!({"planUsage": {"limit": 2000, "totalSpend": 1000}})).unwrap();
        assert_eq!(snapshot.metrics[0].used_percent, 50.0);
    }
}
