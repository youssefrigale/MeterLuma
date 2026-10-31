import { additionalProvider } from './additional/model';

export type LookupCommand = 'refresh_provider' | 'read_usage_history' | 'refresh_additional_provider';
type Outcome = 'pending' | 'success' | 'timeout' | 'rate_limited' | 'sign_in_required' | 'unavailable';
interface LookupMeasurement { command: LookupCommand; provider: string; startedAt: number; durationMs: number | null; outcome: Outcome }
const measurements: LookupMeasurement[] = [];
export const LOOKUP_TIMEOUT = 'The usage lookup took too long. Try refreshing again.';

function outcome(reason: unknown): Outcome {
  if (reason === LOOKUP_TIMEOUT) return 'timeout';
  if (reason && typeof reason === 'object' && 'code' in reason && (reason.code === 'rate_limited' || reason.code === 'sign_in_required')) return reason.code;
  return 'unavailable';
}

function providerName(args: Record<string, unknown>) {
  const id = typeof args.providerId === 'string' ? args.providerId : '';
  return ['claude', 'codex', 'cursor'].includes(id) || additionalProvider(id) ? id : 'unknown';
}

export async function measuredLookup<T>(command: LookupCommand, args: Record<string, unknown>, read: () => Promise<T>): Promise<T> {
  const measurement: LookupMeasurement = { command, provider: providerName(args), startedAt: Date.now(), durationMs: null, outcome: 'pending' };
  measurements.push(measurement);
  if (measurements.length > 20) measurements.shift();
  const started = performance.now();
  try { const response = await read(); measurement.outcome = 'success'; return response; }
  catch (reason) { measurement.outcome = outcome(reason); throw reason; }
  finally { measurement.durationMs = Math.max(0, Math.round(performance.now() - started)); }
}

export const recentLookupDiagnostics = () => measurements.map(measurement => ({ ...measurement }));
export const clearLookupDiagnostics = () => { measurements.length = 0; };
