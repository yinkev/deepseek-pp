import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTONOMOUS_RUN_STORAGE_KEY } from '../../core/run/store';
import { getRuntimeCockpitSnapshot, type RuntimeCockpitSnapshot } from '../../core/cockpit';

interface RuntimeCockpitState {
  snapshot: RuntimeCockpitSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRuntimeCockpit(): RuntimeCockpitState {
  const [snapshot, setSnapshot] = useState<RuntimeCockpitSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const nextRefresh = refreshId.current + 1;
    refreshId.current = nextRefresh;
    setLoading(true);
    try {
      const next = await getRuntimeCockpitSnapshot();
      if (!mounted.current || refreshId.current !== nextRefresh) return;
      setSnapshot(next);
      setError(null);
    } catch (err) {
      if (!mounted.current || refreshId.current !== nextRefresh) return;
      setSnapshot(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current && refreshId.current === nextRefresh) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const storage = getChromeStorage();
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && AUTONOMOUS_RUN_STORAGE_KEY in changes) {
        void refresh();
      }
    };
    storage?.onChanged?.addListener(handler);
    return () => {
      mounted.current = false;
      storage?.onChanged?.removeListener(handler);
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}

function getChromeStorage(): typeof chrome.storage | null {
  try {
    if (typeof chrome === 'undefined') return null;
    return chrome.storage ?? null;
  } catch {
    return null;
  }
}
