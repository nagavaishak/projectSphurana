/**
 * LEGACY booking URL — 301 to the microsite shape.
 *
 * Booking used to live at `{app}/book/{slug}/…`, then briefly at
 * `{marketing}/book/{slug}/…`. It now hangs off the microsite base like every
 * other tenant surface (`/sites/{slug}/book/…`), so one base decides the tier
 * and no single surface can drift onto a different prefix.
 *
 * These URLs are ALREADY IN THE WILD and cannot be retired: they sit in
 * confirmation emails a customer may open months from now, in messages Claire
 * has already sent, and in live Meta ad creative that a path change does not
 * rewrite. So this is permanent, not a migration window.
 *
 * An endpoint rather than an `.astro` page, matching `dashboard/[...path].ts`:
 * a page whose whole body is a frontmatter `return` trips astro-check into
 * reporting the redirect target as unused.
 *
 * 301, not 302 — the new URL is canonical and search engines should move their
 * index. `[...rest]` also matches the empty remainder, so the bare
 * `/book/{slug}` lands here too, and the query string is preserved because it
 * carries the microsite attribution (`micrositeId`, UTMs).
 */
export const prerender = false;

import type { APIRoute } from 'astro';

export const ALL: APIRoute = ({ params, url, redirect }) => {
  const slug = encodeURIComponent(params.organizationSlug ?? '');
  const rest = params.rest ? `/${params.rest}` : '';
  return redirect(`/sites/${slug}/book${rest}${url.search}`, 301);
};
