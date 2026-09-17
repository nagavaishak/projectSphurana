import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, passthroughImageService } from 'astro/config';

const resolvePath = (p) => fileURLToPath(new URL(p, import.meta.url));

// Sentry is enabled per-environment: the integration (and its build-time
// cost) only loads when a DSN is configured. Source maps are generated and
// uploaded only on production Vercel builds that have an auth token.
const sentryDsn = process.env.PUBLIC_SENTRY_DSN;
const uploadSourceMaps =
  !!process.env.SENTRY_AUTH_TOKEN && process.env.VERCEL_ENV === 'production';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://www.borradh.io',

  // Adapter enables per-route on-demand rendering: marketing pages stay
  // static (prerendered at build), /blog and /book opt into SSR via
  // `export const prerender = false`.
  adapter: vercel(),

  // The marketing site ships unoptimized images (mirrors the Next config's
  // `images: { unoptimized: true }`). Passthrough avoids pulling in sharp,
  // which shaves install + build time.
  image: { service: passthroughImageService() },

  // Stale /dashboard links predate the app/marketing split — the redirect
  // lives in src/pages/dashboard/[...path].ts (it derives the app domain
  // from the request host).

  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },

  build: {
    // Render static pages in parallel.
    concurrency: 4,
    inlineStylesheets: 'auto',
  },

  integrations: [
    react(),
    ...(sentryDsn
      ? [
          // DSN + SDK options live in sentry.{client,server}.config.js.
          sentry({
            sourceMapsUploadOptions: uploadSourceMaps
              ? {
                  org: process.env.SENTRY_ORG,
                  project: process.env.SENTRY_PROJECT_MARKETING,
                  authToken: process.env.SENTRY_AUTH_TOKEN,
                }
              : { enabled: false },
          }),
        ]
      : []),
  ],

  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // Bundle posthog-js into the SSR output instead of leaving it as a
      // runtime import.
      //
      // posthog-js declares no `./react` subpath in its `exports` map, so
      // Vite resolves `posthog-js/react` to a raw file path and bakes
      // `posthog-js/react/dist/esm/index.js` into the server chunk as an
      // external import. Node then loads that file directly at request time
      // and the named export is not visible, so every on-demand route dies
      // with:
      //
      //   SyntaxError: The requested module
      //   'posthog-js/react/dist/esm/index.js' does not provide an export
      //   named 'PostHogProvider'
      //
      // It only affects SSR routes — static pages are rendered at build time,
      // where resolution works — which is why the site looked healthy while
      // /book returned 500 for every organization.
      noExternal: ['posthog-js'],
    },
    resolve: {
      alias: {
        '@': resolvePath('./src'),
        // Shims that replace Next.js framework imports so the existing
        // React components can be reused unchanged as Astro islands.
        'next/link': resolvePath('./src/shims/next-link.tsx'),
        'next/image': resolvePath('./src/shims/next-image.tsx'),
        'next/navigation': resolvePath('./src/shims/next-navigation.ts'),
        'next-themes': resolvePath('./src/shims/next-themes.tsx'),
        // Local replacements for the dropped workspace packages.
        '@borradh-workspace/runtime-config/client': resolvePath(
          './src/shims/runtime-config.tsx'
        ),
        '@borradh-workspace/api-client': resolvePath('./src/lib/api-client.ts'),
      },
    },
    build: {
      // Source maps are a build-time cost — generate them only when Sentry
      // will upload them (production builds).
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      // The booking widget (react-query + react-hook-form + radix +
      // day-picker + phone input) is a legitimately large chunk, but it is
      // lazy-loaded only on /book routes — not a concern worth warning on.
      chunkSizeWarningLimit: 800,
    },
  },
});
