export type QuotaState = 'live' | 'rate_limited' | 'sign_in_required' | 'unavailable';
export interface QuotaFailure { code: Exclude<QuotaState, 'live'>; message: string; retryAt?: number; lastSnapshot?: import('./model').Provider }

export function quotaFailure(reason: unknown): QuotaFailure {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    const value = reason as { code?: string; message: string; retryAt?: unknown; lastSnapshot?: import('./model').Provider };
    const code = value.code === 'rate_limited' || value.code === 'sign_in_required' ? value.code : 'unavailable';
    return { code, message: value.message, ...(value.lastSnapshot && Array.isArray(value.lastSnapshot.metrics) ? { lastSnapshot: value.lastSnapshot } : {}), ...(typeof value.retryAt === 'number' && Number.isFinite(value.retryAt) ? { retryAt: value.retryAt } : {}) };
  }
  const message = typeof reason === 'string' ? reason : 'Usage limits could not be read.';
  const code = /limiting requests|rate.limit/i.test(message) ? 'rate_limited' : /sign.in|subscription|API.key/i.test(message) ? 'sign_in_required' : 'unavailable';
  return { code, message };
}

export function retryCountdown(retryAt: number, now: number) {
  const minutes = Math.max(1, Math.ceil((retryAt - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
