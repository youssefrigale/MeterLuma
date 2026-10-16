// Official provider logos, unmodified from each owner's brand resources (see assets/providers/README.md).
// Codex and Cursor ship separate files for light and dark backgrounds; styles.css shows the one that matches the theme.
import claude from './assets/providers/claude.svg';
import codexOnLight from './assets/providers/codex-on-light.svg';
import codexOnDark from './assets/providers/codex-on-dark.svg';
import cursorOnLight from './assets/providers/cursor-on-light.svg';
import cursorOnDark from './assets/providers/cursor-on-dark.svg';
import type { ProviderId } from './model';

const logos: Record<ProviderId, { light: string; dark?: string }> = {
  claude: { light: claude },
  codex: { light: codexOnLight, dark: codexOnDark },
  cursor: { light: cursorOnLight, dark: cursorOnDark },
};

export function ProviderLogo({ id, size }: { id: ProviderId; size?: number }) {
  const { light, dark } = logos[id];
  const style = size ? { width: size, height: size } : undefined;
  const image = (src: string, variant?: 'light' | 'dark') => <img className="provider-brand" data-provider={id} data-variant={variant} src={src} alt="" aria-hidden="true" draggable={false} style={style}/>;
  return dark ? <>{image(light, 'light')}{image(dark, 'dark')}</> : image(light);
}
