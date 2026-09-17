// Local replacement for `@borradh-workspace/runtime-config/client`.
// The Astro app builds per-environment on Vercel, so config is injected
// once via a head script (window.__CONFIG__) and passed to page islands
// as a prop — no separate workspace package needed.
'use client';

import { type ReactNode, createContext, useContext } from 'react';

export interface RuntimeConfig {
  apiUrl: string;
  appUrl: string;
  posthogKey: string | null;
  posthogHost: string | null;
  marketingSentryDsn: string | null;
  appEnv: string;
}

const EMPTY_CONFIG: RuntimeConfig = {
  apiUrl: '',
  appUrl: '',
  posthogKey: null,
  posthogHost: null,
  marketingSentryDsn: null,
  appEnv: 'production',
};

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const ctx = useContext(RuntimeConfigContext);
  if (ctx) return ctx;
  if (typeof window !== 'undefined' && window.__CONFIG__) {
    return window.__CONFIG__;
  }
  return EMPTY_CONFIG;
}
