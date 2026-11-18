'use client';
/**
 * Small data hooks over the repository layer (the repo has no React Query/SWR).
 * Components re-run their loader whenever the data changes anywhere.
 */
import { useEffect, useState, useSyncExternalStore, type DependencyList } from 'react';
import { getVersion, subscribe } from '@/lib/repositories';

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, () => 0);
}

export interface DataState<T> { data: T | undefined; error: Error | null; loading: boolean }

export function useData<T>(loader: () => Promise<T>, deps: DependencyList = []): DataState<T> {
  const version = useDataVersion();
  const [state, setState] = useState<DataState<T>>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader().then(
      (data) => { if (alive) setState({ data, error: null, loading: false }); },
      (error: unknown) => { if (alive) setState((s) => ({ ...s, error: error instanceof Error ? error : new Error(String(error)), loading: false })); }
    );
    return () => { alive = false; };
    // the loader is re-created every render; deps + the data version decide when to reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

/** True only after the first client render (avoid hydration mismatches with browser-only data). */
export function useMounted(): boolean {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}
