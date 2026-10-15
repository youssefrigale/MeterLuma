// Original neutral MeterLuma glyphs (see assets/providers/README.md). Inlined so they inherit the theme's text color.
import claude from './assets/providers/claude.svg?raw';
import codex from './assets/providers/codex.svg?raw';
import cursor from './assets/providers/cursor.svg?raw';
import type { ProviderId } from './model';

const glyphs = { claude, codex, cursor };

export function ProviderLogo({ id, size }: { id: ProviderId; size?: number }) {
  return <span className="provider-brand" data-provider={id} aria-hidden="true" style={size ? { width: size, height: size } : undefined} dangerouslySetInnerHTML={{ __html: glyphs[id] }}/>;
}
