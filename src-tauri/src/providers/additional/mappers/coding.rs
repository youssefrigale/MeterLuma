use super::*;

pub(super) fn byteplus(responses: &Responses) -> ProviderUsage {
    let mut usage = ProviderUsage::default();
    let root = response(responses, "quota");
    if root["viewer"]["tenant"] != "byteplus" {
        return usage;
    }
    for item in root["items"].as_array().into_iter().flatten().take(8) {
        if item["error"]
            .as_str()
            .is_some_and(|error| !error.is_empty())
        {
            usage.warning = true;
            continue;
        }
        if item["subscribed"] != true {
            continue;
        }
        let prefix = match item["product"].as_str() {
            Some("coding-plan") => "Personal",
            Some("coding-plan-team") => "Team seat",
            _ => continue,
        };
        for period in item["periods"].as_array().into_iter().flatten().take(8) {
            let label = match period["label"].as_str() {
                Some("session") => "Session",
                Some("weekly") => "Weekly",
                Some("monthly") => "Monthly",
                _ => continue,
            };
            let Some(percent) = count(&period["percent"]).filter(|value| *value <= 100.0) else {
                usage.warning = true;
                continue;
            };
            usage.metrics.extend(quota(
                &format!("{prefix} · {label}"),
                Some(percent),
                Some(100.0),
                time(&period["reset_at"]),
            ));
        }
    }
    usage.notice=Some("BytePlus Coding Plan quota from the active Ark CLI identity. Personal and bound team-seat windows stay separate; no admin seat sweep or dollar/token estimate. The CLI manages its sign-in; MeterLuma never changes the profile or starts login.".into());
    usage
}

#[cfg(test)]
mod byteplus_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn current_identity_products_are_separate_and_another_tenant_is_rejected() {
        let mut root = json!({"viewer":{"tenant":"byteplus","user_name":"private-user"},"items":[{"product":"coding-plan","subscribed":true,"periods":[{"label":"session","percent":0,"reset_at":"2030-01-01T08:00:00+08:00"}]},{"product":"coding-plan-team","subscribed":true,"periods":[{"label":"weekly","percent":75}]}]});
        let parse = |root| super::super::map("byteplus", &BTreeMap::from([("quota".into(), root)]));
        let usage = parse(root.clone()).unwrap();
        assert_eq!(
            usage
                .metrics
                .iter()
                .map(|metric| (metric.label.as_str(), metric.used_percent))
                .collect::<Vec<_>>(),
            vec![("Personal · Session", 0.0), ("Team seat · Weekly", 75.0)]
        );
        assert_eq!(usage.metrics[0].reset_at, Some(1893456000000));
        assert!(!usage.notice.unwrap().contains("private-user"));
        root["viewer"]["tenant"] = json!("other-product");
        assert!(parse(root).is_err());
    }
}

pub(super) fn qoder(responses: &Responses) -> ProviderUsage {
    let root = &response(responses, "quota")["usage"];
    let mut usage = ProviderUsage {
        plan: text(&root["userType"]),
        ..Default::default()
    };
    for (key, label, limit_key) in [
        ("userQuota", "Plan allowance", "total"),
        ("addOnQuota", "Add-on allowance", "total"),
        ("orgResourcePackage", "Organization allowance", "cap"),
    ] {
        let pool = &root[key];
        if pool.get("available") == Some(&Value::Bool(false)) {
            continue;
        }
        usage.metrics.extend(quota(
            label,
            count(&pool["used"]),
            count(&pool[limit_key]),
            None,
        ));
        if let Some(unit) = text(&pool["unit"]).filter(|unit| unit.len() <= 32) {
            usage.amounts.extend(amount(
                &format!("{label} remaining"),
                count(&pool["remaining"]),
                &unit,
                None,
            ));
        }
    }
    usage.notice=Some("Account quota reported by Qoder CLI's get_usage_info control request. No prompt is sent, and session credits are not added to account usage. Qoder manages its own sign-in. No reset time or dollar conversion is inferred.".into());
    usage
}

