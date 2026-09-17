import { setActiveLocationId as setApiClientLocation } from '@borradh-workspace/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef } from 'react';

import { useActiveLocation } from './use-active-location.js';

/**
 * Publishes the active branch to the api-client, so every request carries
 * `X-Location-Id` and the API scopes it (`LocationGuard` + `@ActiveLocation()`).
 *
 * WITHOUT THIS NOTHING IS SCOPED. Phase 2 made every list endpoint accept a
 * branch, but an absent header deliberately means "org-wide" — that is what let
 * the API ship ahead of the client. So until something calls
 * `setActiveLocationId`, the entire backend phase is inert and the switcher
 * changes a label and nothing else. This is that something.
 *
 * TWO THINGS HAVE TO HAPPEN TOGETHER, and the second is the one that bites:
 *
 *  1. The header is set during RENDER, not only in an effect. Effects run after
 *     children have already rendered — and mounted children fire their queries
 *     on that first pass. An effect-only version sends the first request of
 *     every page load unscoped, which is both wrong and cached.
 *
 *  2. The React Query cache is CLEARED when the branch changes. Query keys in
 *     this app are shared and location-free (`['appointments', 'list', …]`), so
 *     without this, switching from Dublin to Cork serves Dublin's appointments
 *     from cache — instantly, confidently, and wrong. `AdminOrgScope` solves the
 *     identical problem for the admin org-override by minting a whole new
 *     QueryClient; we cannot do that here because this wraps the WHOLE app and
 *     a new client would drop every in-flight subscription on each switch.
 *     Clearing is the surgical equivalent.
 *
 * Deliberately NOT clearing on first resolution: `previous.current` starts
 * `undefined`, so the initial null → "loc-1" transition is a set, not a switch,
 * and blowing the cache there would discard the page's own first fetches.
 */
export function ActiveLocationScope({ children }: { children: ReactNode }) {
  const { location } = useActiveLocation();
  const queryClient = useQueryClient();
  const previous = useRef<string | undefined>(undefined);

  const activeId = location?.id;

  // Synchronous: children rendered in THIS pass must already be scoped.
  if (activeId) setApiClientLocation(activeId);

  useEffect(() => {
    if (!activeId) return;
    setApiClientLocation(activeId);

    const had = previous.current;
    previous.current = activeId;
    // A real switch, not the first resolution — see the note above.
    if (had && had !== activeId) {
      queryClient.clear();
    }
  }, [activeId, queryClient]);

  return <>{children}</>;
}
