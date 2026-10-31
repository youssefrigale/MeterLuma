use super::*;

fn quota_response(root: &Value) -> &Value {
    if let Some(envelope) = root.get("data") {
        if let Some(version) = envelope.get("DataV2") {
            return version
                .pointer("/data/data")
                .or_else(|| version.get("data"))
                .unwrap_or(version);
        }
        return envelope.get("data").unwrap_or(envelope);
    }
    root
}

fn append_window(usage: &mut ProviderUsage, quotas: &Value, prefix: &str, label: &str) {
    let reset = count(&quotas[format!("{prefix}QuotaNextRefreshTime")])
        .filter(|reset| *reset > 0.0)
        .map(|reset| reset as i64);
    if reset.is_some_and(|reset| reset <= chrono::Utc::now().timestamp_millis()) {
        usage.warning = true;
        return;
    }
    let used = count(&quotas[format!("{prefix}UsedQuota")]);
    let limit = count(&quotas[format!("{prefix}TotalQuota")]);
    usage.metrics.extend(quota(label, used, limit, reset));
    usage
        .amounts
        .extend(amount(&format!("{label} used"), used, "requests", None));
    usage
        .amounts
        .extend(amount(&format!("{label} limit"), limit, "requests", None));
    usage.warning |= used.is_none() || limit.is_none_or(|limit| limit <= 0.0);
}

pub(super) fn map(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let mut usage = ProviderUsage::default();
    if root.pointer("/data/success") == Some(&Value::Bool(false)) {
        usage.notice = Some("The Model Studio console request failed. Check your console sign-in and Coding Plan permissions.".into());
        return usage;
    }
    let active = quota_response(root)["codingPlanInstanceInfos"]
        .as_array()
        .and_then(|instances| {
            instances
                .iter()
                .find(|instance| instance["status"] == "VALID")
        });
    let Some(active) = active else {
        usage.notice = Some("No active Coding Plan usage was returned for this console sign-in and region. No quota was inferred.".into());
        return usage;
    };
    usage.plan = text(&active["instanceType"]).map(|plan| match plan.as_str() {
        "pro" => "Pro".into(),
        "lite" => "Lite".into(),
        _ => plan,
    });
    for (prefix, label) in [
        ("per5Hour", "5-hour rolling"),
        ("perWeek", "Weekly"),
        ("perBillMonth", "Monthly"),
    ] {
        append_window(&mut usage, &active["codingPlanQuotaInfo"], prefix, label);
    }
    usage.notice = Some(format!("{}Coding Plan request quotas from the selected regional console. The five-hour quota restores on a rolling basis. Token Plan, model-token billing and other regions are excluded; no credential renewal.",if usage.warning {"Some windows are missing, expired or have no positive quota. "} else {""}));
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn coding_plan_windows_use_actual_request_counters_and_never_fabricate_missing_entitlements() {
        let future = chrono::Utc::now().timestamp_millis() + 3_600_000;
        let payload = json!({"codingPlanInstanceInfos":[{"status":"EXPIRED","codingPlanQuotaInfo":{"per5HourUsedQuota":0,"per5HourTotalQuota":9999}},{"status":"VALID","instanceType":"pro","instanceId":"PRIVATE_ID","codingPlanQuotaInfo":{"per5HourUsedQuota":38,"per5HourTotalQuota":100,"per5HourQuotaNextRefreshTime":future,"perWeekUsedQuota":0,"perWeekTotalQuota":1000,"perBillMonthTotalQuota":0}}]});
        for root in [
            payload.clone(),
            json!({"data":{"data":payload}}),
            json!({"data":{"DataV2":{"data":{"data":payload}}}}),
        ] {
            let usage =
                super::super::map("alibaba", &BTreeMap::from([("quota".into(), root)])).unwrap();
            assert_eq!(
                usage
                    .metrics
                    .iter()
                    .map(|metric| metric.used_percent)
                    .collect::<Vec<_>>(),
                vec![38.0, 0.0]
            );
            assert_eq!(usage.metrics[0].reset_at, Some(future));
            assert_eq!(usage.metrics[0].period_minutes, None);
            assert!(usage.warning);
            assert_eq!(usage.amounts[0].unit, "requests");
        }
        for root in [
            json!({}),
            json!({"data":{"success":false,"errorCode":"PRIVATE_ERROR"}}),
            json!({"codingPlanInstanceInfos":[{"status":"EXPIRED"}]}),
        ] {
            assert!(
                super::super::map("alibaba", &BTreeMap::from([("quota".into(), root)])).is_err()
            );
        }
    }
}
