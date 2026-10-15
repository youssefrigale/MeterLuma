// Standard global Claude API token prices, USD / million tokens, checked 2026-10-15.
// https://platform.claude.com/docs/en/about-claude/pricing
// This is a current-rate token-value estimate, not subscription billing. Unknown models stay
// unpriced and are reported as unpriced tokens. Tool fees, historical prices, account discounts,
// Bedrock/Vertex partner pricing and the inference_geo / regional-endpoint premiums are excluded.

/// Maps provider and gateway id forms onto the table's ids, for example
/// `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, `anthropic.claude-opus-5-5`, `claude-opus-4-5@20251101`,
/// `claude-sonnet-4-5-20250929[1m]`, `claude-3-5-haiku-latest` and `anthropic/claude-sonnet-4.5`.
pub fn normalized(model: &str) -> String {
    let model = model.trim().to_ascii_lowercase();
    let model = model.rsplit('/').next().unwrap_or_default();
    let model = model.rsplit_once("anthropic.").map_or(model, |(_, id)| id);
    let model = model.split([':', '@', '[']).next().unwrap_or_default().replace('.', "-");
    let model = model.strip_suffix("-latest").unwrap_or(&model);
    let model = match model.rsplit_once("-v") { Some((base, version)) if !version.is_empty() && version.bytes().all(|byte| byte.is_ascii_digit()) => base, _ => model };
    let model = match model.rsplit_once('-') { Some((base, date)) if date.len() == 8 && date.bytes().all(|byte| byte.is_ascii_digit()) => base, _ => model };
    match model { "claude-opus-4-0" => "claude-opus-4", "claude-sonnet-4-0" => "claude-sonnet-4", model => model }.to_string()
}

pub fn claude_value(model: &str, input: u64, output: u64, reads: u64, writes: u64, hour_writes: u64, fast: bool) -> Option<f64> {
    let model = normalized(model);
    let (base, out, hit) = match model.as_str() {
        "claude-opus-5-5" => (4.0, 20.0, 0.20),
        "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-opus-4-6" | "claude-opus-4-5" => (5.0, 25.0, 0.50),
        "claude-opus-4-1" | "claude-opus-4" => (15.0, 75.0, 1.50),
        "claude-sonnet-5-5" => (2.0, 10.0, 0.10),
        "claude-sonnet-5" => (2.0, 10.0, 0.20),
        "claude-sonnet-4-6" | "claude-sonnet-4-5" | "claude-sonnet-4" => (3.0, 15.0, 0.30),
        "claude-haiku-5-5" if input > 100_000 => (0.50, 2.50, 0.05),
        "claude-haiku-5-5" => (0.10, 0.50, 0.01),
        "claude-haiku-4-5" => (1.0, 5.0, 0.10),
        "claude-3-5-haiku" => (0.80, 4.0, 0.08),
        "claude-fable-5-1" | "claude-mythos-5-1" => (10.0, 50.0, 0.25),
        "claude-fable-5" | "claude-mythos-5" => (10.0, 50.0, 1.0),
        _ => return None,
    };
    // Fast mode (usage.speed "fast") doubles every rate on the models that offer it; cache multipliers stack on top.
    let speed = match (fast, model.as_str()) { (false, _) => 1.0, (true, "claude-opus-5-5" | "claude-opus-5" | "claude-opus-4-8") => 2.0, _ => return None };
    let uncached = input.checked_sub(reads.checked_add(writes)?)?;
    let short_writes = writes.checked_sub(hour_writes)?;
    Some((uncached as f64 * base + output as f64 * out + reads as f64 * hit + short_writes as f64 * base * 1.25 + hour_writes as f64 * base * 2.0) * speed / 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn values_cache_categories_once_and_supports_dated_ids() {
        // 1M fresh + 2M hits + 3M five-minute writes + 4M hour writes + 1M output.
        let value = claude_value("claude-sonnet-4-5-20250929", 10_000_000, 1_000_000, 2_000_000, 7_000_000, 4_000_000, false).unwrap();
        assert!((value - 53.85).abs() < 0.000001);
        assert_eq!(claude_value("claude-sonnet-99", 1, 1, 0, 0, 0, false), None);
        assert_eq!(claude_value("claude-sonnet-4-5", 1, 1, 2, 0, 0, false), None);
    }
    #[test]
    fn haiku_long_prompt_tier_is_per_request_and_new_cache_rates_are_preserved() {
        assert!((claude_value("claude-haiku-5-5", 100_000, 0, 0, 0, 0, false).unwrap() - 0.01).abs() < 0.000001);
        assert!((claude_value("claude-haiku-5-5", 100_001, 0, 0, 0, 0, false).unwrap() - 0.0500005).abs() < 0.000001);
        assert!((claude_value("claude-opus-5-5", 1_000_000, 0, 1_000_000, 0, 0, false).unwrap() - 0.2).abs() < 0.000001);
        assert!((claude_value("claude-sonnet-5-5", 1_000_000, 0, 1_000_000, 0, 0, false).unwrap() - 0.1).abs() < 0.000001);
    }
    #[test]
    fn bedrock_vertex_and_gateway_ids_price_like_first_party_ids() {
        for id in ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "anthropic.claude-sonnet-4-5-20250929-v1:0", "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "global.anthropic.claude-sonnet-4-5-20250929-v1:0", "arn:aws:bedrock:us-east-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "claude-sonnet-4-5@20250929", "publishers/anthropic/models/claude-sonnet-4-5@20250929", "claude-sonnet-4-5[1m]", "claude-sonnet-4-5-20250929[1m]",
            "anthropic/claude-sonnet-4.5", " Claude-Sonnet-4-5 "] {
            assert_eq!(normalized(id), "claude-sonnet-4-5", "{id}");
        }
        assert_eq!(normalized("anthropic.claude-opus-5-5"), "claude-opus-5-5");
        assert_eq!(normalized("anthropic.claude-opus-4-6-v1"), "claude-opus-4-6");
        assert_eq!(normalized("claude-opus-4-5@20251101"), "claude-opus-4-5");
        assert_eq!(normalized("claude-3-5-haiku-latest"), "claude-3-5-haiku");
        assert_eq!(normalized("apac.anthropic.claude-3-5-haiku-20241022-v1:0"), "claude-3-5-haiku");
        assert_eq!(normalized("claude-sonnet-4-0"), "claude-sonnet-4");
        assert_eq!(claude_value("us.anthropic.claude-opus-5-5-v1:0", 1_000_000, 0, 0, 0, 0, false), Some(4.0));
        // Codex/OpenAI and opaque ids stay unpriced instead of borrowing a Claude rate.
        for id in ["gpt-5-codex", "gpt-5.1-codex-max", "Unknown model", "arn:aws:bedrock:us-east-1:1:application-inference-profile/a1b2c3", "sonnet", ""] {
            assert_eq!(claude_value(id, 1, 1, 0, 0, 0, false), None, "{id}");
        }
    }
    #[test]
    fn fast_mode_doubles_supported_opus_rates_only() {
        assert!((claude_value("claude-opus-5-5", 1_000_000, 1_000_000, 0, 0, 0, true).unwrap() - 48.0).abs() < 0.000001);
        assert!((claude_value("claude-opus-4-8", 0, 1_000_000, 0, 0, 0, true).unwrap() - 50.0).abs() < 0.000001);
        assert_eq!(claude_value("claude-sonnet-5-5", 1, 1, 0, 0, 0, true), None);
    }
}
