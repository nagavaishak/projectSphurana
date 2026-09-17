/**
 * A bare `/book` — no organization in the URL.
 *
 * Provisioning used to bake `ctaHref: '/book'` into the hero block, so pages
 * rendered before that was fixed still link here. On the path tier this names
 * no tenant, so there is nothing to serve and nothing the URL alone can
 * redirect to: `/book/{slug}` carries the org and 301s cleanly, this does not.
 *
 * The REFERRER does carry it. A visitor arriving from `/sites/{slug}/…` is
 * unambiguously that tenant's customer, so send them to that tenant's booking
 * flow rather than showing a 404 for a link the site itself rendered.
 *
 * 302, deliberately NOT 301: the destination depends on where the visitor came
 * from, not on this URL. A permanent redirect would be cached and would then
 * send the NEXT tenant's customers to the first tenant's booking page.
 *
 * `Vary: Referer` for the same reason — a shared cache must not serve one
 * tenant's answer to another's visitor.
 *
 * With no usable referrer there is no honest answer, so it 404s. This is a
 * safety net for pages already in the wild, not a route: the renderer no
 * longer emits `/book` (see components/microsite/booking-href.ts), and the
 * host-implied `/book` arrives with the wildcard tier.
 */
export const prerender = false;

import type { APIRoute } from 'astro';

/** `/sites/{slug}` or `/sites/{slug}/anything`. */
const SITE_PATH = /^\/sites\/([^/?#]+)/;

export const ALL: APIRoute = ({ request, url }) => {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const from = new URL(referer, url.origin);
      // Same-origin only: a referrer from anywhere else is not evidence about
      // which tenant this visitor belongs to.
      if (from.origin === url.origin) {
        const slug = from.pathname.match(SITE_PATH)?.[1];
        if (slug) {
          // Vary on the REDIRECT, not only the 404: this is the response
          // whose destination depends on the referrer, and a shared cache
          // serving one tenant's answer to another's visitor is the exact
          // failure this file's header warns about.
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/sites/${slug}/book${url.search}`,
              Vary: 'Referer',
            },
          });
        }
      }
    } catch {
      // A malformed Referer is not worth an error page.
    }
  }

  return new Response('Not found', {
    status: 404,
    headers: { Vary: 'Referer' },
  });
};
