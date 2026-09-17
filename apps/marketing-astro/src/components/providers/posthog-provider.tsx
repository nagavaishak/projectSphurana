'use client';

import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { Suspense, useEffect, useRef } from 'react';

import { dropPostHogNoise } from '@/lib/posthog-noise';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { posthogKey, appEnv } = useRuntimeConfig();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    if (!posthogKey) return;

    posthog.init(posthogKey, {
      api_host: '/r3y',
      ui_host: 'https://eu.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      persistence: 'localStorage+cookie',
      respect_dnt: true,
      // Error tracking: auto-capture unhandled errors + promise rejections.
      capture_exceptions: true,
      // ENG-853: drop the same third-party browser noise apps/app drops
      // (extension injection, expected user conditions, one client's
      // connectivity, browser/host quirks like ResizeObserver notices and the
      // Meta in-app browser's postMessage bridge teardown). See
      // src/lib/posthog-noise.ts for the rules and why this file duplicates
      // rather than imports apps/app's copy.
      before_send: dropPostHogNoise,
    });

    // Super property on every event so staging/preview data stays separable
    // from production in the shared PostHog project.
    posthog.register({ environment: appEnv });

    initialized.current = true;
  }, [posthogKey, appEnv]);

  if (!posthogKey) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture('$pageview', {
      $current_url: window.location.origin + url,
    });
  }, [pathname, searchParams]);

  return null;
}
