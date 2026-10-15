import { useEffect, useId, useRef } from 'react';
import { Icon } from './icons';

export function Modal({ title, children, onClose, dismissible = true }: { title: string; children: React.ReactNode; onClose: () => void; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="modal" onCancel={event => { if (!dismissible) event.preventDefault(); else onClose(); }} onClick={event => { if (dismissible && event.target === ref.current) onClose(); }}>
    <div className="modal-title"><h2 id={titleId}>{title}</h2>{dismissible && <button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button>}</div>
    {children}
  </dialog>;
}
