// Gate for the `/debug/*` routes, whose entire purpose is to throw.
//
// Mirrors apps/api's NonProductionGuard (PR #845). Those routes and these were
// built for the same job — proving the error pipeline on a deployed host — and
// they caused the same harm: a synthetic exception in the error stream is
// indistinguishable from a customer failure. Sentry issue MARKETING-4 was
// exactly that, a forced error from a public `GET /debug/server-error`.
//
// The tiers match the API's, minus the seed-token one (these routes have no
// auth of their own; the flag is the whole gate):
//
//   1. `DEBUG_ENDPOINTS_ENABLED` unset/false → 404, everywhere, always.
//   2. production                            → 404. Not expressible.
//   3. anywhere else + flag                  → allowed.
//
// Preview keeps tier 3 deliberately: preview is the only DEPLOYED place the
// marketing SSR capture path can be proven, and probing it on 2026-08-17 found
// it reaching neither PostHog nor Sentry. Removing the routes from previews
// would have left that undiscovered. What changes is that a probe now takes a
// deliberate act — set the flag on the deployment — instead of being on for
// anyone who guesses the URL.
//
// 404 rather than 403 is the contract: where these are unavailable they must
// look like they do not exist.
import { resolveAppEnv } from '@/lib/config';

/**
 * Strict boolean env read. Only "true" and "1" enable; everything else —
 * including the string "false" — disables. Same rule as the API guard, and for
 * the same reason: a flag whose job is "is this open" must not read "false" as
 * on, which is what `Boolean(string)` coercion does.
 */
function flagEnabled(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export function debugRoutesEnabled(): boolean {
  if (!flagEnabled('DEBUG_ENDPOINTS_ENABLED')) return false;
  // Same env resolution as event tagging, so "is this production?" has exactly
  // one answer across the app.
  return resolveAppEnv() !== 'production';
}

/** The response every gated debug route returns when it is not enabled. */
export function debugRouteDisabledResponse(): Response {
  return new Response('Not Found', { status: 404 });
}
