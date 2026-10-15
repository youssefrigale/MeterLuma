import type { CSSProperties } from 'react';
import {
  RiLayoutGridLine, RiLayoutGridFill, RiBarChart2Line, RiBarChart2Fill, RiLinksLine, RiLinksFill,
  RiSettings3Line, RiSettings3Fill, RiArrowRightLine, RiRefreshLine,
  RiSunLine, RiMoonClearLine, RiComputerLine, RiTimeLine, RiCheckLine,
  RiCloseLine, RiArrowRightSLine, RiSparkling2Line, RiDownload2Line,
  RiInformationLine, RiInformationFill, RiEyeLine, RiExternalLinkLine,
  RiArrowUpSLine, RiArrowDownSLine, RiLogoutBoxRLine,
} from '@remixicon/react';

const icons = {
  grid: RiLayoutGridLine,
  activity: RiBarChart2Line,
  link: RiLinksLine,
  settings: RiSettings3Line,
  arrow: RiArrowRightLine,
  refresh: RiRefreshLine,
  sun: RiSunLine,
  moon: RiMoonClearLine,
  monitor: RiComputerLine,
  clock: RiTimeLine,
  check: RiCheckLine,
  close: RiCloseLine,
  chevron: RiArrowRightSLine,
  spark: RiSparkling2Line,
  download: RiDownload2Line,
  info: RiInformationLine,
  eye: RiEyeLine,
  external: RiExternalLinkLine,
  up: RiArrowUpSLine,
  down: RiArrowDownSLine,
  quit: RiLogoutBoxRLine,
};
export type IconName = keyof typeof icons;
const selectedIcons: Partial<typeof icons> = { grid: RiLayoutGridFill, activity: RiBarChart2Fill, link: RiLinksFill, settings: RiSettings3Fill, info: RiInformationFill };

export function Icon({ name, size = 18, style, selected = false }: { name: IconName; size?: number; style?: CSSProperties; selected?: boolean }) {
  const Glyph = selected && selectedIcons[name] || icons[name];
  return <Glyph size={size} className="ui-icon" aria-hidden="true" focusable="false" style={style}/>;
}

export function Mark({ size = 34 }: { size?: number }) {
  return <img className="app-mark" src="/mark.svg" width={size} height={size} alt="" aria-hidden="true"/>;
}
