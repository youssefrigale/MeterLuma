import { invoke } from '@tauri-apps/api/core';
import { LOOKUP_TIMEOUT, measuredLookup, type LookupCommand } from './lookupDiagnostics';

export async function nativeLookup<T>(command: LookupCommand, args: Record<string, unknown>): Promise<T> {
  let timer = 0;
  const limit = command === 'read_usage_history' ? 90_000 : command.includes('additional') ? 120_000 : 75_000;
  try {
    return await measuredLookup(command, args, () => Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(LOOKUP_TIMEOUT), limit); }),
    ]));
  } finally { window.clearTimeout(timer); }
}
