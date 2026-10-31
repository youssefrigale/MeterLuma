use super::Amount;
use crate::providers::Metric;
use serde_json::Value;
use std::collections::BTreeMap;
mod alibaba;
mod amp;
mod antigravity;
mod cloud;
mod coding;
mod fireworks;
mod zed;

pub type Responses = BTreeMap<String, Value>;
#[derive(Default)]
pub struct ProviderUsage {
    pub plan: Option<String>,
    pub metrics: Vec<Metric>,
    pub amounts: Vec<Amount>,
    pub notice: Option<String>,
    pub warning: bool,
}
type Mapper = fn(&Responses) -> ProviderUsage;
const MAPPERS: &[(&str, Mapper)] = &[
    ("alibaba", alibaba::map),
    ("alibaba-cn", alibaba::map),
    ("zed", zed::map),
    ("amp", amp::map),
    ("antigravity", antigravity::map),
    ("ollama", cloud::ollama),
    ("factory", coding::factory),
    ("factory-eu", coding::factory),
    ("gemini", coding::gemini),
    ("warp", coding::warp),
    ("perplexity", cloud::perplexity),
    ("qoder", coding::qoder),
    ("fireworks", fireworks::map),
    ("byteplus", coding::byteplus),
    ("windsurf", coding::devin),
    ("devin", coding::devin),
    ("opencode", coding::opencode),
    ("deepseek", deepseek),
    ("openrouter", openrouter),
    ("elevenlabs", elevenlabs),
    ("synthetic", synthetic),
    ("venice", venice),
    ("crofai", crofai),
    ("nous", nous),
    ("pioneer", pioneer),
    ("neuralwatt", cloud::neuralwatt),
    ("vercel", cloud::vercel),
    ("grok", cloud::grok),
    ("kimi", coding::kimi),
    ("minimax", coding::minimax),
    ("minimax-cn", coding::minimax),
    ("zai", coding::zai),
    ("zai-cn", coding::zai),
    ("copilot", coding::copilot),
    ("commandcode", coding::commandcode),
];

