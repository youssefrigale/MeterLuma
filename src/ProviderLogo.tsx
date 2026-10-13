import claude from './assets/providers/claude.svg';
import codex from './assets/providers/codex.svg';
import cursor from './assets/providers/cursor.svg';
import type { ProviderId } from './model';

const logos = { claude, codex, cursor };

export function ProviderLogo({ id, size = 26 }: { id: ProviderId; size?: number }) {
  return <img className="provider-brand" data-provider={id} src={logos[id]} alt="" aria-hidden="true" width={size} height={size}/>;
}
