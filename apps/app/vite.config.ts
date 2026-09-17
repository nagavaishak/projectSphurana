import path from 'node:path';
import {
  runtimeConfigEnvMap,
  viteEnvName,
} from '@borradh-workspace/runtime-config/env-map';
import { getServerConfig } from '@borradh-workspace/runtime-config/server';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { type Connect, type Plugin, defineConfig, loadEnv } from 'vite';

// Vite dev middleware that serves /api/runtime-config from process.env, so
// `pnpm dev` matches the Vercel Edge Function shape exactly. Vercel handles
// the same path in production via `apps/app/api/runtime-config.ts`.
const runtimeConfigDevPlugin = (env: Record<string, string>): Plugin => ({
  name: 'borradh-runtime-config-dev',
  configureServer(server) {
    const handler: Connect.NextHandleFunction = (req, res, next) => {
      if (req.url !== '/api/runtime-config') {
        next();
        return;
      }
      if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        if (
          origin &&
          (origin === 'https://localhost' ||
            origin === 'capacitor://localhost' ||
            origin === 'http://localhost')
        ) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        res.statusCode = 204;
        res.end();
        return;
      }
      try {
        const cfg = getServerConfig({ ...process.env, ...env });
        const origin = req.headers.origin;
        if (
          origin &&
          (origin === 'https://localhost' ||
            origin === 'capacitor://localhost' ||
            origin === 'http://localhost')
        ) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Vary', 'Origin');
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(cfg));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    };
    server.middlewares.use(handler);
  },
});

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars to import.meta.env, but the dev
  // middleware reads from process.env via getServerConfig which expects
  // unprefixed names (API_URL, POSTHOG_KEY, etc.). Load with '' prefix so
  // .env values flow through unchanged.
  const env = loadEnv(mode, process.cwd(), '');

  // Capacitor bundled builds boot from config BAKED INTO THE JS BUNDLE (see
  // src/lib/build-time-runtime-config.ts) — the WebView loads from
  // capacitor://localhost and cannot reliably fetch /api/runtime-config.
  //
  // This map is DERIVED from `runtimeConfigEnvMap`, the single declaration of
  // "env var → RuntimeConfig field" (packages/runtime-config/src/env-map.ts),
  // so a field added to `runtimeConfigSchema` is baked automatically instead of
  // silently arriving as `undefined` on native.
  //
  // NOTE: this replaces a top-level `env: { ... }` block that Vite 6 does not
  // have as a config option — it was silently ignored, so the unprefixed
  // fallbacks (`API_URL`, `STRIPE_PUBLISHABLE_KEY`, …) never applied and only
  // vars literally spelled `VITE_*` in a loaded `.env` file were ever baked.
  // `define` is the real mechanism.
  const runtimeConfigDefines = Object.fromEntries(
    Object.values(runtimeConfigEnvMap).map((name) => {
      const viteName = viteEnvName(name);
      return [
        `import.meta.env.${viteName}`,
        JSON.stringify(env[viteName] || env[name] || ''),
      ];
    })
  );

  return {
    define: runtimeConfigDefines,
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
      runtimeConfigDevPlugin(env),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      allowedHosts: true,
    },
    preview: {
      port: 4173,
      host: true,
    },
    build: {
      outDir: 'dist',
      // Sourcemaps triple the build output (67 MB → 20 MB without) and add
      // ~3s to `vite build`. Vercel PREVIEW deploys upload that 67 MB on the
      // E2E critical path for every PR push, so previews skip them.
      //
      // Gate is deliberately narrow: only a Vercel non-production build turns
      // them off. Local builds, CI builds and the native/Capacitor builds
      // (mobile-build.yml / mobile-ota.yml, where VERCEL_ENV is unset) keep the
      // previous behaviour.
      //
      // Nothing uploads these to Sentry today — there is no @sentry/vite-plugin
      // and no sentry-cli sourcemaps step anywhere in the repo — so the only
      // consumer is a human opening prod devtools. If a Sentry upload step is
      // ever added, it belongs on the VERCEL_ENV === 'production' path, which
      // still emits maps.
      sourcemap: process.env.VERCEL_ENV
        ? process.env.VERCEL_ENV === 'production'
        : true,
    },
  };
});
