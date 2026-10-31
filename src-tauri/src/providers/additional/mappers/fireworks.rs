use super::*;
fn money(raw: &Value) -> Option<(String, f64)> {
    let currency = currency(&raw["currencyCode"])?;
    let units = if raw.get("units").is_none() {
        0.0
    } else {
        number(&raw["units"])?
    };
    let nanos = if raw.get("nanos").is_none() {
        0
    } else {
        raw["nanos"].as_i64()?
    };
    if units.fract() != 0.0
        || !(-999_999_999..=999_999_999).contains(&nanos)
        || units * (nanos as f64) < 0.0
    {
        return None;
    }
    Some((currency, units + nanos as f64 / 1_000_000_000.0))
}
pub(super) fn map(responses: &Responses) -> ProviderUsage {
    let mut usage = ProviderUsage::default();
    let mut currencies = BTreeMap::<String, f64>::new();
    let Some(rows) = response(responses, "summary")["lineItems"].as_array() else {
        return usage;
    };
    for row in rows.iter().take(5000) {
        let Some((currency, value)) = money(&row["totalCost"]) else {
            usage.warning = true;
            continue;
        };
        let total = currencies.entry(currency).or_default();
        if (*total + value).is_finite() && (*total + value).abs() <= 9_007_199_254_740_991.0 {
            *total += value;
        } else {
            usage.warning = true;
        }
    }
    usage.warning |= rows.len() > 5000;
    for (currency, value) in currencies {
        usage.amounts.extend(amount(
            "Rated cost · 30 UTC days",
            Some(value),
            "",
            Some(currency),
        ));
    }
    if rows.is_empty() {
        usage
            .amounts
            .extend(amount("Rated billing line items", Some(0.0), "items", None));
    }
    usage.notice=Some(format!("{}Fireworks rated billing summary for the last 30 UTC dates, including today. Daily costs can arrive late. This is not a credit balance, Fire Pass quota or paid invoice, and is not added to local Cost estimates.",if usage.warning {"Partial summary: some billing rows could not be interpreted. "} else {""}));
    usage
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn money_keeps_currencies_refunds_and_nanos_without_summing_daily_buckets_twice() {
        let root = json!({"lineItems":[{"totalCost":{"currencyCode":"USD","units":"2","nanos":250000000}},{"totalCost":{"currencyCode":"USD","units":"-1","nanos":-500000000}},{"totalCost":{"currencyCode":"CNY","nanos":500000000}},{"totalCost":{"currencyCode":"USD","units":"1","nanos":-1}}],"usageBuckets":[{"lineItems":[{"totalCost":{"currencyCode":"USD","units":"100"}}]}]});
        let usage =
            super::super::map("fireworks", &BTreeMap::from([("summary".into(), root)])).unwrap();
        assert_eq!(
            usage
                .amounts
                .iter()
                .map(|amount| (amount.currency.as_deref(), amount.value))
                .collect::<Vec<_>>(),
            vec![(Some("CNY"), 0.5), (Some("USD"), 0.75)]
        );
        assert!(usage.metrics.is_empty());
        assert!(usage.warning);
        assert!(super::super::map("fireworks", &BTreeMap::new()).is_err());
    }
}