pub(super) fn gemini(responses: &Responses) -> ProviderUsage {
    let mut usage = ProviderUsage::default();
    for bucket in response(responses, "quota")["buckets"]
        .as_array()
        .into_iter()
        .flatten()
        .take(32)
    {
        let Some(model) = text(&bucket["modelId"]) else {
            continue;
        };
        let Some(remaining) = count(&bucket["remainingFraction"]).filter(|value| *value <= 1.0)
        else {
            continue;
        };
        let kind = text(&bucket["tokenType"]);
        let model: String = model.chars().take(32).collect();
        let label = kind
            .map(|kind| format!("{model} · {}", kind.chars().take(16).collect::<String>()))
            .unwrap_or(model);
        usage.metrics.extend(quota(
            &label,
            Some((1.0 - remaining) * 100.0),
            Some(100.0),
            time(&bucket["resetTime"]),
        ));
    }
    usage.notice=Some("Gemini Code Assist quota for the supplied OAuth token and Cloud project. Model buckets remain separate. No inference, project onboarding or credential renewal.".into());
    usage
}
pub(super) fn warp(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let mut usage = ProviderUsage::default();
    if root["errors"]
        .as_array()
        .is_some_and(|errors| !errors.is_empty())
    {
        return usage;
    }
    let user = &root["data"]["user"]["user"];
    let pool = &user["requestLimitInfo"];
    if pool["isUnlimited"] == false {
        usage.metrics.extend(quota(
            "Legacy credit allowance",
            count(&pool["requestsUsedSinceLastRefresh"]),
            count(&pool["requestLimit"]),
            time(&pool["nextRefreshTime"]),
        ));
    }
    usage.amounts.extend(amount(
        "Legacy credits used",
        count(&pool["requestsUsedSinceLastRefresh"]),
        "credits",
        None,
    ));
    for grant in user["bonusGrants"]
        .as_array()
        .into_iter()
        .flatten()
        .take(16)
    {
        let expiry = time(&grant["expiration"]);
        if expiry.is_some_and(|expiry| expiry <= chrono::Utc::now().timestamp_millis()) {
            continue;
        }
        usage.amounts.extend(amount(
            "User bonus credits remaining",
            count(&grant["requestCreditsRemaining"]),
            "credits",
            None,
        ));
    }
    usage.notice=Some("Legacy credit-account data from Warp's read-only usage query. Dollar-billed accounts may not expose these fields. Workspace and user grants are not combined; credits are not converted to dollars.".into());
    usage
}

#[cfg(test)]
mod bucket_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn gemini_models_stay_separate_and_warp_unlimited_never_becomes_zero_percent() {
        let usage=super::super::map("gemini",&BTreeMap::from([("quota".into(),json!({"buckets":[{"modelId":"gemini-a","remainingFraction":0.75,"resetTime":"2030-01-01T00:00:00Z"},{"modelId":"gemini-b","remainingFraction":0},{"modelId":"gemini-c"}]}))])).unwrap();
        assert_eq!(
            usage
                .metrics
                .iter()
                .map(|metric| metric.used_percent)
                .collect::<Vec<_>>(),
            vec![25.0, 100.0]
        );
        let usage=super::super::map("warp",&BTreeMap::from([("quota".into(),json!({"data":{"user":{"user":{"requestLimitInfo":{"isUnlimited":true,"requestsUsedSinceLastRefresh":12}}}}}))])).unwrap();
        assert!(usage.metrics.is_empty());
        assert_eq!(usage.amounts[0].value, 12.0);
        assert!(usage.amounts[0].currency.is_none());
    }
}

