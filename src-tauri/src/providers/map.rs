use super::{CodexAccount, CodexCredits, Metric, ProviderId, Snapshot};
use chrono::DateTime;
use serde_json::Value;

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok())).filter(|value| value.is_finite() && *value >= 0.0)
}
fn timestamp(value: &Value) -> Option<i64> {
    value.as_str().and_then(|value| DateTime::parse_from_rfc3339(value).ok()).map(|date| date.timestamp_millis())
}
fn metric(label: &str, used: Option<f64>, reset_at: Option<i64>) -> Option<Metric> {
    used.map(|used_percent| Metric { label: label.into(), used_percent, reset_at, period_minutes:None })
}

pub fn map(id: ProviderId, value: &Value) -> Result<Snapshot, String> {
    let (name, color, initials, metrics) = match id {
        ProviderId::Claude => ("Claude", "#515157", "C", claude(value)),
        ProviderId::Codex => ("Codex", "#85858c", "⌘", codex(value)),
        ProviderId::Cursor => ("Cursor", "#b8b8bf", "↗", cursor(value)?),
    };
    let extra_usage = matches!(id, ProviderId::Claude).then(|| claude_extra_usage(&value["extra_usage"])).flatten();
    if metrics.is_empty() && !extra_usage.as_ref().is_some_and(|extra| extra.spent.is_some()) { return Err("The provider returned no supported usage limits. No values have been invented.".into()); }
    Ok(Snapshot {
        id, name: name.into(), plan: value["plan_type"].as_str().or_else(|| value["membershipType"].as_str()).filter(|plan| !plan.is_empty() && plan.len() <= 80 && !plan.chars().any(char::is_control)).unwrap_or("Subscription").into(),
        color: color.into(), initials: initials.into(), spend_today: None, metrics,
        fetched_at: chrono::Utc::now().timestamp_millis(),
        claude_extra_usage: extra_usage,
        codex_account: matches!(id, ProviderId::Codex).then(|| CodexAccount {
            credits: value["credits"].as_object().map(|_| CodexCredits {
                has_credits: value["credits"]["hasCredits"].as_bool(),
                unlimited: value["credits"]["unlimited"].as_bool(),
                balance: number(&value["credits"]["balance"]),
            }),
            available_resets: value["available_resets"].as_u64().filter(|count| *count <= 9_007_199_254_740_991),
            included_usage_allowed: value["included_usage_allowed"].as_bool(),
        }),
    })
}

fn claude_extra_usage(raw: &Value) -> Option<super::ClaudeExtraUsage> {
    if raw["is_enabled"].as_bool() != Some(true) { return None; }
    let currency = raw["currency"].as_str().filter(|currency| currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase())).map(str::to_string);
    let decimal_places = raw["decimal_places"].as_u64().filter(|places| *places <= 6).map(|places| places as u32);
    // Missing currency/scale, zero values and uncapped/missing limits are distinct. Never assume USD or cents.
    let scale = currency.as_ref().and(decimal_places).map(|places| 10_f64.powi(places as i32));
    let amount = |field: &str| scale.and_then(|scale| number(&raw[field]).filter(|minor| *minor <= 9_007_199_254_740_991.0).map(|minor| minor / scale));
    Some(super::ClaudeExtraUsage { spent: amount("used_credits"), monthly_limit: amount("monthly_limit"), currency, decimal_places })
}

fn claude(value: &Value) -> Vec<Metric> {
    let mut metrics: Vec<_> = [("five_hour", "Session"), ("seven_day", "Weekly"), ("seven_day_sonnet", "Sonnet"), ("seven_day_opus", "Opus")].into_iter().filter_map(|(key, label)| {
        let window = &value[key];
        metric(label, number(&window["utilization"]), timestamp(&window["resets_at"])).map(|mut metric|{metric.period_minutes=Some(if key=="five_hour" {300} else {10080});metric})
    }).collect();
    if let Some(limits) = value["limits"].as_array() {
        for model in ["Sonnet", "Opus", "Fable"] {
            let scoped = limits.iter().find(|limit| limit["kind"] == "weekly_scoped" && limit["scope"]["model"]["display_name"] == model);
            let Some(mut reading) = scoped.and_then(|limit| metric(model, number(&limit["percent"]), timestamp(&limit["resets_at"]))) else { continue; };
            reading.period_minutes = Some(10080);
            metrics.retain(|previous| previous.label != model);
            metrics.push(reading);
        }
    }
    metrics
}

