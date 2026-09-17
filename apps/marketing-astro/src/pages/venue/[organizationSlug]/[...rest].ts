/**
 * LEGACY venue URL — 301 to the microsite shape.
 *
 * The venue page lived at `app.borradh.io/venue/{slug}` for a long time, and
 * briefly at `{marketing}/venue/{slug}` when it first moved hosts. It now hangs
 * off the microsite base like every other tenant surface, so one base decides
 * the tier and no single page composes its URL differently.
 *
 * These URLs are in the wild — shared by clinics, indexed, linked from
 * profiles — so this is permanent, not a migration window. Same reasoning and
 * same shape as the booking redirect beside it.
 *
 * `[...rest]` also matches the empty remainder, so the bare `/venue/{slug}`
 * lands here as well as `/venue/{slug}/{locationSlug}`.
 */
export const prerender = false;

import type { APIRoute } from 'astro';

export const ALL: APIRoute = ({ params, url, redirect }) => {
  const slug = encodeURIComponent(params.organizationSlug ?? '');
  const rest = params.rest ? `/${params.rest}` : '';
  return redirect(`/sites/${slug}/venue${rest}${url.search}`, 301);
};
