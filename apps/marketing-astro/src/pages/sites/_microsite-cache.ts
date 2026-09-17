/**
 * EDGE CACHE POLICY for the published microsite, and the single upstream call
 * that fills it.
 *
 * Underscore-prefixed so Astro does not route it, same convention as
 * `pages/_microsite-routing.ts`. It is a module rather than inline frontmatter
 * because the staleness bound below is a correctness decision that has to be
 * pinned by a test — it was wrong once and nothing could see it.
 *
 * ── WHY THE WINDOW IS SHORT, AND WHY THERE IS NO LONG `stale-while-revalidate`
 *
 * This page renders LIVE business data — prices, opening hours, staff — beside
 * the published document. Data-bound blocks exist precisely so a price edit in
 * the dashboard shows on the website without a republish (plan §5); that is the
 * feature's whole selling point.
 *
 * The previous policy was `s-maxage=300, stale-while-revalidate=86400`. The SWR
 * half is the part that hurt: between 300s and 24h the edge serves the visitor
 * the STALE page and revalidates behind them, so the person who made the change
 * never sees it. On a low-traffic tenant site that repeats indefinitely — every
 * visitor gets yesterday's page and refreshes it for the next one. A site whose
 * pitch is that it is never stale was confidently wrong about a price for a day.
 *
 * So: a short TTL and NO stale window. A burst of ad traffic still collapses
 * onto one origin fetch per minute, which is what the edge cache is actually
 * for, and the worst case a publish or a price edit can cost is
 * `MICROSITE_EDGE_MAX_AGE_SECONDS`.
 *
 * DO NOT re-add a long `stale-while-revalidate` here. It reads as free
 * performance and is not: it buys latency with correctness on the one page
 * where correctness is the product.
 *
 * ── WHY NOT A REVISION-KEYED CACHE KEY, AND WHY NOT A TAG PURGE
 *
 * A cache key carrying `publishedRevisionId` would make staleness structurally
 * impossible, but Vercel's cache key is "request method + request URL + host +
 * deployment URL + scheme" and the docs state plainly that **cache keys are not
 * configurable** — `Vary` is not part of it, and middleware runs AFTER the cache
 * lookup, so nothing inside the app can influence the key without changing the
 * URL the visitor sees. It is not available to us.
 *
 * Tag purging IS available (on all plans, contrary to the note in plan §15), but
 * the header has to be `Vercel-Cache-Tag`; the `Cache-Tag` this code used to
 * send was silently ignored by the platform, which is why "publish purges the
 * tag" was doubly untrue. The tag is still emitted below — correctly named —
 * so a human can purge one tenant from the dashboard or `vercel cache
 * invalidate --tag`. NOTHING PURGES IT AUTOMATICALLY. It is an escape hatch,
 * not the freshness mechanism; the short TTL is the freshness mechanism.
 */

/**
 * The entire staleness budget for a published microsite — content and live
 * business data alike. Raising it makes the site wrong for longer.
 */
export const MICROSITE_EDGE_MAX_AGE_SECONDS = 60;

/**
 * Cache headers for a successfully rendered published page.
 *
 * `s-maxage` only: the shared edge caches, the visitor's browser does not, so a
 * reload after a publish always reaches the edge rather than a private copy we
 * cannot reach.
 */
export const micrositePublishedCacheHeaders = (
  micrositeId: string
): Record<string, string> => ({
  'Cache-Control': `public, s-maxage=${MICROSITE_EDGE_MAX_AGE_SECONDS}, max-age=0, must-revalidate`,
  // Manual purge handle only — see the file header. Vercel reads this name;
  // `Cache-Tag` (the old name here) it ignores entirely.
  'Vercel-Cache-Tag': `microsite-${micrositeId}`,
});

/**
 * A 404, a 503, and every draft/preview render.
 *
 * A cached miss outlives the DNS fix that resolves it, and a draft is content
 * the owner has not agreed to publish — it must never enter a SHARED cache, so
 * this is `no-store` and not merely `private`.
 */
export const MICROSITE_NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
};

/**
 * ONE upstream call per render.
 *
 * This used to be two, in series, Vercel → Fly: `/resolve` to turn the host
 * into a microsite id, then `/{id}/document`. The document endpoint re-resolves
 * the host anyway (it has to — the host, not the route id, is the org
 * authority), so the first call bought nothing but a second cross-cloud round
 * trip on exactly the request an ad campaign's first click pays for.
 *
 * `GET /public/microsites/document?host=&path=` does both and returns the
 * `micrositeId` it resolved. Published-only by construction: draft rendering
 * stays on the id-keyed route, which requires a signed preview token.
 */
export const micrositeDocumentUrl = (
  apiUrl: string,
  { host, path }: { host: string; path: string }
): string =>
  `${apiUrl.replace(/\/$/, '')}/public/microsites/document?host=${encodeURIComponent(
    host
  )}&path=${encodeURIComponent(path)}`;
