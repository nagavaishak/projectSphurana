import { RuntimeConfigProvider } from '@borradh-workspace/runtime-config/client';
import type { RuntimeConfig } from '@borradh-workspace/runtime-config/schema';
import { Capacitor } from '@capacitor/core';
import { type ReactNode, useEffect, useState } from 'react';

import { AppBootSplash } from '@/components/app-boot-splash';
import { getBuildTimeRuntimeConfig } from '@/lib/build-time-runtime-config';
import { getRuntimeConfigFetchUrl } from '@/lib/runtime-config-url';

type Props = {
  children: ReactNode;
};

function NativeRuntimeConfigProvider({
  buildTime,
  children,
}: {
  buildTime: RuntimeConfig;
  children: ReactNode;
}) {
  const [config, setConfig] = useState(buildTime);
  const fetchUrl = getRuntimeConfigFetchUrl();

  useEffect(() => {
    if (!fetchUrl.startsWith('http')) return;
    let cancelled = false;
    fetch(fetchUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<RuntimeConfig>;
      })
      .then((remote) => {
        if (!cancelled) setConfig(remote);
      })
      .catch((err) => {
        console.warn(
          '[runtime-config] remote fetch failed; using build-time config',
          err
        );
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  return (
    <RuntimeConfigProvider initialConfig={config}>
      {children}
    </RuntimeConfigProvider>
  );
}

/**
 * Loads runtime config for web and Capacitor.
 *
 * Native bundled builds use `VITE_*` values from `.env` at build time so the app
 * boots even when `/api/runtime-config` is unreachable or misconfigured.
 */
export function AppRuntimeConfigProvider({ children }: Props) {
  const buildTime = getBuildTimeRuntimeConfig();

  if (buildTime && Capacitor.isNativePlatform()) {
    return (
      <NativeRuntimeConfigProvider buildTime={buildTime}>
        {children}
      </NativeRuntimeConfigProvider>
    );
  }

  return (
    <RuntimeConfigProvider
      fetchUrl={getRuntimeConfigFetchUrl()}
      fallback={<AppBootSplash />}
    >
      {children}
    </RuntimeConfigProvider>
  );
}
