// Stale /dashboard* links predate the app/marketing split. Bounce them all
// to the app on the `app.` subdomain of whatever apex domain the marketing
// site is currently served from.
export const prerender = false;

import type { APIRoute } from 'astro';

export const ALL: APIRoute = ({ request, redirect }) => {
  const host = new URL(request.url).host.replace(/^www\./, '');
  return redirect(`https://app.${host}/dashboard/home`, 301);
};
