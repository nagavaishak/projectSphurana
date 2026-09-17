// Invitation emails sent before the APP_URL fix built their link from WEB_URL
// — the marketing origin — so every one of them points here instead of at the
// app, and lands on the 404. Those emails are already in people's inboxes and
// cannot be rewritten, so this bounces them to the real accept flow.
//
// The token rides in `?token=`, so the query string MUST be carried over; the
// sibling /dashboard redirect deliberately drops its path, and copying that
// here would strip the one thing the invitee needs.
//
// 302, not 301: this is a compatibility shim for links already in the wild,
// not a permanent home for the route. A 301 would be cached by browsers and
// mail clients indefinitely, which is hard to take back if /accept-invitation
// ever needs to mean something on the marketing site.
export const prerender = false;

import type { APIRoute } from 'astro';

export const ALL: APIRoute = ({ request, redirect }) => {
  const url = new URL(request.url);
  const host = url.host.replace(/^www\./, '');
  return redirect(`https://app.${host}/accept-invitation${url.search}`, 302);
};
