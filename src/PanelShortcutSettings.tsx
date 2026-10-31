import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { usePanelShortcut } from './usePanelShortcut';

export function PanelShortcutSettings({ shortcut }: { shortcut: ReturnType<typeof usePanelShortcut> }) {
  const [modifier, setModifier] = useState(shortcut.active?.split('+')[1] ?? 'Shift');
  const [letter, setLetter] = useState(shortcut.active?.split('+')[2] ?? 'M');
  const candidate = `CommandOrControl+${modifier}+${letter}`;
  return <section><h2>Keyboard shortcut</h2><p>Open MeterLuma from any app. Uses Command on Mac and Ctrl on Windows. Starts off; occupied combinations stay with the other app.</p>
    <form className="feature-form panel-shortcut-form" onSubmit={event => { event.preventDefault(); void shortcut.apply(candidate); }}>
      <label>Modifiers<select aria-label="Shortcut modifiers" value={modifier} onChange={event => setModifier(event.target.value)}><option value="Shift">Command / Ctrl + Shift</option><option value="Alt">Command / Ctrl + Alt</option></select></label>
      <label>Letter<input aria-label="Shortcut letter" value={letter} maxLength={1} onChange={event => setLetter(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}/></label>
      <button className="button" disabled={!isTauri() || shortcut.busy || !/^[A-Z]$/.test(letter) || candidate === shortcut.active}>Apply shortcut</button>
      {shortcut.active && <button className="button" type="button" disabled={shortcut.busy} onClick={() => void shortcut.apply(null)}>Remove shortcut</button>}
    </form><p role="status">{shortcut.error || (shortcut.active ? `Active: ${shortcut.active.replace('CommandOrControl', 'Command / Ctrl')}` : 'No keyboard shortcut is active.')}</p>
  </section>;
}
