import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { moveProvider } from './providerOrder';

type Drag = { id: string; target: string; x: number; y: number; pointerId: number; startX: number; startY: number; moved: boolean };

export function useProviderReorder(ids: readonly string[], save: (ids: string[]) => boolean) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState<Pick<Drag, 'id' | 'target'> | null>(null);
  const [announcement, setAnnouncement] = useState('');
  function cancel() { drag.current = null; setActive(null); }
  function targetAt(x: number, y: number) {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-id]');
    return row && list.current?.contains(row) ? row.dataset.reorderId : undefined;
  }
  function track() {
    const current = drag.current; if (!current?.moved) return;
    const target = targetAt(current.x, current.y);
    if (target && target !== current.target) { current.target = target; setActive({ id: current.id, target }); }
  }
  function commit(source: string, target: string, label: string) {
    if (source === target) return;
    const next = moveProvider(ids, source, target);
    if (save(next)) setAnnouncement(`${label} moved to position ${next.indexOf(source) + 1} of ${next.length}.`);
    else setAnnouncement('The provider order could not be saved.');
  }
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const scroll = list.current!.closest<HTMLElement>('.quick-scroll')!;
    function tick() {
      const current = drag.current; if (!current) return;
      const bounds = scroll.getBoundingClientRect();
      const shift = current.moved && current.x >= bounds.left && current.x <= bounds.right ? current.y < bounds.top + 35 ? -10 : current.y > bounds.bottom - 35 ? 10 : 0 : 0;
      if (shift) { scroll.scrollTop += shift; track(); }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!active]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); drag.current = null; };
  }, []);
  function handleProps(id: string, label: string): ButtonHTMLAttributes<HTMLButtonElement> {
    return {
      type: 'button', 'aria-label': `Reorder ${label}`, 'aria-keyshortcuts': 'ArrowUp ArrowDown', title: 'Drag to reorder, or focus and use Up / Down arrow keys',
      onPointerDown: event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, target: id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }; setActive({ id, target: id }); },
      onPointerMove: event => { if (drag.current?.pointerId !== event.pointerId) return; drag.current.x = event.clientX; drag.current.y = event.clientY; drag.current.moved ||= Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY) >= 4; track(); },
      onPointerUp: event => { if (drag.current?.pointerId !== event.pointerId) return; const target = drag.current.moved ? targetAt(event.clientX, event.clientY) : undefined; cancel(); if (target) commit(id, target, label); },
      onPointerCancel: cancel,
      onKeyDown: event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const index = ids.indexOf(id); const target = ids[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) { const handle = event.currentTarget; commit(id, target, label); requestAnimationFrame(() => { if (handle.isConnected) handle.focus(); }); }
      },
    };
  }
  function rowProps(id: string) {
    return { 'data-reorder-id': id, 'data-dragging': active?.id === id || undefined, 'data-drop': active?.target === id && active.id !== id ? ids.indexOf(active.id) < ids.indexOf(id) ? 'after' : 'before' : undefined };
  }
  return { list, handleProps, rowProps, announcement };
}
