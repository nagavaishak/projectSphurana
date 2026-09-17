# @borradh-workspace/runtime-config

Environment-agnostic runtime config for the web frontends.

The same web bundle should run in preview, staging, and production — so config
must come from the server at request time, not be baked into JS at build time.

## Layout

| Subpath  | Use it from                        |
| -------- | ---------------------------------- |
| `/schema`| Anywhere — pure zod schema + type. |
| `/server`| Next.js Server Components, Vercel Edge Functions, NestJS, scripts. Reads `process.env`. |
| `/client`| Client components — `RuntimeConfigProvider`, `useRuntimeConfig`, `RuntimeConfigScript`. |

## Env var names

The package reads `process.env` with **unprefixed** names. The `NEXT_PUBLIC_*`
and `VITE_*` prefixes only matter for client-time inlining, which we no longer
do — config is delivered to the browser at request time.

| Schema field                       | Env var                              | Required |
| ---------------------------------- | ------------------------------------ | -------- |
| `apiUrl`                           | `API_URL`                            | yes      |
| `appUrl`                           | `APP_URL`                            | yes      |
| `appEnv`                           | `APP_ENV`                            | no (defaults to `production`) |
| `posthogKey`                       | `POSTHOG_KEY`                        | yes      |
| `posthogHost`                      | `POSTHOG_HOST`                       | yes      |
| `sentryDsn`                        | `SENTRY_DSN`                         | no       |
| `sentryEnvironment`                | `SENTRY_ENVIRONMENT`                 | no       |
| `marketingSentryDsn`               | `MARKETING_SENTRY_DSN`               | no       |
| `intercomAppId`                    | `INTERCOM_APP_ID`                    | no       |
| `googleMapsApiKey`                 | `GOOGLE_MAPS_API_KEY`                | no       |
| `turnstileSiteKey`                 | `TURNSTILE_SITE_KEY`                 | no       |
| `stripePublishableKey`             | `STRIPE_PUBLISHABLE_KEY`             | no       |
| `metaAppId`                        | `META_APP_ID`                        | no       |
| `whatsappEmbeddedSignupConfigId`   | `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` | no       |
| `cdnUrl`                           | `CDN_URL`                            | no       |
| `cdnEnabled`                       | `CDN_ENABLED`                        | no       |
| `s3PublicAssetsBucket`             | `S3_PUBLIC_ASSETS_BUCKET`            | no       |
| `s3Region`                         | `S3_REGION`                          | no       |

## Next.js App Router (apps/marketing)

```tsx
// app/layout.tsx
import { getServerConfig } from '@borradh-workspace/runtime-config/server';
import {
  RuntimeConfigProvider,
  RuntimeConfigScript,
} from '@borradh-workspace/runtime-config/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getServerConfig();
  return (
    <html lang="en">
      <head>
        <RuntimeConfigScript config={config} />
      </head>
      <body>
        <RuntimeConfigProvider initialConfig={config}>
          {children}
        </RuntimeConfigProvider>
      </body>
    </html>
  );
}
```

## Vite SPA (apps/app)

Two pieces — a Vercel Edge Function that serves the config, and a
`RuntimeConfigProvider` that fetches it before rendering the app.

```ts
// apps/app/api/runtime-config.ts
// (Window E owns the actual file; this snippet shows the expected shape.)
import { getServerConfig } from '@borradh-workspace/runtime-config/server';

export const config = { runtime: 'edge' };

export default function handler() {
  const cfg = getServerConfig();
  return new Response(JSON.stringify(cfg), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
```

```tsx
// apps/app/src/main.tsx
import { RuntimeConfigProvider } from '@borradh-workspace/runtime-config/client';

createRoot(document.getElementById('root')!).render(
  <RuntimeConfigProvider
    fetchUrl="/api/runtime-config"
    fallback={<AppBoot />}
  >
    <App />
  </RuntimeConfigProvider>,
);
```

## Reading the config

```tsx
'use client';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';

export function ApiClient() {
  const { apiUrl } = useRuntimeConfig();
  // ...
}
```

For non-React code that needs config synchronously (e.g. Sentry init wrappers),
the provider writes the validated config to `window.__CONFIG__` once it
resolves, so it can be read directly:

```ts
const config = window.__CONFIG__ as RuntimeConfig | undefined;
```

The `RuntimeConfigScript` component does the same thing eagerly in `<head>` for
SSR'd apps, so non-React code can read it before React even hydrates.
