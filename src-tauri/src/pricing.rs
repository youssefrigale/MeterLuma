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

// OpenAI Standard API rates, checked 2026-10-26: https://developers.openai.com/api/docs/pricing
// Codex logs include cache hits in input and reasoning in output. Neither is counted twice.
// This values recorded tokens at Standard rates; subscription credits, speed tiers and cache-write fees are excluded.
pub fn codex_value(model: &str, input: u64, output: u64, reads: u64) -> Option<f64> {
    let model = model.trim().to_ascii_lowercase();
    let (base, out, hit, long_context) = match openai_model(&model) {
        "gpt-6-astra" => (10.0, 50.0, 1.0, true),
        "gpt-6.1-sol" => (2.0, 10.0, 0.10, true),
        "gpt-6.1-terra" => (1.0, 5.0, 0.05, true),
        "gpt-6-sol" => (2.0, 10.0, 0.20, true),
        "gpt-6-luna" => (0.10, 0.50, 0.01, true),
        "gpt-5.6-sol" => (4.0, 20.0, 0.40, true),
        "gpt-5.6-terra" => (2.0, 12.0, 0.20, true),
        "gpt-5.6-luna" => (0.20, 1.20, 0.02, true),
        "gpt-5.5" => (5.0, 30.0, 0.50, true),
        "gpt-5.4" => (2.50, 15.0, 0.25, true),
        "gpt-5.4-mini" => (0.75, 4.50, 0.075, false),
        "gpt-5.4-nano" => (0.20, 1.25, 0.02, false),
        "gpt-5.3-codex" | "gpt-5.2" => (1.75, 14.0, 0.175, false),
        "gpt-5.1" | "gpt-5" => (1.25, 10.0, 0.125, false),
        _ => return None,
    };
    let uncached = input.checked_sub(reads)?;
    let (input_tier, output_tier) = if long_context && input > 272_000 { (2.0, 1.5) } else { (1.0, 1.0) };
    Some(((uncached as f64 * base + reads as f64 * hit) * input_tier + output as f64 * out * output_tier) / 1_000_000.0)
}

fn openai_model(model: &str) -> &str {
    // Strip only a valid dated snapshot suffix; unknown variants must never inherit a model's price.
    let Some(suffix) = model.get(model.len().saturating_sub(11)..) else { return model; };
    if suffix.starts_with('-') && chrono::NaiveDate::parse_from_str(&suffix[1..], "%Y-%m-%d").is_ok() {
        model.get(..model.len() - 11).unwrap_or(model)
    } else { model }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_values_fresh_cached_and_output_tokens_once_at_each_model_rate() {
        for (model, expected) in [("gpt-6.1-sol", 0.31), ("gpt-6-sol", 0.32), ("gpt-6-astra", 1.6), ("gpt-6.1-terra", 0.155), ("gpt-6-luna", 0.016), ("gpt-5.6-sol", 0.64), ("gpt-5.6-terra", 0.34), ("gpt-5.6-luna", 0.034), ("gpt-5.3-codex", 0.3325)] {
            assert!((codex_value(model, 200_000, 10_000, 100_000).unwrap() - expected).abs() < 0.000001, "{model}");
        }
        assert_eq!(codex_value("gpt-6.1-sol-2026-09-30", 200_000, 10_000, 100_000), codex_value("gpt-6.1-sol", 200_000, 10_000, 100_000));
        assert_eq!(codex_value("gpt-6.1-sol", 0, 0, 0), Some(0.0));
        for model in ["gpt-6.1-sol-preview", "gpt-6.1-sol-2026-99-30", "gpt-99", "Unknown model", "claude-opus-5-5", ""] {
            assert_eq!(codex_value(model, 100, 10, 0), None, "{model}");
        }
        assert_eq!(codex_value("gpt-6.1-sol", 1, 0, 2), None);
    }
    #[test]
    fn codex_long_context_tiers_apply_per_request_above_272k_inputs_including_cache() {
        for (input, expected) in [(271_999, 0.0371999), (272_000, 0.0372), (272_001, 0.0694002)] {
            assert!((codex_value("gpt-6.1-sol", input, 1_000, input).unwrap() - expected).abs() < 0.00000001);
        }
        assert!((codex_value("gpt-6-astra", 300_000, 10_000, 100_000).unwrap() - 4.95).abs() < 0.000001);
    }
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