pub fn map(id: &str, responses: &Responses) -> Result<ProviderUsage, String> {
    let mapper = MAPPERS
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, mapper)| mapper)
        .ok_or("This provider has no verified usage mapper.")?;
    let snapshot = mapper(responses);
    if snapshot.metrics.is_empty() && snapshot.amounts.is_empty() {
        return Err(snapshot.notice.unwrap_or_else(|| {
            "The provider returned no supported usage or balance data. No values were invented."
                .into()
        }));
    }
    Ok(snapshot)
}
fn response<'a>(responses: &'a Responses, key: &str) -> &'a Value {
    responses.get(key).unwrap_or(&Value::Null)
}
fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|number| number.is_finite() && number.abs() <= 9_007_199_254_740_991.0)
}
fn count(value: &Value) -> Option<f64> {
    number(value).filter(|number| *number >= 0.0)
}
fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= 120 && !text.chars().any(char::is_control))
        .map(str::to_string)
}
fn time(value: &Value) -> Option<i64> {
    value
        .as_str()
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .map(|time| time.timestamp_millis())
}
fn currency(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| text.len() == 3 && text.bytes().all(|byte| byte.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
}
fn amount(label: &str, value: Option<f64>, unit: &str, currency: Option<String>) -> Option<Amount> {
    Some(Amount {
        label: label.into(),
        value: value?,
        unit: unit.into(),
        currency,
    })
}
fn quota(
    label: &str,
    used: Option<f64>,
    limit: Option<f64>,
    reset_at: Option<i64>,
) -> Option<Metric> {
    let (used, limit) = (used?, limit.filter(|limit| *limit > 0.0)?);
    let used_percent = used / limit * 100.0;
    used_percent.is_finite().then(|| Metric {
        label: label.into(),
        used_percent,
        reset_at,
        period_minutes: None,
    })
}
fn usd(label: &str, value: Option<f64>) -> Option<Amount> {
    amount(label, value, "", Some("USD".into()))
}

fn deepseek(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = response(responses, "balance");
    for entry in root["balance_infos"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
    {
        let Some(currency) = currency(&entry["currency"]) else {
            continue;
        };
        for (key, label) in [
            ("total_balance", "Balance"),
            ("granted_balance", "Granted credits"),
            ("topped_up_balance", "Paid balance"),
        ] {
            snapshot.amounts.extend(amount(
                label,
                number(&entry[key]),
                "",
                Some(currency.clone()),
            ));
        }
    }
    if root["is_available"] == false {
        snapshot.warning = true;
        snapshot.notice = Some("DeepSeek reports insufficient balance for API calls.".into());
    }
    snapshot
}
fn openrouter(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let key = &response(responses, "key")["data"];
    let credits = &response(responses, "credits")["data"];
    snapshot.plan = key["is_free_tier"]
        .as_bool()
        .map(|free| if free { "Free tier" } else { "Pay as you go" }.into());
    if let (Some(total), Some(used)) = (
        count(&credits["total_credits"]),
        count(&credits["total_usage"]),
    ) {
        snapshot
            .amounts
            .extend(usd("Account balance", Some(total - used)));
        snapshot
            .amounts
            .extend(usd("Account lifetime spend", Some(used)));
    }
    for (field, label) in [
        ("usage_daily", "Key spend today"),
        ("usage_weekly", "Key spend this week"),
        ("usage_monthly", "Key spend this month"),
    ] {
        snapshot.amounts.extend(usd(label, count(&key[field])));
    }
    snapshot.amounts.extend(usd(
        "Key remaining allowance",
        number(&key["limit_remaining"]),
    ));
    snapshot.metrics.extend(quota(
        "Key allowance",
        count(&key["limit"])
            .zip(number(&key["limit_remaining"]))
            .map(|(limit, remaining)| (limit - remaining).max(0.0)),
        count(&key["limit"]),
        None,
    ));
    snapshot
}
fn elevenlabs(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = response(responses, "subscription");
    snapshot.plan = text(&root["tier"]);
    let reset = root["next_character_count_reset_unix"]
        .as_i64()
        .filter(|reset| *reset >= 0)
        .and_then(|reset| reset.checked_mul(1000));
    snapshot.metrics.extend(quota(
        "Monthly characters",
        count(&root["character_count"]),
        count(&root["character_limit"]),
        reset,
    ));
    snapshot.amounts.extend(amount(
        "Characters used",
        count(&root["character_count"]),
        "characters",
        None,
    ));
    snapshot.amounts.extend(amount(
        "Character allowance",
        count(&root["character_limit"]),
        "characters",
        None,
    ));
    if let Some(currency) = currency(&root["current_overage"]["currency"]) {
        snapshot.amounts.extend(amount(
            "Current overage",
            count(&root["current_overage"]["amount"]),
            "",
            Some(currency),
        ));
    }
    snapshot
}
fn synthetic(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = &response(responses, "quota")["subscription"];
    if count(&root["requests"]).is_none() || count(&root["limit"]).is_none() {
        return snapshot;
    }
    snapshot.metrics.extend(quota(
        "Session",
        count(&root["requests"]),
        count(&root["limit"]),
        time(&root["renewsAt"]),
    ));
    snapshot.amounts.extend(amount(
        "Requests used",
        count(&root["requests"]),
        "requests",
        None,
    ));
    snapshot.amounts.extend(amount(
        "Request allowance",
        count(&root["limit"]),
        "requests",
        None,
    ));
    snapshot
}
fn venice(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = &response(responses, "limits")["data"];
    snapshot.plan = text(&root["apiTier"]["id"]);
    snapshot
        .amounts
        .extend(usd("USD balance", number(&root["balances"]["USD"])));
    snapshot.amounts.extend(amount(
        "DIEM balance",
        count(&root["balances"]["DIEM"]),
        "DIEM",
        None,
    ));
    if root["accessPermitted"] == false {
        snapshot.warning = true;
        snapshot.notice = Some("Venice reports API access is not currently permitted.".into());
    }
    snapshot
}
fn crofai(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = response(responses, "usage");
    snapshot.amounts.extend(amount(
        "Available requests",
        count(&root["usable_requests"]),
        "requests",
        None,
    ));
    snapshot
        .amounts
        .extend(amount("Credits", count(&root["credits"]), "credits", None));
    snapshot
}
fn nous(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let billing = response(responses, "billing");
    let subscription = &response(responses, "subscription")["current"];
    snapshot.plan = text(&subscription["tierName"]);
    snapshot
        .amounts
        .extend(usd("Balance", number(&billing["balanceUsd"])));
    snapshot.amounts.extend(usd(
        "Spend this month",
        count(&billing["monthlyCap"]["spentThisMonthUsd"]),
    ));
    snapshot.metrics.extend(quota(
        "Monthly cap",
        count(&billing["monthlyCap"]["spentThisMonthUsd"]),
        count(&billing["monthlyCap"]["limitUsd"]),
        None,
    ));
    snapshot.metrics.extend(quota(
        "Subscription credits",
        count(&subscription["monthlyCredits"])
            .zip(count(&subscription["creditsRemaining"]))
            .map(|(limit, remaining)| (limit - remaining).max(0.0)),
        count(&subscription["monthlyCredits"]),
        time(&subscription["cycleEndsAt"]),
    ));
    snapshot.amounts.extend(amount(
        "Credits remaining",
        count(&subscription["creditsRemaining"]),
        "credits",
        None,
    ));
    snapshot
}
fn pioneer(responses: &Responses) -> ProviderUsage {
    let mut snapshot = ProviderUsage::default();
    let root = response(responses, "billing");
    snapshot.plan = text(&root["payment_plan"]);
    snapshot.amounts.extend(usd(
        "Free credits remaining",
        number(&root["free_tier_remaining"]).map(|cents| cents / 100.0),
    ));
    snapshot.amounts.extend(usd(
        "Reported usage",
        count(&root["total_usage"]).map(|cents| cents / 100.0),
    ));
    snapshot.metrics.extend(quota(
        "Free credit allowance",
        count(&root["credit_limit"])
            .zip(count(&root["free_tier_remaining"]))
            .map(|(limit, remaining)| (limit - remaining).max(0.0)),
        count(&root["credit_limit"]),
        None,
    ));
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn responses(rows: &[(&str, Value)]) -> Responses {
        rows.iter()
            .map(|(key, value)| (key.to_string(), value.clone()))
            .collect()
    }
    #[test]
    fn balances_keep_provider_currency_units_and_real_zeros_without_invented_percentages() {
        let usage = map("deepseek", &responses(&[("balance", json!({"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"0.00","granted_balance":"0.00","topped_up_balance":"0.00"},{"currency":"USD","total_balance":"8.76","granted_balance":"1.20","topped_up_balance":"7.56"}]}))])).unwrap();
        assert!(usage.metrics.is_empty());
        assert_eq!(usage.amounts.len(), 6);
        assert_eq!(usage.amounts[0].currency.as_deref(), Some("CNY"));
        assert_eq!(usage.amounts[0].value, 0.0);
        assert_eq!(usage.amounts[3].currency.as_deref(), Some("USD"));
        assert_eq!(usage.amounts[3].value, 8.76);
        let usage = map(
            "venice",
            &responses(&[(
                "limits",
                json!({"data":{"balances":{"USD":0.0123,"DIEM":100.023}}}),
            )]),
        )
        .unwrap();
        assert_eq!(usage.amounts[0].value, 0.0123);
        assert_eq!(usage.amounts[1].currency, None);
        assert_eq!(usage.amounts[1].unit, "DIEM");
        let usage = map(
            "crofai",
            &responses(&[("usage", json!({"usable_requests":450,"credits":12.3456}))]),
        )
        .unwrap();
        assert!(usage.metrics.is_empty());
        assert_eq!(usage.amounts[0].unit, "requests");
        assert_eq!(usage.amounts[1].currency, None);
    }
    #[test]
    fn ordinary_openrouter_keys_keep_usage_when_account_balance_requires_more_permissions() {
        let key = json!({"data":{"usage_daily":0,"usage_weekly":4,"usage_monthly":9,"limit":100,"limit_remaining":92,"is_free_tier":false}});
        let usage = map("openrouter", &responses(&[("key", key.clone())])).unwrap();
        assert_eq!(usage.metrics[0].used_percent, 8.0);
        assert_eq!(usage.amounts[0].value, 0.0);
        assert!(!usage
            .amounts
            .iter()
            .any(|amount| amount.label == "Account balance"));
        let usage = map(
            "openrouter",
            &responses(&[
                ("key", key),
                (
                    "credits",
                    json!({"data":{"total_credits":100.5,"total_usage":25.75}}),
                ),
            ]),
        )
        .unwrap();
        assert_eq!(usage.amounts[0].label, "Account balance");
        assert_eq!(usage.amounts[0].value, 74.75);
    }
    #[test]
    fn request_character_and_credit_allowances_use_their_returned_denominators_and_reset_units() {
        for (id, input, percent, reset) in [
            (
                "synthetic",
                responses(&[(
                    "quota",
                    json!({"subscription":{"limit":135,"requests":27,"renewsAt":"2030-01-01T00:00:00Z"}}),
                )]),
                20.0,
                Some(1_893_456_000_000),
            ),
            (
                "elevenlabs",
                responses(&[(
                    "subscription",
                    json!({"tier":"starter","character_count":0,"character_limit":10000,"next_character_count_reset_unix":1900000000}),
                )]),
                0.0,
                Some(1_900_000_000_000),
            ),
            (
                "nous",
                responses(&[
                    (
                        "billing",
                        json!({"balanceUsd":9,"monthlyCap":{"limitUsd":100,"spentThisMonthUsd":10}}),
                    ),
                    (
                        "subscription",
                        json!({"current":{"tierName":"Plus","monthlyCredits":100,"creditsRemaining":90}}),
                    ),
                ]),
                10.0,
                None,
            ),
            (
                "pioneer",
                responses(&[(
                    "billing",
                    json!({"credit_limit":1000,"free_tier_remaining":400,"total_usage":100,"payment_plan":"pro_legacy"}),
                )]),
                60.0,
                None,
            ),
        ] {
            let usage = map(id, &input).unwrap();
            assert_eq!(usage.metrics[0].used_percent, percent, "{id}");
            assert_eq!(usage.metrics[0].reset_at, reset, "{id}");
            if id == "pioneer" {
                assert_eq!(usage.amounts[0].value, 4.0);
            }
        }
    }
    #[test]
    fn every_ready_provider_has_a_mapper_and_missing_payloads_never_become_fake_zero_usage() {
        for spec in super::super::catalog::catalog()
            .unwrap()
            .iter()
            .filter(|spec| spec.state == "ready" && spec.source == "api")
        {
            assert!(MAPPERS.iter().any(|(id, _)| *id == spec.id));
            assert!(map(&spec.id, &Responses::new()).is_err());
        }
        assert!(map(
            "deepseek",
            &responses(&[(
                "balance",
                json!({"balance_infos":[{"currency":"USD","total_balance":"NaN"}]})
            )])
        )
        .is_err());
        assert!(map(
            "synthetic",
            &responses(&[("quota", json!({"subscription":{"limit":100}}))])
        )
        .is_err());
    }
    #[test]
    fn coding_plan_contracts_keep_window_meanings_and_prefer_live_kimi_counters_over_zeroed_ratios()
    {
        for (id, root, expected) in [
            (
                "opencode",
                json!({"usage":{"rolling":{"percent":0.04,"resetsAt":"2030-01-02T00:00:00Z"},"weekly":{"percent":21,"resetsAt":"2030-01-08T00:00:00Z"},"monthly":{"percent":15,"resetsAt":"2030-02-01T00:00:00Z"}}}),
                vec![("Session", 0.04), ("Weekly", 21.0), ("Monthly", 15.0)],
            ),
            (
                "kimi",
                json!({"usage":{"limit":"100","used":"85","resetTime":"2030-01-08T00:00:00Z"},"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"100","used":"8","resetTime":"2030-01-02T00:00:00Z"}}],"usages":{"limit_7d":{"used_ratio":0},"limit_5h":{"used_ratio":0}}}),
                vec![("Weekly", 85.0), ("Session", 8.0)],
            ),
            (
                "minimax",
                json!({"base_resp":{"status_code":0},"model_remains":[{"model_name":"general","current_interval_remaining_percent":76,"current_weekly_remaining_percent":55,"end_time":1893542400000i64,"weekly_end_time":1894060800000i64}]}),
                vec![("Session", 24.0), ("Weekly", 45.0)],
            ),
            (
                "zai",
                json!({"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","unit":3,"number":5,"percentage":17,"nextResetTime":1893542400000i64},{"type":"CREDIT_LIMIT","unit":6,"number":1,"percentage":28},{"type":"TIME_LIMIT","usage":1000,"currentValue":7}]}}),
                vec![("Session", 17.0), ("Weekly", 28.0), ("Web searches", 0.7)],
            ),
            (
                "copilot",
                json!({"copilot_plan":"individual","quota_reset_date":"2030-01-02","quota_snapshots":{"premium_interactions":{"entitlement":100,"remaining":70,"percent_remaining":70},"chat":{"entitlement":-1,"remaining":-1,"unlimited":true}}}),
                vec![("Credits", 30.0)],
            ),
        ] {
            let usage = map(id, &responses(&[("quota", root)])).unwrap();
            let actual: Vec<_> = usage
                .metrics
                .iter()
                .map(|metric| (metric.label.as_str(), metric.used_percent))
                .collect();
            assert_eq!(actual.len(), expected.len(), "{id}");
            for ((label, percent), (expected_label, expected_percent)) in
                actual.iter().zip(expected.iter())
            {
                assert_eq!(label, expected_label, "{id}");
                assert!((percent - expected_percent).abs() < 1e-9, "{id}: {percent}");
            }
            assert_eq!(
                usage.metrics[0].reset_at,
                Some(if id == "kimi" {
                    1_894_060_800_000
                } else {
                    1_893_542_400_000
                }),
                "{id}"
            );
            if id == "kimi" {
                assert!(usage.notice.unwrap().contains("conflicting"));
            }
        }
        let managed = map("copilot", &responses(&[("quota", json!({"token_based_billing":true,"quota_snapshots":{"premium_interactions":{"entitlement":0,"credits_used":17}}}))])).unwrap();
        assert!(managed.metrics.is_empty());
        assert_eq!(managed.amounts[0].value, 17.0);
        let command = map("commandcode", &responses(&[("credits",json!({"credits":{"monthlyCredits":6,"purchasedCredits":0},"windowLimits":{"fiveHour":{"used":1,"cap":3,"resetAt":1893542400000i64},"weekly":{"used":2,"cap":6}}}))])).unwrap();
        assert_eq!(command.metrics.len(), 2);
        assert!((command.metrics[0].used_percent - 100.0 / 3.0).abs() < 1e-9);
        assert_eq!(command.amounts.len(), 2);
        assert!(command
            .amounts
            .iter()
            .all(|amount| amount.currency.is_none() && amount.unit == "credits"));
        assert!(map("minimax", &responses(&[("quota", json!({"base_resp":{"status_code":1004},"model_remains":[{"current_interval_remaining_percent":100}]}))])).is_err());
    }
    #[test]
    fn cloud_balances_and_billing_energy_are_not_converted_into_invented_dollar_limits() {
        let usage = map("neuralwatt", &responses(&[("quota", json!({"balance":{"credits_remaining_usd":32.6774},"subscription":{"plan":"standard","kwh_included":20,"kwh_used":12,"kwh_remaining":8,"current_period_end":"2030-01-02T00:00:00Z"},"usage":{"current_month":{"cost_usd":160.1463}}}))])).unwrap();
        assert_eq!(usage.metrics[0].used_percent, 60.0);
        assert_eq!(usage.amounts[0].value, 32.6774);
        assert_eq!(usage.amounts.last().unwrap().unit, "kWh");
        let usage = map(
            "vercel",
            &responses(&[("credits", json!({"balance":"-0.12","total_used":"500.321"}))]),
        )
        .unwrap();
        assert!(usage.metrics.is_empty());
        assert_eq!(usage.amounts[0].value, -0.12);
        for (raw, expected) in [
            (json!({}), Some(0.0)),
            (json!({"creditUsagePercent":33.25}), Some(33.25)),
            (json!({"creditUsagePercent":"malformed"}), None),
        ] {
            let mut config = json!({"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2030-01-01T00:00:00Z","end":"2030-01-08T00:00:00Z"}});
            config
                .as_object_mut()
                .unwrap()
                .extend(raw.as_object().unwrap().clone());
            let usage = map("grok", &responses(&[("billing", json!({"config":config}))]));
            assert_eq!(
                usage
                    .ok()
                    .and_then(|usage| usage.metrics.first().map(|metric| metric.used_percent)),
                expected
            );
        }
    }
}
