'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  type DefaultOptions,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { setSessionExpiredHandler } from '@/lib/patient-fetch';

import {
  type PortalContext,
  portalBookingLink,
  portalLink,
} from '../portal-context';

/**
 * The island-side half of the org resolution.
 *
 * TanStack Router gave every component `Route.useParams()`. There is no router
 * here, so the Astro page resolves the org once (server-side) and passes this
 * object into the island root; everything below reads it from context. No
 * component ever parses a URL — that was the apps/app bug this port exists to
 * remove.
 */
const PortalCtx = createContext<PortalContext | null>(null);

export function usePortal(): PortalContext {
  const ctx = useContext(PortalCtx);
  if (!ctx) {
    throw new Error('usePortal must be used inside <PortalProvider>');
  }
  return ctx;
}

/** `portalLink` bound to the current context — the only way to build a link. */
export function usePortalLink(): (subpath?: string) => string {
  const ctx = usePortal();
  return useMemo(() => (subpath?: string) => portalLink(ctx, subpath), [ctx]);
}

/** The clinic's public booking flow. */
export function useBookingLink(): string {
  const ctx = usePortal();
  return portalBookingLink(ctx);
}

/**
 * Navigate within the portal.
 *
 * TanStack's `useNavigate({ to, params })` becomes a full document navigation:
 * each portal page is its own Astro route with its own server-rendered shell,
 * so a client-side route swap has nothing to swap to. `replace` maps onto
 * `location.replace`, which matters for the post-sign-in and magic-link hops —
 * Back must not return to a consumed one-time link.
 */
export function usePortalNavigate() {
  const link = usePortalLink();
  return useMemo(
    () =>
      (subpath: string, options?: { replace?: boolean }): void => {
        const href = link(subpath);
        if (options?.replace) {
          window.location.replace(href);
        } else {
          window.location.assign(href);
        }
      },
    [link]
  );
}

/**
 * Declarative redirect, replacing TanStack's `<Navigate />`.
 *
 * Renders nothing and fires once. `replace` is the default: a customer bounced
 * off an authed page must not be able to press Back into it.
 */
export function PortalRedirect({
  to,
  replace = true,
}: {
  to: string;
  replace?: boolean;
}) {
  const link = usePortalLink();
  const href = link(to);

  useEffect(() => {
    if (replace) {
      window.location.replace(href);
    } else {
      window.location.assign(href);
    }
  }, [href, replace]);

  return null;
}

// Mirrors src/components/providers/booking-providers.tsx. Portal queries opt
// out of retries individually (a 401 does not heal), so the shared default
// stays as-is.
const queryConfig: DefaultOptions = {
  queries: {
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 30000),
  },
  mutations: { retry: 0 },
};

/**
 * Root of every portal island: query client, org context, toasts, and the
 * global session-expiry handler.
 *
 * The expiry handler is what makes a 401 on ANY call — not just the gate query
 * — land the customer on this microsite's sign-in. `patientFetch` calls it;
 * without it a session that expires mid-session leaves the page rendering
 * stale cached data with every refetch failing silently.
 */
export function PortalProvider({
  ctx,
  children,
}: {
  ctx: PortalContext;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: queryConfig })
  );

  const signInHref = portalLink(ctx, '/sign-in');

  useEffect(() => {
    setSessionExpiredHandler(() => {
      // Already on sign-in (or on the magic-link landing, which owns its own
      // failure copy) — a redirect there is a reload loop.
      const path = window.location.pathname;
      if (path === signInHref || path.endsWith('/portal/access')) return;
      queryClient.clear();
      window.location.replace(signInHref);
    });
    return () => setSessionExpiredHandler(null);
  }, [signInHref, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <PortalCtx.Provider value={ctx}>
        {children}
        <Toaster position="bottom-center" />
      </PortalCtx.Provider>
    </QueryClientProvider>
  );
}
