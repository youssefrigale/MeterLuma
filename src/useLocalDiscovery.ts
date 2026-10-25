import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { LEGAL_VERSION } from './legal';
import type { ProviderId, Settings } from './model';

// Discovery returns provider names only. Credentials remain in the native process.
export function useLocalDiscovery(settings: Settings, update: (value: Partial<Settings>) => void) {
  const [request, setRequest] = useState(0);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const latestUpdate = useRef(update);
  latestUpdate.current = update;
  const candidates = JSON.stringify(settings.enabled.filter(id =>
    !settings.liveProviders.includes(id) && !settings.ignoredLocalProviders?.includes(id)
    && !settings.profiles.some(profile => profile.providerId === id)));
  useEffect(() => {
    if (!isTauri() || settings.demo || settings.legalVersion !== LEGAL_VERSION || candidates === '[]') { setChecking(false); return; }
    let active = true;
    setChecking(true); setError('');
    void invoke<ProviderId[]>('discover_local_providers', { providerIds: JSON.parse(candidates) }).then(found => {
      if (!active || !Array.isArray(found)) return;
      const eligible = JSON.parse(candidates) as ProviderId[];
      const selected = eligible.filter(id => found.includes(id));
      if (selected.length) latestUpdate.current({
        liveProviders: [...new Set([...settings.liveProviders, ...selected])],
        tokenProviders: (settings.tokenProviders ?? []).filter(id => !selected.includes(id)),
      });
    }).catch(() => { if (active) setError('Local connections could not be checked. Use Refresh to try again.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
    // Changes to connection choices cancel an older discovery, so a late result
    // cannot undo a disconnect, a new token connection, or a profile selection.
  }, [settings.demo, settings.legalVersion, candidates, JSON.stringify(settings.liveProviders), JSON.stringify(settings.tokenProviders), request]);
  return { checking, error, refresh: () => setRequest(value => value + 1) };
}
