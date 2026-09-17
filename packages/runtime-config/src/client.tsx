'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { safeJsonStringify } from './safe-json.js';
import { type RuntimeConfig, runtimeConfigSchema } from './schema.js';

declare global {
  interface Window {
    __CONFIG__?: unknown;
  }
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

const writeToWindow = (config: RuntimeConfig) => {
  if (typeof window !== 'undefined') {
    window.__CONFIG__ = config;
  }
};

type SyncProps = {
  children: ReactNode;
  initialConfig: RuntimeConfig;
  fetchUrl?: never;
  fallback?: never;
};

type AsyncProps = {
  children: ReactNode;
  fetchUrl: string;
  fallback: ReactNode;
  initialConfig?: never;
};

export type RuntimeConfigProviderProps = SyncProps | AsyncProps;

export function RuntimeConfigProvider(props: RuntimeConfigProviderProps) {
  const initialConfig = props.initialConfig ?? null;
  const fetchUrl = props.fetchUrl ?? null;

  const [fetched, setFetched] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    if (initialConfig) writeToWindow(initialConfig);
  }, [initialConfig]);

  useEffect(() => {
    if (!fetchUrl) return;
    let cancelled = false;
    // Abort after 10s so a hung edge function doesn't leave the app on the
    // fallback indefinitely. The AbortError surfaces via the .catch below.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    fetch(fetchUrl, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            `RuntimeConfig fetch failed: ${res.status} ${res.statusText}`
          );
        }
        return res.json();
      })
      .then((data) => {
        const parsed = runtimeConfigSchema.parse(data);
        if (cancelled) return;
        writeToWindow(parsed);
        setFetched(parsed);
      })
      .catch((err) => {
        if (cancelled) return;
        // Surface the failure: app code that depends on config should not
        // silently get stale/empty values.
        console.error('[runtime-config] failed to fetch', err);
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [fetchUrl]);

  const value = useMemo(
    () => initialConfig ?? fetched,
    [initialConfig, fetched]
  );

  if (!value) {
    return <>{props.fallback}</>;
  }
  return (
    <RuntimeConfigContext.Provider value={value}>
      {props.children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const ctx = useContext(RuntimeConfigContext);
  if (!ctx) {
    throw new Error(
      'useRuntimeConfig must be used inside RuntimeConfigProvider'
    );
  }
  return ctx;
}

export type RuntimeConfigScriptProps = {
  config: RuntimeConfig;
  nonce?: string;
};

export function RuntimeConfigScript({
  config,
  nonce,
}: RuntimeConfigScriptProps) {
  const html = `window.__CONFIG__=${safeJsonStringify(config)};`;
  return (
    <script
      nonce={nonce}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: required to inject runtime config before hydration
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export { runtimeConfigSchema, type RuntimeConfig } from './schema.js';
