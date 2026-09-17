# @borradh-workspace/marketing-astro

The marketing site. It began as an Astro port of a Next.js app
(`apps/marketing`), which has since been deleted — this is now the only
marketing app.

## Why

The Next.js marketing app carried an unnecessary dependency load for a
marketing site. This port dropped it:

| Dropped | Replaced with |
|---------|---------------|
| `next` | `astro` |
| `next-themes` | `src/shims/next-themes.tsx` (compact theme provider) + a pre-paint inline script |
| `@t3-oss/env-nextjs` | plain `process.env` reads (`src/lib/config.ts`) |
| `@sentry/nextjs` | `@sentry/astro` (enabled only when a DSN is set) |
| `postcss` + `@tailwindcss/postcss` | `@tailwindcss/vite` |
| `@borradh-workspace/env` | — (was unused) |
| `@borradh-workspace/runtime-config` | `src/shims/runtime-config.tsx` + a `window.__CONFIG__` head script |
| `@borradh-workspace/api-client` | `src/lib/api-client.ts` (minimal `fetch` client) |

Dropping `@borradh-workspace/api-client` is the big win: it transitively
pulled in `@borradh-workspace/features` (the entire backend) and
`@borradh-workspace/database`. **This app now depends on zero workspace
packages** — it is fully standalone.

## Architecture

- Existing React components are reused unchanged as **islands**. Next.js
  framework imports (`next/link`, `next/image`, `next/navigation`) are
  redirected to `src/shims/*` via Vite aliases in `astro.config.mjs`.
- Each page is one `.astro` route rendering a single React island
  (`src/components/pages/*`) wrapped in the providers + navbar + footer
  (`MarketingShell`), so theme / config / PostHog context flows through one
  React tree.
- **Static** (prerendered at build): home, about, contact, how-it-works,
  pricing, the four legal pages, 404.
- **SSR** (`export const prerender = false`): `/blog`, `/blog/[slug]`,
  `/book/[organizationSlug]`, `/book/.../[serviceId]`, `/dashboard/*`
  (legacy redirect → the app), and two reverse proxies — `/ingest` (PostHog)
  and `/monitoring` (Sentry tunnel). Served as Vercel serverless functions.

## Build-time optimisations

- `@tailwindcss/vite` (lightningcss) instead of the PostCSS pipeline.
- `passthroughImageService()` — no `sharp`; the site ships unoptimized
  images, matching the Next config.
- No source maps.
- `build.concurrency: 4` — pages render in parallel.
- Per-package `turbo.json` with correct `inputs`/`outputs` — repeat/CI
  builds are cache hits (~0.6s vs ~8.5s cold).

## Commands

```bash
pnpm dev        # astro dev  (port 3003)
pnpm build      # astro build
pnpm typecheck  # astro check
```

(`astro preview` is intentionally not wired up — the Vercel adapter does not
support it. Use `pnpm dev`, or deploy a preview.)

E2E smoke tests live in the sibling `apps/marketing-astro-e2e` package:

```bash
pnpm --filter @borradh-workspace/marketing-astro-e2e e2e
```

## Environment

See `.env.example`. All values are optional for a successful build —
the blog renders empty without Contentful credentials, and runtime config
falls back to safe defaults.
