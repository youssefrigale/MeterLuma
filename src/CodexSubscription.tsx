import type { Provider, Settings } from './model';
import { formatDateTime, planLabel } from './format';

export function CodexSubscription({ provider, settings }: { provider: Provider; settings: Settings }) {
  const account = provider.codexAccount;
  const credits = account?.credits;
  const balance = credits?.unlimited === true ? 'Unlimited' : typeof credits?.balance === 'number' && Number.isFinite(credits.balance) && credits.balance >= 0
    ? `${credits.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`
    : credits?.hasCredits === false ? 'No credits available' : credits?.hasCredits === true ? 'Available · balance unknown' : 'Unavailable';
  const resets = account?.availableResets;
  const usage = account?.includedUsageAllowed;
  const rows = <dl>
      <div><dt>Included usage</dt><dd>{usage === true ? 'Available' : usage === false ? 'Not available' : 'Unavailable'}</dd></div>
      <div><dt>Rate-limit resets</dt><dd>{typeof resets === 'number' && Number.isSafeInteger(resets) && resets >= 0 ? `${resets.toLocaleString()} available` : 'Unavailable'}</dd></div>
      <div><dt>Credits</dt><dd>{balance}</dd></div>
    </dl>;
  const hasDetails = credits != null || resets != null || usage != null;
  return <section className={`quick-subscription${hasDetails ? '' : ' quick-subscription-compact'}`} aria-label={provider.cached ? 'Cached Codex subscription details' : 'Codex subscription details'}>
    {hasDetails && rows}
    <details><summary>{provider.cached ? 'Cached subscription details' : 'Subscription details'}{!hasDetails && ' · unavailable'}</summary>{!hasDetails && rows}<dl>
      <div><dt>Plan</dt><dd>{provider.plan === 'Local history' ? 'Unavailable' : planLabel(provider)}</dd></div>
      <div><dt>Connection</dt><dd>{provider.tokenOnly ? 'Account token' : 'Local Codex sign-in'}</dd></div>
      {typeof provider.fetchedAt === 'number' && <div><dt>{provider.cached ? 'Cached at' : 'Updated'}</dt><dd>{formatDateTime(provider.fetchedAt, settings.timeFormat)}</dd></div>}
    </dl><p>Included usage, credits and resets come from Codex. Billing charges and renewal dates are not provided. Token history below covers this device.</p></details>
  </section>;
}
