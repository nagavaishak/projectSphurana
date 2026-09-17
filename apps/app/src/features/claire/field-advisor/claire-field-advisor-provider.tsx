import { useRouterState } from '@tanstack/react-router';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { AdvisorContent } from './advisor-card-shell';
import { ClaireFieldAdvisorCard } from './claire-field-advisor-card';

interface CurrentAdvisor {
  targetSelector: string;
  content: AdvisorContent;
}

interface ClaireFieldAdvisorContextValue {
  current: CurrentAdvisor | null;
  openAt: (targetSelector: string, content: AdvisorContent) => void;
  close: (targetSelector: string) => void;
}

const ClaireFieldAdvisorContext =
  createContext<ClaireFieldAdvisorContextValue | null>(null);

/**
 * Provides the `useClaireFieldAdvisor()` API. Renders at most one
 * `ClaireFieldAdvisorCard` at a time. Closes automatically on route change.
 *
 * Mount as high as the surface that needs it (e.g. `/ads/new` layout). Don't
 * mount globally — provider unmount = card unmount, and you want the card to
 * disappear when leaving the surface.
 */
export function ClaireFieldAdvisorProvider({
  children,
}: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentAdvisor | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const openAt = useCallback(
    (targetSelector: string, content: AdvisorContent) => {
      setCurrent({ targetSelector, content });
    },
    []
  );

  const close = useCallback((targetSelector: string) => {
    setCurrent((prev) =>
      prev && prev.targetSelector === targetSelector ? null : prev
    );
  }, []);

  // Close on route change — advisor anchors live with their surface.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger; the body intentionally ignores its current value.
  useEffect(() => {
    setCurrent(null);
  }, [pathname]);

  const value = useMemo<ClaireFieldAdvisorContextValue>(
    () => ({ current, openAt, close }),
    [current, openAt, close]
  );

  return (
    <ClaireFieldAdvisorContext.Provider value={value}>
      {children}
      {current ? (
        <ClaireFieldAdvisorCard
          targetSelector={current.targetSelector}
          content={current.content}
          onDismiss={() => close(current.targetSelector)}
        />
      ) : null}
    </ClaireFieldAdvisorContext.Provider>
  );
}

export function useClaireFieldAdvisor() {
  const ctx = useContext(ClaireFieldAdvisorContext);
  if (!ctx) {
    throw new Error(
      'useClaireFieldAdvisor must be used inside ClaireFieldAdvisorProvider'
    );
  }
  return ctx;
}
