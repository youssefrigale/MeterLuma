use super::*;

fn dollars(value: &str) -> Option<f64> {
    value
        .trim()
        .strip_prefix('$')?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(value))
}
fn remaining(value: &str) -> Option<f64> {
    value
        .trim()
        .strip_suffix('%')?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && (0.0..=100.0).contains(value))
}
fn subscription(line: &str, usage: &mut ProviderUsage) -> Option<()> {
    let (plan, balances) = line.strip_prefix("Amp ")?.split_once(" Subscription:")?;
    let (agent, orb) = balances.split_once(" usage and ")?;
    let agent = remaining(agent.split_whitespace().next()?)?;
    let (orb, _) = orb.split_once(" orb usage remaining")?;
    let orb = remaining(orb)?;
    usage.plan = text(&Value::String(plan.into()));
    for (label, remaining) in [("Agent usage", agent), ("Orb usage", orb)] {
        usage
            .metrics
            .extend(quota(label, Some(100.0 - remaining), Some(100.0), None));
    }
    Some(())
}
fn free(line: &str, usage: &mut ProviderUsage) -> Option<()> {
    let balances = line.strip_prefix("Amp Free:")?.split_once(" remaining")?.0;
    let (remaining, total) = balances.split_once('/')?;
    let (remaining, total) = (dollars(remaining)?, dollars(total)?);
    if remaining > total {
        return None;
    }
    usage.plan = Some("Free".into());
    usage.amounts.extend(usd("Free balance", Some(remaining)));
    usage.metrics.extend(quota(
        "Free allowance",
        Some(total - remaining),
        Some(total),
        None,
    ));
    Some(())
}
pub(super) fn map(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "balance");
    let display = root["result"]["displayText"]
        .as_str()
        .or_else(|| root["displayText"].as_str());
    let mut usage = ProviderUsage::default();
    for line in display
        .filter(|text| text.len() <= 16_384)
        .unwrap_or("")
        .lines()
        .take(64)
    {
        let line = line.trim().replace("**", "");
        if line.starts_with("Amp ") {
            subscription(&line, &mut usage).or_else(|| free(&line, &mut usage));
        }
        if let Some(balance) = line
            .strip_prefix("Individual credits:")
            .and_then(|value| value.split_once(" remaining"))
            .and_then(|(value, _)| dollars(value))
        {
            usage
                .amounts
                .extend(usd("Individual credits", Some(balance)));
        }
    }
    if !usage.metrics.is_empty() || !usage.amounts.is_empty() {
        usage.notice=Some("Read-only Amp balance RPC. Rounded renewal days and replenishment rates are not exact reset times.".into());
    }
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn parse(display: &str) -> Result<ProviderUsage, String> {
        super::super::map(
            "amp",
            &BTreeMap::from([("balance".into(), json!({"result":{"displayText":display}}))]),
        )
    }
    #[test]
    fn subscription_and_free_preserve_units_without_identity_or_invented_resets() {
        let usage=parse("Signed in as private@example.com\n**Amp Plus Subscription:** 81.5% other usage and 40% orb usage remaining - resets upon renewal in 3 days").unwrap();
        assert_eq!(usage.plan.as_deref(), Some("Plus"));
        assert_eq!(
            usage
                .metrics
                .iter()
                .map(|metric| metric.used_percent)
                .collect::<Vec<_>>(),
            vec![18.5, 60.0]
        );
        assert!(usage.metrics.iter().all(|metric| metric.reset_at.is_none()));
        assert!(!usage.notice.unwrap().contains("private@example.com"));
        let usage=parse("Amp Free: $0/$10 remaining (replenishes +$0.5/hour)\nIndividual credits: $2.25 remaining").unwrap();
        assert_eq!(usage.metrics[0].used_percent, 100.0);
        assert_eq!(
            usage
                .amounts
                .iter()
                .map(|amount| amount.value)
                .collect::<Vec<_>>(),
            vec![0.0, 2.25]
        );
        assert!(usage
            .amounts
            .iter()
            .all(|amount| amount.currency.as_deref() == Some("USD")));
        for invalid in [
            "Signed in as user",
            "Amp Free: $20/$10 remaining",
            "Amp Free: $NaN/$10 remaining",
            "Amp Plus Subscription: 101% other usage and 5% orb usage remaining",
        ] {
            assert!(parse(invalid).is_err(), "{invalid}");
        }
    }
}
