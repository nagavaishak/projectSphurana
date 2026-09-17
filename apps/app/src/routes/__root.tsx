import type { QueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import React from 'react';

import { NativeChromeSync } from '@/components/native-chrome-sync';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { AppVersionGate } from '@/features/app-version';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  return (
    <>
      <NativeChromeSync />
      {/* Wraps the router, not a route: a blocked build has to be stopped
          before it reaches any screen, including sign-in. */}
      <AppVersionGate>
        <Outlet />
      </AppVersionGate>
      <Toaster />
      {/*
        Dev only, and switchable off with `VITE_DEVTOOLS=false`.

        The devtools portal their trigger to <body>, so the `hidden` wrapper
        below does NOT keep them out of the accessibility tree: the router
        panel exposes `aria-label="Open match details for /verify-email"`,
        which `getByLabel('Email')` matches. Any e2e spec run against a local
        DEV server then dies on a strict-mode violation ("resolved to 2
        elements") that cannot reproduce in CI, because CI serves a production
        build where this block is compiled out.
      */}
      {import.meta.env.DEV && import.meta.env.VITE_DEVTOOLS !== 'false' && (
        <React.Suspense fallback={null}>
          <div className="hidden">
            <TanStackRouterDevtools position="bottom-right" />
            <ReactQueryDevtools buttonPosition="bottom-left" />
          </div>
        </React.Suspense>
      )}
    </>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="space-y-4 text-center">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">404</h1>
          <p className="text-muted-foreground">
            We couldn't find that page. It may have moved, or the link may be
            out of date.
          </p>
        </div>
        {/*
          A WAY BACK. This rendered as a bare "404 / Page not found" on a blank
          screen with no chrome and no navigation — the app shell is not
          mounted here, so there is no sidebar either, and the only exit was the
          browser's back button.
          
          It is reachable by ordinary means, not just by mistyping: a branch's
          slug is owner-editable, so renaming one 404s every bookmark and every
          link already shared to it.
        */}
        <Button asChild>
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
