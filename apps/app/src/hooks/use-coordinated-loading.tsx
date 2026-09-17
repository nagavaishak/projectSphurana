import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface CoordinatedLoadingContextValue {
  register: (id: string, isLoading: boolean) => void;
  unregister: (id: string) => void;
  isPageReady: boolean;
}

const CoordinatedLoadingContext =
  createContext<CoordinatedLoadingContextValue | null>(null);

/**
 * Wraps page content to coordinate loading states across multiple components.
 * All components using `useCoordinatedLoading` will show skeletons until
 * every registered query has finished loading.
 */
export function CoordinatedLoadingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [queries, setQueries] = useState<Map<string, boolean>>(() => new Map());

  const register = useCallback((id: string, isLoading: boolean) => {
    setQueries((prev) => {
      if (prev.get(id) === isLoading) return prev;
      const next = new Map(prev);
      next.set(id, isLoading);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setQueries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isPageReady =
    queries.size > 0 &&
    Array.from(queries.values()).every((loading) => !loading);

  const value = useMemo(
    () => ({ register, unregister, isPageReady }),
    [register, unregister, isPageReady]
  );

  return (
    <CoordinatedLoadingContext.Provider value={value}>
      {children}
    </CoordinatedLoadingContext.Provider>
  );
}

/**
 * Register a query's loading state for coordinated page loading.
 * All registered queries must finish loading before `isPageReady` becomes true.
 *
 * Returns `isPageReady` — true only when ALL registered queries on the page have
 * finished loading. Falls back to `!isLoading` when no provider is present.
 *
 * @param id - Unique identifier for this query (e.g. 'lead-stats', 'campaigns')
 * @param isLoading - The query's loading state (use `isLoading` from React Query, not `isFetching`)
 */
export function useCoordinatedLoading(id: string, isLoading: boolean): boolean {
  const ctx = useContext(CoordinatedLoadingContext);
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  // Do not depend on `ctx` — the provider memo includes `isPageReady`, so the
  // context value object changes whenever readiness flips. Using `ctx` in this
  // effect's deps causes: cleanup unregisters all ids → map empty → isPageReady
  // false → new ctx → effect re-runs → infinite loop (seen on dashboard).
  useEffect(() => {
    if (!register || !unregister) return;
    register(id, isLoading);
    return () => unregister(id);
  }, [register, unregister, id, isLoading]);

  if (!ctx) return !isLoading;
  return ctx.isPageReady;
}
