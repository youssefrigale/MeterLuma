use super::*;

pub(super) fn map(responses: &Responses) -> ProviderUsage {
    let plan = &response(responses, "account")["plan"];
    let predictions = &plan["usage"]["edit_predictions"];
    let mut usage = ProviderUsage::default();
    let Some(used) = predictions["used"]
        .as_u64()
        .filter(|used| *used <= u32::MAX as u64)
    else {
        return usage;
    };
    usage.plan = text(&plan["plan_v3"]).map(|plan| match plan.as_str() {
        "zed_free" => "Free".into(),
        "zed_pro" => "Pro".into(),
        "zed_pro_trial" => "Pro trial".into(),
        "zed_business" => "Business".into(),
        "zed_vip" => "VIP".into(),
        "zed_student" => "Student".into(),
        _ => plan,
    });
    usage.amounts.extend(amount(
        "Edit predictions used",
        Some(used as f64),
        "predictions",
        None,
    ));
    if let Some(limit) = predictions["limit"]["limited"]
        .as_i64()
        .filter(|limit| (0..=i32::MAX as i64).contains(limit))
    {
        usage.amounts.extend(amount(
            "Edit prediction limit",
            Some(limit as f64),
            "predictions",
            None,
        ));
        if limit > 0 {
            usage.metrics.extend(quota(
                "Edit predictions",
                Some(used as f64),
                Some(limit as f64),
                None,
            ));
        }
    }
    usage.notice = Some(format!("Personal Zed edit-prediction usage only. {}Agent tokens, model budgets, organization plans and spending are not included. No quota reset is inferred from the subscription period.", if predictions["limit"] == "unlimited" { "The provider reports unlimited edit predictions. " } else { "" }));
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn personal_edit_predictions_keep_limited_zero_and_unlimited_semantics_without_account_data() {
        for (limit, percentage) in [
            (json!({"limited":2000}), Some(25.0)),
            (json!({"limited":0}), None),
            (json!("unlimited"), None),
            (json!(null), None),
        ] {
            let root = json!({"user":{"name":"PRIVATE_NAME"},"plan":{"plan_v3":"zed_pro","subscription_period":{"ended_at":"2026-11-01T00:00:00Z"},"usage":{"edit_predictions":{"used":500,"limit":limit}}},"plans_by_organization":{"PRIVATE_ORG":"zed_business"}});
            let usage =
                super::super::map("zed", &BTreeMap::from([("account".into(), root)])).unwrap();
            assert_eq!(usage.plan.as_deref(), Some("Pro"));
            assert_eq!(usage.amounts[0].value, 500.0);
            assert_eq!(
                usage.metrics.first().map(|metric| metric.used_percent),
                percentage
            );
            assert!(usage.metrics.iter().all(|metric| metric.reset_at.is_none()));
            assert!(!format!("{:?}", usage.notice).contains("PRIVATE_"));
        }
        assert!(super::super::map(
            "zed",
            &BTreeMap::from([(
                "account".into(),
                json!({"plan":{"usage":{"edit_predictions":{"used":-1,"limit":{"limited":1000}}}}})
            )])
        )
        .is_err());
    }
}
