import type { AssistantPrimaryAction } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useMemo } from 'react';

/**
 * Tour handler — invoked when a recommendation's primary action is `type: 'tour'`.
 * The hosting app registers one handler per tour `target` identifier.
 *
 * The previous `create_*` handlers (create_ad / create_video / create_offer /
 * create_post) were removed when chat became the only creation entry point.
 * Future onboarding / discovery tours register via the `handlers` prop below.
 */
export type WalkthroughHandler = (payload?: Record<string, unknown>) => void;

export type WalkthroughHandlers = Record<string, WalkthroughHandler>;

/**
 * Dispatcher exposed to consumers — routes a recommendation's primary_action
 * to the right side-effect (navigate for navigate, handler call for tour,
 * no-op for none). Components don't decide how a tour runs; they emit intent.
 */
export interface WalkthroughDispatcher {
  dispatch: (action: AssistantPrimaryAction) => void;
}

const WalkthroughDispatcherContext =
  createContext<WalkthroughDispatcher | null>(null);

interface ClaireWalkthroughProviderProps {
  handlers: WalkthroughHandlers;
  children: React.ReactNode;
}

export function ClaireWalkthroughProvider({
  handlers,
  children,
}: ClaireWalkthroughProviderProps) {
  const navigate = useNavigate();

  // No built-in handlers — the legacy `create_*` tours were removed when chat
  // became the only path into creation. Callers pass any onboarding /
  // discovery tour handlers via the `handlers` prop.
  const mergedHandlers = useMemo<WalkthroughHandlers>(
    () => ({ ...handlers }),
    [handlers]
  );

  const value = useMemo<WalkthroughDispatcher>(
    () => ({
      dispatch(action) {
        switch (action.type) {
          case 'navigate': {
            if (!action.target) {
              console.warn(
                '[ClaireWalkthroughProvider] navigate action has no target',
                action
              );
              return;
            }
            void navigate({ to: action.target as never });
            return;
          }
          case 'tour': {
            if (!action.target) {
              console.warn(
                '[ClaireWalkthroughProvider] tour action has no target',
                action
              );
              return;
            }
            const handler = mergedHandlers[action.target];
            if (!handler) {
              console.warn(
                `[ClaireWalkthroughProvider] no handler registered for tour "${action.target}"`
              );
              return;
            }
            handler(action.payload);
            return;
          }
          case 'none':
            return;
        }
      },
    }),
    [navigate, mergedHandlers]
  );

  return (
    <WalkthroughDispatcherContext.Provider value={value}>
      {children}
    </WalkthroughDispatcherContext.Provider>
  );
}

export function useWalkthroughDispatcher(): WalkthroughDispatcher {
  const ctx = useContext(WalkthroughDispatcherContext);
  if (!ctx) {
    throw new Error(
      'useWalkthroughDispatcher must be used inside <ClaireWalkthroughProvider>'
    );
  }
  return ctx;
}