fn codex(value: &Value) -> Vec<Metric> {
    let mut metrics = Vec::new();
    for (key, fallback) in [("primary_window", "Session"), ("secondary_window", "Weekly")] {
        let window = &value["rate_limit"][key];
        let label = match window["limit_window_seconds"].as_i64() {
            Some(seconds) if seconds >= 604_800 => "Weekly",
            Some(seconds) if seconds <= 18_000 => "Session",
            _ => fallback,
        };
        let reset = window["reset_at"].as_i64().and_then(|seconds| seconds.checked_mul(1000));
        if let Some(mut row) = metric(label, number(&window["used_percent"]), reset) { row.period_minutes=window["limit_window_seconds"].as_u64().filter(|seconds|*seconds>0 && seconds%60==0).map(|seconds|seconds/60);metrics.push(row); }
    }
    metrics
}

fn cursor(value: &Value) -> Result<Vec<Metric>, String> {
    if value["enabled"].as_bool() == Some(false) { return Err("No active Cursor allowance is available for this account.".into()); }
    let mut metrics = Vec::new();
    let plan = &value["planUsage"];
    let reset = timestamp(&value["billingCycleEnd"])
        .or_else(|| number(&value["billingCycleEnd"]).filter(|value| *value <= i64::MAX as f64).map(|value| value as i64))
        .or_else(|| timestamp(&value["billingCycleEndDate"]));
    let is_team = value["spendLimitUsage"]["limitType"].as_str() == Some("team")
        || number(&value["spendLimitUsage"]["pooledLimit"]).is_some_and(|limit| limit > 0.0);
    let pool_values = (number(&plan["autoPercentUsed"]), number(&plan["apiPercentUsed"]));
    let has_pools = match pool_values {
        (Some(auto), Some(api)) => auto > 0.0 || api > 0.0 || number(&plan["totalSpend"]) == Some(0.0),
        _ => false,
    };
    let total = number(&plan["totalPercentUsed"]).or_else(|| {
        if is_team && has_pools { return None; }
        let limit = number(&plan["limit"])?;
        if limit <= 0.0 { return None; }
        let spend = number(&plan["totalSpend"]).or_else(|| number(&plan["remaining"]).map(|remaining| (limit - remaining).max(0.0)))?;
        Some(spend / limit * 100.0)
    });
    if let Some(row) = metric("Monthly", total, reset) { metrics.push(row); }
    if metrics.is_empty() && has_pools {
        for (key, label) in [("autoPercentUsed", "Cursor models"), ("apiPercentUsed", "Other models")] {
            if let Some(row) = metric(label, number(&plan[key]), reset) { metrics.push(row); }
        }
    }
    metrics.extend(cursor_on_demand(&value["spendLimitUsage"], reset));
    Ok(metrics)
}

