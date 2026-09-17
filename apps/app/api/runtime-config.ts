import { getServerConfig } from '@borradh-workspace/runtime-config/server';

import { runtimeConfigCorsHeaders } from './runtime-config-cors.js';

export const config = { runtime: 'edge' };

// s-maxage=60: one execution per minute per POP. Config values are stable
// per-deployment (the derived overrides below resolve from Vercel system env
// that's fixed at deploy time), so serving from edge cache for up to 60s
// keeps boot fast without making rotations meaningfully slow.
export default function handler(request: Request): Response {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: runtimeConfigCorsHeaders(request),
    });
  }
  // For PR previews we derive apiUrl and appUrl at request time from
  // Vercel's auto-populated git system env, instead of asking CI to write
  // per-PR Vercel env vars + redeploy on every push. Tradeoff: the borradh-
  // app project's preview env still needs the static values (POSTHOG_KEY,
  // SENTRY_DSN, etc.) set once via the Vercel dashboard, but the per-PR
  // values are free — Vercel's auto-deploy "just works", no CI sync, no
  // rebuild.
  //
  // VERCEL_ENV: 'production' | 'preview' | 'development'
  // VERCEL_URL: this deployment's auto-generated hostname (no protocol)
  // VERCEL_GIT_PULL_REQUEST_ID: PR number when the deploy came from a PR,
  //   empty for direct branch pushes with no open PR
  //
  // PREVIEW_API_ORIGIN: explicit upstream override for preview deployments that
  //   are not tied to a PR — currently the ephemeral backend the scheduled
  //   nightly provisions (.github/workflows/e2e-nightly.yml). Must stay in sync
  //   with the identical override in api/nest.ts.
  const isPreview = process.env.VERCEL_ENV === 'preview';
  const prNumber = process.env.VERCEL_GIT_PULL_REQUEST_ID;
  const originOverride = process.env.PREVIEW_API_ORIGIN;
  const vercelUrl = process.env.VERCEL_URL;

  // A preview knows its backend if it was told one, or if it can derive one
  // from a PR number. Both paths route through the same-origin proxy below.
  // `||` throughout, not `??`: an env var set to the empty string must fall
  // through to the PR derivation rather than win it and yield an empty API_URL.
  const previewApiOrigin =
    isPreview && (originOverride || prNumber)
      ? (
          originOverride || `https://borradh-api-pr-${prNumber}.fly.dev`
        ).replace(/\/+$/, '')
      : undefined;

  const source: Record<string, string | undefined> = { ...process.env };

  if (previewApiOrigin) {
    // Per-PR Fly app names are minted in .github/workflows/pr-preview.yml
    // (`steps.names.outputs.api_url`) — keep these in sync.
    source.API_URL = previewApiOrigin;
    source.APP_ENV = 'preview';
  }

  if (isPreview && vercelUrl) {
    // Each preview deployment serves the SPA from its own hostname; that's
    // also what we want appUrl to point at so absolute links resolve back
    // to the same preview the user is on.
    source.APP_URL = `https://${vercelUrl}`;
  }

  if (isPreview) {
    // Keep preview errors out of the prod Sentry environment even if the
    // project-wide SENTRY_ENVIRONMENT happens to be set to something else.
    source.SENTRY_ENVIRONMENT = 'preview';
  }

  const cfg = getServerConfig(source);

  if (previewApiOrigin) {
    // Route the SPA's API calls through the same-origin proxy
    // (api/nest/[...path].ts) so the Better Auth session cookie is
    // first-party. A direct *.vercel.app → *.fly.dev call makes the cookie
    // third-party (SameSite=None), which Safari/Chrome block — sign-in then
    // silently fails. Production keeps the absolute apiUrl untouched.
    cfg.apiUrl = '/api/nest';
  }

  return new Response(JSON.stringify(cfg), {
    headers: runtimeConfigCorsHeaders(request),
  });
}
