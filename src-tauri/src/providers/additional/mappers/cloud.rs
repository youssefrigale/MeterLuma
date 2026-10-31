use super::*;

pub(super) fn perplexity(responses: &Responses) -> ProviderUsage {
    let mut usage = ProviderUsage::default();
    let root = response(responses, "limits");
    for (key, label) in [
        ("remaining_pro", "Queries remaining"),
        ("remaining_research", "Research remaining"),
        ("remaining_labs", "Labs remaining"),
        ("remaining_agentic_research", "Agentic research remaining"),
    ] {
        usage
            .amounts
            .extend(amount(label, count(&root[key]), "requests", None));
    }
    usage.notice=Some("Experimental consumer rate-limit endpoint using a supplied account access token. API billing balance, browser/app credential extraction and challenge bypass are not included. No total allowance or reset time is inferred.".into());
    usage
}

#[cfg(test)]
mod perplexity_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn remaining_counts_are_not_percentages_or_dollars_and_missing_is_not_zero() {
        let usage=super::super::map("perplexity",&BTreeMap::from([("limits".into(),json!({"remaining_pro":0,"remaining_research":12,"remaining_labs":null,"remaining_agentic_research":"invalid"}))])).unwrap();
        assert!(usage.metrics.is_empty());
        assert_eq!(
            usage
                .amounts
                .iter()
                .map(|amount| amount.value)
                .collect::<Vec<_>>(),
            vec![0.0, 12.0]
        );
        assert!(usage
            .amounts
            .iter()
            .all(|amount| amount.currency.is_none() && amount.unit == "requests"));
    }
}

pub(super) fn ollama(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "balance");
    let included = &root["included"];
    let mut usage = ProviderUsage::default();
    if let (Some(balance), Some(allowance)) = (
        count(&included["balance_usd"]),
        count(&included["allowance_usd"]).filter(|value| *value > 0.0),
    ) {
        if balance <= allowance {
            usage.metrics.extend(quota(
                "Monthly included credits",
                Some(allowance - balance),
                Some(allowance),
                time(&included["period"]["until"]),
            ));
            usage.amounts.extend(usd("Included balance", Some(balance)));
        }
    }
    for (key, label) in [("session", "Session"), ("weekly", "Weekly")] {
        if let Some(remaining) =
            count(&included[key]["remaining_percent"]).filter(|value| *value <= 100.0)
        {
            usage.metrics.extend(quota(
                label,
                Some(100.0 - remaining),
                Some(100.0),
                time(&included[key]["resets_at"]),
            ));
        }
    }
    usage.amounts.extend(usd(
        "Purchased credits",
        count(&root["purchased"]["balance_usd"]),
    ));
    usage.notice = Some(
        "Cloud balances only. Team members may share these balances. Local models are not counted."
            .into(),
    );
    usage
}

#[cfg(test)]
mod ollama_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn monthly_and_legacy_cloud_contracts_are_distinct_and_zero_is_not_missing() {
        let parse = |root| super::super::map("ollama", &BTreeMap::from([("balance".into(), root)]));
        let usage=parse(json!({"included":{"balance_usd":72.5,"allowance_usd":100,"period":{"until":"2030-01-01T00:00:00Z"}},"purchased":{"balance_usd":0}})).unwrap();
        assert!((usage.metrics[0].used_percent - 27.5).abs() < 1e-9);
        assert_eq!(usage.amounts[1].value, 0.0);
        let legacy=parse(json!({"included":{"session":{"remaining_percent":75},"weekly":{"remaining_percent":0}}})).unwrap();
        assert_eq!(
            legacy
                .metrics
                .iter()
                .map(|metric| metric.used_percent)
                .collect::<Vec<_>>(),
            vec![25.0, 100.0]
        );
        assert!(legacy.amounts.is_empty());
        assert!(parse(json!({"included":{}})).is_err());
    }
}

pub(super) fn neuralwatt(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "quota");
    let subscription = &root["subscription"];
    let mut usage = ProviderUsage {
        plan: text(&subscription["plan"]),
        ..Default::default()
    };
    usage.amounts.extend(usd(
        "Credit balance",
        number(&root["balance"]["credits_remaining_usd"]),
    ));
    usage.amounts.extend(usd(
        "Spend this month",
        count(&root["usage"]["current_month"]["cost_usd"]),
    ));
    usage.metrics.extend(quota(
        "Billing-period energy",
        count(&subscription["kwh_used"]),
        count(&subscription["kwh_included"]),
        time(&subscription["current_period_end"]),
    ));
    usage.amounts.extend(amount(
        "Energy remaining",
        number(&subscription["kwh_remaining"]),
        "kWh",
        None,
    ));
    if subscription["status"]
        .as_str()
        .is_some_and(|status| status != "active")
    {
        usage.warning = true;
        usage.notice = Some(
            "Neuralwatt does not report an active subscription. Available balances are shown."
                .into(),
        );
    }
    usage
}

pub(super) fn vercel(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "credits");
    let mut usage = ProviderUsage::default();
    usage
        .amounts
        .extend(usd("Team credit balance", number(&root["balance"])));
    usage
        .amounts
        .extend(usd("Team lifetime spend", count(&root["total_used"])));
    usage
}

pub(super) fn grok(responses: &Responses) -> ProviderUsage {
    let config = &response(responses, "billing")["config"];
    let period = &config["currentPeriod"];
    let mut usage = ProviderUsage {
        plan: text(&response(responses, "settings")["subscription_tier_display"]),
        ..Default::default()
    };
    if period["type"] != "USAGE_PERIOD_TYPE_WEEKLY"
        || time(&period["start"])
            .zip(time(&period["end"]))
            .is_none_or(|(start, end)| end <= start)
    {
        return usage;
    }
    // Grok's proto3 JSON omits a genuine zero; a present malformed value must still fail.
    let percent = if config.get("creditUsagePercent").is_none() {
        Some(0.0)
    } else {
        count(&config["creditUsagePercent"])
    };
    usage.metrics.extend(quota(
        "Shared weekly pool",
        percent,
        Some(100.0),
        time(&period["end"]),
    ));
    usage.amounts.extend(amount(
        "Pay-as-you-go cap",
        count(&config["onDemandCap"]["val"]),
        "credits",
        None,
    ));
    usage.notice = Some("This weekly pool may also appear in Cursor. It is shown separately and is not added to a combined allowance.".into());
    usage
}
