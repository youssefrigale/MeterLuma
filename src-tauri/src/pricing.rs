// Standard global Claude API token prices, USD / million tokens, checked 2026-10-15.
// https://platform.claude.com/docs/en/about-claude/pricing
// This is a current-rate token-value estimate, not subscription billing. Unknown
// models remain unpriced. Tool fees, historical prices and account discounts are excluded.
pub fn claude_value(model: &str, input: u64, output: u64, reads: u64, writes: u64, hour_writes: u64) -> Option<f64> {
    let model = match model.rsplit_once('-') {
        Some((base, date)) if date.len() == 8 && date.bytes().all(|byte| byte.is_ascii_digit()) => base,
        _ => model,
    };
    let (base, out, hit) = match model {
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
    let uncached = input.checked_sub(reads.checked_add(writes)?)?;
    let short_writes = writes.checked_sub(hour_writes)?;
    Some((uncached as f64 * base + output as f64 * out + reads as f64 * hit + short_writes as f64 * base * 1.25 + hour_writes as f64 * base * 2.0) / 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn values_cache_categories_once_and_supports_dated_ids() {
        // 1M fresh + 2M hits + 3M five-minute writes + 4M hour writes + 1M output.
        let value = claude_value("claude-sonnet-4-5-20250929", 10_000_000, 1_000_000, 2_000_000, 7_000_000, 4_000_000).unwrap();
        assert!((value - 53.85).abs() < 0.000001);
        assert_eq!(claude_value("claude-sonnet-99", 1, 1, 0, 0, 0), None);
        assert_eq!(claude_value("claude-sonnet-4-5", 1, 1, 2, 0, 0), None);
    }
    #[test]
    fn haiku_long_prompt_tier_is_per_request_and_new_cache_rates_are_preserved() {
        assert!((claude_value("claude-haiku-5-5", 100_000, 0, 0, 0, 0).unwrap() - 0.01).abs() < 0.000001);
        assert!((claude_value("claude-haiku-5-5", 100_001, 0, 0, 0, 0).unwrap() - 0.0500005).abs() < 0.000001);
        assert!((claude_value("claude-opus-5-5", 1_000_000, 0, 1_000_000, 0, 0).unwrap() - 0.2).abs() < 0.000001);
    }
}