pub(super) fn factory(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "limits");
    let mut usage = ProviderUsage {
        plan: text(&response(responses, "settings")["factoryTier"]),
        ..Default::default()
    };
    let now = chrono::Utc::now().timestamp_millis();
    for (pool, prefix) in [("standard", ""), ("core", "Core ")] {
        for (key, label) in [
            ("fiveHour", "Session"),
            ("weekly", "Weekly"),
            ("monthly", "Monthly"),
        ] {
            let entry = &root["limits"][pool][key];
            let reset = time(&entry["windowEnd"])
                .or_else(|| entry["windowEnd"].as_i64().filter(|value| *value > 0));
            if entry.is_null() {
                continue;
            }
            if let (Some(percent), Some(reset)) = (
                count(&entry["usedPercent"]),
                reset.filter(|reset| *reset > now),
            ) {
                usage.metrics.extend(quota(
                    &format!("{prefix}{label}"),
                    Some(percent),
                    Some(100.0),
                    Some(reset),
                ));
            } else {
                usage.warning = true;
            }
        }
    }
    usage.amounts.extend(usd(
        "Extra usage balance",
        number(&root["extraUsageBalanceCents"]).map(|value| value / 100.0),
    ));
    usage.notice=Some(if usage.warning {"Some Factory windows are missing or expired and were omitted. No unused allowance was inferred. This connection uses an explicitly supplied access token; sign in again in Droid when it expires."} else {"Factory default-organization limits from an explicitly supplied access token. No credential refresh, local-login discovery or legacy token-pool fallback."}.into());
    usage
}

#[cfg(test)]
mod factory_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn pools_do_not_mix_and_closed_windows_do_not_become_fake_zero() {
        let usage=super::super::map("factory",&BTreeMap::from([("limits".into(),json!({"limits":{"standard":{"fiveHour":{"usedPercent":12,"windowEnd":"2030-01-01T00:00:00Z"},"weekly":{"usedPercent":99,"windowEnd":"2020-01-01T00:00:00Z"}},"core":{"monthly":{"usedPercent":50,"windowEnd":1893456000000i64}}},"extraUsageBalanceCents":1250})),("settings".into(),json!({"factoryTier":"max"}))])).unwrap();
        assert_eq!(
            usage
                .metrics
                .iter()
                .map(|metric| (metric.label.as_str(), metric.used_percent))
                .collect::<Vec<_>>(),
            vec![("Session", 12.0), ("Core Monthly", 50.0)]
        );
        assert_eq!(usage.amounts[0].value, 12.5);
        assert!(usage.warning);
        assert_eq!(usage.plan.as_deref(), Some("max"));
    }
}

fn epoch_seconds(raw: &Value) -> Option<i64> {
    count(raw)
        .filter(|seconds| seconds.fract() == 0.0 && *seconds <= i64::MAX as f64 / 1000.0)
        .and_then(|seconds| (seconds as i64).checked_mul(1000))
}
pub(super) fn devin(responses: &Responses) -> ProviderUsage {
    let root = &response(responses, "status")["userStatus"]["planStatus"];
    let mut usage = ProviderUsage {
        plan: text(&root["planInfo"]["planName"]),
        ..Default::default()
    };
    if root["planInfo"]["hideDailyQuota"] != true {
        usage.metrics.extend(remaining_quota(
            "Daily",
            count(&root["dailyQuotaRemainingPercent"]),
            epoch_seconds(&root["dailyQuotaResetAtUnix"]),
        ));
    }
    let reset = epoch_seconds(&root["weeklyQuotaResetAtUnix"]);
    let remaining = if root.get("weeklyQuotaRemainingPercent").is_some() {
        count(&root["weeklyQuotaRemainingPercent"])
    } else {
        reset.map(|_| 0.0)
    };
    // A weekly reset plus an omitted proto3 percentage denotes an exhausted weekly window.
    usage
        .metrics
        .extend(remaining_quota("Weekly", remaining, reset));
    usage.amounts.extend(usd(
        "Extra balance",
        count(&root["overageBalanceMicros"]).map(|micros| micros / 1_000_000.0),
    ));
    usage
}

