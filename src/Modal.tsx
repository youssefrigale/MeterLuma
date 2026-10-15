import { useEffect, useId, useRef } from 'react';
import { Icon } from './icons';

export function Modal({ title, children, onClose, dismissible = true }: { title: string; children: React.ReactNode; onClose: () => void; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const unmounting = useRef(false);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; unmounting.current = false; if (!dialog.open) dialog.showModal(); return () => { unmounting.current = true; dialog.close(); }; }, []);
  useEffect(() => {
    if (dismissible) return;
    // Chromium stops honouring cancel.preventDefault() on a repeated Escape, so block the key itself.
    const block = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => document.removeEventListener('keydown', block, true);
  }, [dismissible]);
  const outside = (event: React.MouseEvent) => { const box = ref.current!.getBoundingClientRect(); return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom; };
  return <dialog ref={ref} aria-labelledby={titleId} className="modal"
    onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
    onClose={() => {
      const dialog = ref.current;
      // Ignore closes we caused while unmounting, and stale events after a re-open.
      if (unmounting.current || !dialog || dialog.open) return;
      if (dismissible) onClose(); else if (dialog.isConnected) dialog.showModal();
    }}
    onPointerDown={event => { pressedBackdrop.current = event.target === ref.current && outside(event); }}
    onClick={event => { const backdrop = pressedBackdrop.current && event.target === ref.current && outside(event); pressedBackdrop.current = false; if (dismissible && backdrop) onClose(); }}>
    <div className="modal-title"><h2 id={titleId}>{title}</h2>{dismissible && <button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button>}</div>
    {children}
  </dialog>;
}
