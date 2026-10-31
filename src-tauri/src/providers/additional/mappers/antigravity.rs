use super::*;
const BUCKETS: &[(&str, &str)] = &[
    ("gemini-5h", "Session"),
    ("gemini-weekly", "Weekly"),
    ("3p-5h", "Claude session"),
    ("3p-weekly", "Claude weekly"),
];
fn bucket(label: &str, raw: &Value) -> Option<Metric> {
    if raw
        .get("disabled")
        .is_some_and(|value| !value.is_boolean() || value == true)
    {
        return None;
    }
    let fraction = count(&raw["remainingFraction"]).filter(|value| *value <= 1.0)?;
    quota(
        label,
        Some((1.0 - fraction) * 100.0),
        Some(100.0),
        time(&raw["resetTime"]),
    )
}
pub(super) fn map(responses: &Responses) -> ProviderUsage {
    let root = response(responses, "summary");
    let groups = root["response"]["groups"]
        .as_array()
        .or_else(|| root["groups"].as_array());
    let mut pools = BTreeMap::new();
    let mut usage = ProviderUsage::default();
    for group in groups.into_iter().flatten().take(32) {
        let buckets = group["buckets"].as_array();
        if group["displayName"] == "Gemini 4 Argon" {
            let weekly: Vec<_> = buckets
                .into_iter()
                .flatten()
                .filter(|entry| entry["window"] == "weekly")
                .take(2)
                .collect();
            if weekly.len() == 1
                && matches!(
                    weekly[0]["bucketId"].as_str(),
                    Some("gemini-argon-wtu-weekly" | "gemini-argon-weekly")
                )
            {
                if let Some(metric) = bucket("Argon weekly", weekly[0]) {
                    pools.entry(metric.label.clone()).or_insert(metric);
                }
            }
            continue;
        }
        for raw in buckets.into_iter().flatten().take(32) {
            let Some((_, label)) = BUCKETS.iter().find(|(id, _)| raw["bucketId"] == *id) else {
                continue;
            };
            if let Some(metric) = bucket(label, raw) {
                pools.entry(label.to_string()).or_insert(metric);
            } else {
                usage.warning = true;
            }
        }
    }
    for label in [
        "Session",
        "Weekly",
        "Argon weekly",
        "Claude session",
        "Claude weekly",
    ] {
        if let Some(metric) = pools.remove(label) {
            usage.metrics.push(metric);
        }
    }
    usage.warning |= BUCKETS
        .iter()
        .any(|(_, label)| !usage.metrics.iter().any(|metric| metric.label == *label));
    usage.notice=Some("Antigravity production Cloud Code quota summary using a supplied OAuth access token. Missing pools remain unavailable. Argon stays separate; no dummy model fallback, local port discovery or OAuth renewal. The plan is not inferred.".into());
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn argon_stays_separate_and_partial_summaries_never_invent_full_or_exhausted_pools() {
        let root = json!({"response":{"groups":[{"buckets":[{"bucketId":"gemini-5h","remainingFraction":0.75},{"bucketId":"gemini-weekly"},{"bucketId":"3p-5h","remainingFraction":0}]},{"displayName":"Gemini 4 Argon","buckets":[{"bucketId":"gemini-argon-wtu-weekly","window":"weekly","remainingFraction":0.5}]}]}});
        let usage =
            super::super::map("antigravity", &BTreeMap::from([("summary".into(), root)])).unwrap();
        assert_eq!(
            usage
                .metrics
                .iter()
                .map(|metric| (metric.label.as_str(), metric.used_percent))
                .collect::<Vec<_>>(),
            vec![
                ("Session", 25.0),
                ("Argon weekly", 50.0),
                ("Claude session", 100.0)
            ]
        );
        assert!(usage.warning);
        assert!(usage.plan.is_none());
        assert!(super::super::map(
            "antigravity",
            &BTreeMap::from([("summary".into(), json!({"groups":[]}))])
        )
        .is_err());
    }
}
