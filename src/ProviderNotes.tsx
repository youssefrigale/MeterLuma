import { CURSOR_UNOFFICIAL, NOT_AFFILIATED } from './format';

export function UnofficialBadge() {
  return <span className="unofficial-badge" title={CURSOR_UNOFFICIAL}>Unofficial</span>;
}
export function UnofficialNote({ className = '' }: { className?: string }) {
  return <p className={`unofficial-note ${className}`}><UnofficialBadge/> {CURSOR_UNOFFICIAL}</p>;
}
export function NotAffiliated({ className = '' }: { className?: string }) {
  return <p className={`not-affiliated ${className}`}>{NOT_AFFILIATED}</p>;
}
