/// <reference types="astro/client" />

interface Window {
  __CONFIG__?: {
    apiUrl: string;
    appUrl: string;
    posthogKey: string | null;
    posthogHost: string | null;
    marketingSentryDsn: string | null;
    appEnv: string;
  };
}
