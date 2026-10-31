import { useEffect, useRef, type RefObject } from 'react';

export function useUsageResume({ enabled, intervalMs, nextRefreshAt, lastStarted, pending, refresh }: { enabled: boolean; intervalMs: number; nextRefreshAt: number | null; lastStarted: RefObject<number | null>; pending: RefObject<boolean>; refresh: () => void }) {
  const latestRefresh = useRef(refresh); latestRefresh.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const resume = () => {
      if (document.visibilityState === 'hidden' || pending.current || lastStarted.current === null) return;
      const now = Date.now(); const elapsed = now - lastStarted.current;
      const missedDeadline = nextRefreshAt !== null && nextRefreshAt > lastStarted.current && now >= nextRefreshAt;
      if (elapsed < 0 || elapsed >= intervalMs || missedDeadline) {
        lastStarted.current = now; latestRefresh.current();
      }
    };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [enabled, intervalMs, nextRefreshAt, lastStarted, pending]);
}