pub(super) fn opencode(responses: &Responses) -> ProviderUsage {
    let root = &response(responses, "quota")["usage"];
    let mut usage = ProviderUsage::default();
    for (key, label) in [
        ("rolling", "Session"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ] {
        usage.metrics.extend(quota(
            label,
            count(&root[key]["percent"]),
            Some(100.0),
            time(&root[key]["resetsAt"]),
        ));
    }
    if !usage.metrics.is_empty() {
        usage.notice = Some("Account-wide Go limits reported by OpenCode. Zen balances and local request history are not included in this connection.".into());
    }
    usage
}

fn remaining_quota(label: &str, remaining: Option<f64>, reset: Option<i64>) -> Option<Metric> {
    quota(
        label,
        remaining
            .filter(|remaining| (0.0..=100.0).contains(remaining))
            .map(|remaining| 100.0 - remaining),
        Some(100.0),
        reset,
    )
}
fn counter_quota(label: &str, row: &Value) -> Option<Metric> {
    let limit = count(&row["limit"]);
    let used = count(&row["used"]).or_else(|| {
        limit
            .zip(count(&row["remaining"]))
            .map(|(limit, remaining)| (limit - remaining).max(0.0))
    });
    quota(
        label,
        used,
        limit,
        time(&row["resetTime"]).or_else(|| time(&row["reset_time"])),
    )
}
pub(super) fn kimi(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let mut usage = ProviderUsage::default();
    usage
        .metrics
        .extend(counter_quota("Weekly", &root["usage"]));
    for window in root["limits"].as_array().into_iter().flatten().take(8) {
        let label = match (
            window["window"]["timeUnit"].as_str(),
            count(&window["window"]["duration"]),
        ) {
            (Some("TIME_UNIT_MINUTE"), Some(minutes)) if minutes < 1440.0 => "Session",
            (Some("TIME_UNIT_HOUR"), Some(hours)) if hours < 24.0 => "Session",
            _ => continue,
        };
        if !usage.metrics.iter().any(|metric| metric.label == label) {
            usage
                .metrics
                .extend(counter_quota(label, &window["detail"]));
        }
    }
    // Kimi currently returns contradictory zeroed ratios; live counter fields are authoritative.
    if usage.metrics.iter().any(|metric| {
        number(
            &root["usages"][if metric.label == "Weekly" {
                "limit_7d"
            } else {
                "limit_5h"
            }]["used_ratio"],
        )
        .is_some_and(|ratio| (ratio * 100.0 - metric.used_percent).abs() > 0.1)
    }) {
        usage.warning = true;
        usage.notice = Some("Kimi returned conflicting quota fields. Live counters are shown; contradictory ratios are omitted.".into());
    }
    usage
}
fn epoch_ms(raw: &Value) -> Option<i64> {
    raw.as_i64()
        .filter(|epoch| *epoch >= 1_000_000_000_000 && *epoch <= 9_007_199_254_740_991)
}
pub(super) fn minimax(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let container = root.get("data").unwrap_or(root);
    let mut usage = ProviderUsage {
        plan: text(&container["current_subscribe_title"]),
        ..Default::default()
    };
    if root["base_resp"]["status_code"]
        .as_i64()
        .is_some_and(|code| code != 0)
    {
        return ProviderUsage::default();
    }
    let models = container["model_remains"].as_array();
    let chosen = models.and_then(|models| {
        models
            .iter()
            .find(|model| model["model_name"] == "general")
            .or_else(|| models.first())
    });
    if let Some(model) = chosen {
        usage.metrics.extend(remaining_quota(
            "Session",
            count(&model["current_interval_remaining_percent"]),
            epoch_ms(&model["end_time"]),
        ));
        usage.metrics.extend(remaining_quota(
            "Weekly",
            count(&model["current_weekly_remaining_percent"]),
            epoch_ms(&model["weekly_end_time"]),
        ));
    }
    usage
}
fn zai_window(entry: &Value) -> Option<&'static str> {
    let duration = count(&entry["number"]).filter(|number| *number > 0.0)?;
    match entry["unit"].as_u64()? {
        3 if duration < 24.0 => Some("Session"),
        3 | 4 | 6 => Some("Weekly"),
        5 => Some("Monthly"),
        _ => None,
    }
}
pub(super) fn zai(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let container = root.get("data").unwrap_or(root);
    let plan = response(responses, "subscription")["data"]
        .as_array()
        .and_then(|list| list.first())
        .and_then(|entry| text(&entry["productName"]));
    let mut usage = ProviderUsage {
        plan,
        ..Default::default()
    };
    if root["success"] == false {
        return ProviderUsage::default();
    }
    for entry in container["limits"]
        .as_array()
        .into_iter()
        .flatten()
        .take(16)
    {
        let reset = epoch_ms(&entry["nextResetTime"]);
        match entry["type"].as_str().or_else(|| entry["name"].as_str()) {
            Some("CREDIT_LIMIT" | "TOKENS_LIMIT") => {
                if let Some(label) = zai_window(entry) {
                    if !usage.metrics.iter().any(|metric| metric.label == label) {
                        usage.metrics.extend(quota(
                            label,
                            count(&entry["percentage"]),
                            Some(100.0),
                            reset,
                        ));
                    }
                }
            }
            Some("TIME_LIMIT") => {
                usage.metrics.extend(quota(
                    "Web searches",
                    count(&entry["currentValue"]),
                    count(&entry["usage"]),
                    reset,
                ));
            }
            _ => (),
        }
    }
    usage
}
pub(super) fn copilot(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let mut usage = ProviderUsage {
        plan: text(&root["copilot_plan"]),
        ..Default::default()
    };
    let reset = time(&root["quota_reset_date"]).or_else(|| {
        root["quota_reset_date"]
            .as_str()
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .map(|date| date.and_utc().timestamp_millis())
    });
    for (key, label) in [
        ("premium_interactions", "Credits"),
        ("chat", "Chat"),
        ("completions", "Completions"),
    ] {
        let bucket = &root["quota_snapshots"][key];
        if bucket["unlimited"] == true
            || number(&bucket["entitlement"]).is_some_and(|limit| limit <= 0.0)
            || number(&bucket["remaining"]) == Some(-1.0)
        {
            continue;
        }
        let metric =
            remaining_quota(label, count(&bucket["percent_remaining"]), reset).or_else(|| {
                quota(
                    label,
                    count(&bucket["entitlement"])
                        .zip(count(&bucket["remaining"]))
                        .map(|(limit, remaining)| (limit - remaining).max(0.0)),
                    count(&bucket["entitlement"]),
                    reset,
                )
            });
        usage.metrics.extend(metric);
    }
    if root["token_based_billing"] == true && usage.metrics.is_empty() {
        usage.amounts.extend(amount(
            "Personal credits used",
            count(&root["quota_snapshots"]["premium_interactions"]["credits_used"]),
            "credits",
            None,
        ));
        usage.notice = Some("This organization-managed seat does not report a personal percentage allowance. Organization billing is not requested.".into());
    }
    usage
}

pub(super) fn commandcode(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "credits");
    let credits = &root["credits"];
    let plan = text(&response(responses, "subscription")["data"]["planId"])
        .or_else(|| text(&credits["planId"]));
    let mut usage = ProviderUsage {
        plan,
        ..Default::default()
    };
    for (key, label) in [("fiveHour", "Session"), ("weekly", "Weekly")] {
        let window = &root["windowLimits"][key];
        usage.metrics.extend(quota(
            label,
            count(&window["used"]),
            count(&window["cap"]),
            epoch_ms(&window["resetAt"]).or_else(|| time(&window["resetAt"])),
        ));
    }
    // These credit-value units are model-dependent; treating all plans as USD would overstate money.
    for (key, label) in [
        ("monthlyCredits", "Monthly credits remaining"),
        ("purchasedCredits", "Purchased credits remaining"),
        ("freeCredits", "Free credits remaining"),
    ] {
        usage
            .amounts
            .extend(amount(label, count(&credits[key]), "credits", None));
    }
    usage
}
