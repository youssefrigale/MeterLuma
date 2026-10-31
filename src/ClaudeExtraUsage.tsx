import type { Provider } from './model';

function currencyAmount(amount: number | null, currency: string | null, precision: number | null) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !currency || !/^[A-Z]{3}$/.test(currency) || precision === null || !Number.isInteger(precision) || precision < 0 || precision > 6) return 'Unavailable';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: precision, maximumFractionDigits: precision }).format(amount);
}

export function ClaudeExtraUsage({ provider, now }: { provider: Provider; now: number }) {
  const extra = provider.claudeExtraUsage;
  if (!extra || provider.cached || provider.historyOnly || provider.fetchedAt === undefined || now < provider.fetchedAt || now - provider.fetchedAt > 300_000) return null;
  return <section className="quick-extra-usage" aria-label="Claude extra usage"><h3>Extra usage</h3><dl>
    <div><dt>Spent</dt><dd>{currencyAmount(extra.spent, extra.currency, extra.decimalPlaces)}</dd></div>
    <div><dt>Monthly limit</dt><dd>{extra.monthlyLimit === null ? 'Not reported' : currencyAmount(extra.monthlyLimit, extra.currency, extra.decimalPlaces)}</dd></div>
  </dl><p>Provider-reported account extra usage. Separate from token-value Costs.{extra.spent === null && ' Currency or unit information is unavailable; no amount has been inferred.'}</p></section>;
}