fn cursor_on_demand(usage: &Value, reset: Option<i64>) -> Option<Metric> {
    let individual = number(&usage["individualLimit"]).filter(|limit| *limit > 0.0);
    let (limit, used, remaining, pooled) = if let Some(limit) = individual {
        (limit, number(&usage["individualUsed"]), number(&usage["individualRemaining"]), false)
    } else {
        (number(&usage["pooledLimit"]).filter(|limit| *limit > 0.0)?, number(&usage["pooledUsed"]), number(&usage["pooledRemaining"]), true)
    };
    let spent = used.or_else(|| remaining.map(|remaining| (limit - remaining).max(0.0)))?;
    let label = if pooled || usage["limitType"] == "team" { "On-demand (team)" } else { "On-demand" };
    metric(label, Some(spent / limit * 100.0).filter(|percent| percent.is_finite()), reset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_extra_usage_honors_reported_currency_and_scale_without_guessing_missing_metadata() {
        let base = json!({"is_enabled":true,"used_credits":250,"monthly_limit":1000,"currency":"EUR","decimal_places":2});
        let mapped = map(ProviderId::Claude, &json!({"extra_usage":base})).unwrap();
        let extra = mapped.claude_extra_usage.unwrap();
        assert_eq!(extra.currency.as_deref(), Some("EUR"));
        assert_eq!(extra.spent, Some(2.5)); assert_eq!(extra.monthly_limit, Some(10.0));
        let scale_zero = claude_extra_usage(&json!({"is_enabled":true,"used_credits":0,"monthly_limit":0,"currency":"JPY","decimal_places":0})).unwrap();
        assert_eq!(scale_zero.spent, Some(0.0)); assert_eq!(scale_zero.monthly_limit, Some(0.0));
        for (field, invalid) in [("currency",json!(null)),("currency",json!("usd")),("decimal_places",json!(null)),("decimal_places",json!(7)),("decimal_places",json!(-1)),("used_credits",json!(-1))] {
            let mut raw = base.clone(); raw[field] = invalid;
            assert!(claude_extra_usage(&raw).unwrap().spent.is_none());
        }
        let no_limit = claude_extra_usage(&json!({"is_enabled":true,"used_credits":1500,"currency":"KWD","decimal_places":3})).unwrap();
        assert_eq!(no_limit.spent,Some(1.5)); assert!(no_limit.monthly_limit.is_none());
        assert!(claude_extra_usage(&json!({"is_enabled":false,"used_credits":200})).is_none());
    }

    #[test]
    fn model_scoped_weekly_limits_replace_their_legacy_pool_without_becoming_session_usage() {
        let mapped = map(ProviderId::Claude, &json!({"five_hour":{"utilization":20},"seven_day":{"utilization":30},"seven_day_sonnet":{"utilization":0},"limits":[
            {"kind":"weekly_scoped","scope":{"model":{"display_name":"Sonnet"}},"percent":45,"resets_at":"2026-10-30T00:00:00Z"},
            {"kind":"weekly_scoped","scope":{"model":{"display_name":"Fable"}},"percent":0},
            {"kind":"other","scope":{"model":{"display_name":"Opus"}},"percent":50}
        ]})).unwrap();
        assert_eq!(mapped.metrics.iter().map(|metric|(metric.label.as_str(),metric.used_percent)).collect::<Vec<_>>(),vec![("Session",20.0),("Weekly",30.0),("Sonnet",45.0),("Fable",0.0)]);
        assert_eq!(mapped.metrics[2].period_minutes,Some(10080)); assert!(mapped.metrics[2].reset_at.is_some());
        assert!(mapped.metrics[3].reset_at.is_none());
    }

    #[test]
    fn codex_account_details_preserve_zero_false_and_missing_values() {
        let data = super::super::codex::normalized(&json!({
            "rateLimits": {"planType":"prolite", "primary":{"usedPercent":31,"windowDurationMins":10080}, "credits":{"hasCredits":false,"unlimited":false,"balance":"0"}},
            "rateLimitResetCredits":{"availableCount":0}, "ordinaryUsageAllowed":false,
        }));
        let mapped = map(ProviderId::Codex, &data).unwrap();
        assert_eq!(mapped.plan,"prolite");
        let account=mapped.codex_account.unwrap();
        assert_eq!(account.available_resets,Some(0));
        assert_eq!(account.included_usage_allowed,Some(false));
        let credits=account.credits.unwrap();
        assert_eq!(credits.balance,Some(0.0));
        assert_eq!(credits.has_credits,Some(false));
        let missing=map(ProviderId::Codex,&json!({"rate_limit":{"primary_window":{"used_percent":5}}})).unwrap().codex_account.unwrap();
        assert!(missing.credits.is_none() && missing.available_resets.is_none() && missing.included_usage_allowed.is_none());
    }
    #[test]
    fn codex_details_reject_invalid_numbers_and_use_selected_bucket() {
        for balance in ["NaN", "inf", "-1", "not a number"] {
            let data=super::super::codex::normalized(&json!({"rateLimits":{"credits":{"balance":"999"}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":2},"credits":{"balance":balance}}},"rateLimitResetCredits":{"availableCount":-1}}));
            let account=map(ProviderId::Codex,&data).unwrap().codex_account.unwrap();
            assert!(account.credits.unwrap().balance.is_none());
            assert!(account.available_resets.is_none());
        }
    }
    #[test]
    fn unknown_payload_is_not_zero_usage() {
        assert!(map(ProviderId::Codex, &json!({"futureSchema": true})).is_err());
        assert!(map(ProviderId::Cursor, &json!({"planUsage": {"limit": 2000}})).is_err());
    }
    #[test]
    fn claude_windows_preserve_zero_usage_missing_resets_and_reject_invalid_values() {
        let snapshot = map(ProviderId::Claude, &json!({"five_hour": {"utilization": 0, "resets_at": null}, "seven_day": {"utilization": 11.5, "resets_at": "2026-10-30T12:00:00Z"}})).unwrap();
        assert_eq!(snapshot.metrics.len(), 2);
        assert_eq!(snapshot.metrics[0].label, "Session");
        assert_eq!(snapshot.metrics[0].used_percent, 0.0);
        assert_eq!(snapshot.metrics[0].reset_at, None);
        assert_eq!(snapshot.metrics[1].label, "Weekly");
        assert_eq!(snapshot.metrics[1].used_percent, 11.5);
        assert_eq!(snapshot.metrics[1].reset_at, Some(1793361600000));
        for utilization in [json!(null), json!(-1), json!("invalid")] {
            assert!(map(ProviderId::Claude, &json!({"five_hour": {"utilization": utilization}})).is_err());
        }
    }
    #[test]
    fn cursor_preserves_a_missing_reset_without_inventing_one() {
        let snapshot = map(ProviderId::Cursor, &json!({"planUsage": {"totalPercentUsed": 0}})).unwrap();
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
        let snapshot = map(ProviderId::Cursor, &json!({"billingCycleEnd": 1900000000000i64, "planUsage": {"limit": 2000, "totalSpend": 1000}})).unwrap();
        assert_eq!(snapshot.metrics[0].used_percent, 50.0);
        assert_eq!(snapshot.metrics[0].reset_at, Some(1900000000000));
    }
    #[test]
    fn cursor_team_pools_do_not_turn_a_legacy_dollar_cap_into_a_total() {
        let snapshot = map(ProviderId::Cursor, &json!({
            "spendLimitUsage": {"limitType": "team"},
            "planUsage": {"limit": 2000, "totalSpend": 1900, "autoPercentUsed": 35, "apiPercentUsed": 52}
        })).unwrap();
        assert_eq!(snapshot.metrics[0].label, "Cursor models");
        assert_eq!(snapshot.metrics[0].used_percent, 35.0);
        assert_eq!(snapshot.metrics[1].used_percent, 52.0);
    }
    #[test]
    fn cursor_on_demand_keeps_team_scope_the_real_billing_reset_and_missing_spend_unavailable() {
        for (usage, label, percent) in [
            (json!({"limitType":"team","pooledLimit":10000,"pooledUsed":2500}),Some("On-demand (team)"),25.0),
            (json!({"individualLimit":10000,"individualRemaining":10000,"pooledUsed":9000}),Some("On-demand"),0.0),
            (json!({"pooledLimit":10000,"pooledRemaining":7500}),Some("On-demand (team)"),25.0),
            (json!({"individualLimit":10000}),None,0.0),
        ] {
            let snapshot=map(ProviderId::Cursor,&json!({"membershipType":"enterprise","billingCycleEnd":"2030-01-02T00:00:00Z","planUsage":{"totalPercentUsed":10},"spendLimitUsage":usage})).unwrap();
            let demand=snapshot.metrics.iter().find(|metric|metric.label.starts_with("On-demand"));
            assert_eq!(demand.map(|metric|metric.label.as_str()),label);assert_eq!(snapshot.plan,"enterprise");
            if let Some(metric)=demand{assert_eq!(metric.used_percent,percent);assert_eq!(metric.reset_at,Some(1_893_542_400_000));}
        }
    }
}
