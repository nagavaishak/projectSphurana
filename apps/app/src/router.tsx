import { createRouter } from '@tanstack/react-router';

import { AppBootSplash } from '@/components/app-boot-splash';
import { queryClient } from '@/lib/query-client';
import { routeTree } from '@/routeTree.gen';

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // A pending `beforeLoad` (notably the cold-boot session gate on `/sign-in`
  // and `_authed`) must never leave the WebView blank — render the boot splash
  // instead of a white screen. Kept at the default `defaultPendingMs` so quick
  // in-app navigations don't flash the splash; only a genuinely stalled load
  // (>1s) surfaces it.
  defaultPendingComponent: AppBootSplash,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
