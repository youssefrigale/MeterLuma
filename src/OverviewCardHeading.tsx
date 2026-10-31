import type { ReactNode } from 'react';
import { Icon } from './icons';

export interface CardFold { collapsed: boolean; toggle: () => void }

export function OverviewCardHeading({ title, label, secondary, fold }: { title: string; label: string; secondary?: ReactNode; fold?: CardFold }) {
  return <div className="quick-provider-heading"><h2 aria-label={title}>{fold ? <button className="quick-provider-toggle" aria-label={`${fold.collapsed ? 'Expand' : 'Collapse'} ${label} overview card`} aria-expanded={!fold.collapsed} onClick={fold.toggle} title={fold.collapsed ? 'Show full card' : 'Keep meters in compact rows'}><Icon name="chevron" size={14}/><span title={title}>{title}</span></button> : title}</h2>{secondary}</div>;
}
