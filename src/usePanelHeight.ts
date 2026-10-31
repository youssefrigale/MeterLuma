import { useEffect, type RefObject } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

const SETTINGS_PANEL_HEIGHT = 850;

function verticalInsets(style: CSSStyleDeclaration) {
  return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
}

function railItemHeight(child: Element) {
  if (!child.classList.contains('quick-rail-providers')) return child.getBoundingClientRect().height;
  // A scrollable list must not turn the current viewport height into the popup's minimum height.
  const buttons = Array.from(child.children).slice(0, 3);
  return buttons.reduce((height, button) => height + button.getBoundingClientRect().height, 0)
    + Math.max(0, buttons.length - 1) * (parseFloat(getComputedStyle(child).rowGap) || 0);
}

function preferredHeight(panel: HTMLElement) {
  if (panel.querySelector('.quick-settings')) return SETTINGS_PANEL_HEIGHT;
  const scroll = panel.querySelector<HTMLElement>('.quick-scroll')!;
  const content = panel.querySelector<HTMLElement>('.quick-content')!;
  const footer = panel.querySelector<HTMLElement>('.quick-footer')!;
  const rail = panel.querySelector<HTMLElement>('.quick-rail')!;
  const railStyle = getComputedStyle(rail);
  const railHeight = Array.from(rail.children).reduce((height, child) => height + railItemHeight(child), 0)
    + verticalInsets(railStyle) + Math.max(0, rail.children.length - 1) * (parseFloat(railStyle.rowGap) || 0);
  const bodyHeight = content.getBoundingClientRect().height + verticalInsets(getComputedStyle(scroll)) + footer.getBoundingClientRect().height;
  return Math.ceil(Math.min(4096, Math.max(300, railHeight, bodyHeight) + verticalInsets(getComputedStyle(panel))));
}

export function usePanelHeight(panel: RefObject<HTMLElement | null>, onError: (message: string) => void) {
  useEffect(() => {
    if (!isTauri()) return;
    if (!document.documentElement.classList.contains('native-macos')) {
      void invoke('resize_quick').catch(() => onError('The panel could not be resized.'));
      return;
    }
    const root = panel.current!;
    let active = true;
    let frame = 0;
    let requested = 0;
    let pending = Promise.resolve();
    const measure = () => {
      frame = 0;
      const height = preferredHeight(root);
      if (height === requested) return;
      requested = height;
      // Serialize native resizes so a slower old request cannot restore a previous page's height.
      pending = pending.then(async () => { if (active && height === requested) await invoke('resize_quick', { height }); })
        .catch(() => { if (active) onError('The panel could not be resized.'); });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const sizes = new ResizeObserver(schedule);
    for (const selector of ['.quick-content', '.quick-footer', '.quick-rail']) sizes.observe(root.querySelector(selector)!);
    const navigation = new MutationObserver(schedule);
    navigation.observe(root.querySelector('.quick-rail')!, { childList: true, subtree: true });
    window.addEventListener('focus', schedule);
    measure();
    return () => { active = false; cancelAnimationFrame(frame); sizes.disconnect(); navigation.disconnect(); window.removeEventListener('focus', schedule); };
  }, [panel, onError]);
}
