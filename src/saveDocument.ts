import { invoke, isTauri } from '@tauri-apps/api/core';

export async function saveDocument(kind: 'preferences' | 'diagnostics', content: string) {
  if (isTauri()) return invoke<boolean>('save_support_export', { kind, content });
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `MeterLuma-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
