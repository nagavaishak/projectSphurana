/**
 * THE Graph API versions. One file, so a bump is one edit and not a grep.
 *
 * These were previously declared in six places with three different values — and
 * the one that mattered most, the lead-RETRIEVAL path in
 * `facebook-leads.service.ts`, was pinned to `v18.0`: three years behind
 * everything else and inside Meta's sunset window. The outbound WhatsApp path
 * (`whatsapp-cloud.service.ts`) was sending live messages on v18.0 too. Both are
 * now on `GRAPH_API_VERSION` below. THAT is what this consolidation was for.
 *
 * `graph.instagram.com` (the Instagram Login API) versions independently of
 * `graph.facebook.com`.
 *
 * WHY THREE INSTAGRAM CONSTANTS AND NOT ONE.
 * Consolidating them onto a single version would have moved four live call sites
 * (sender-profile, publish, page-media, post-engagement) from v21/v22 to v24 —
 * a real behaviour change on the IG DM and IG publish paths, bundled into a
 * refactor whose whole point was to change nothing. Meta says it is backwards
 * compatible; nothing in this repo drives an IG publish end-to-end, so "says"
 * is all we would have had. So the versions below are EXACTLY the ones that were
 * running before, recorded rather than unified. The single source is the win; the
 * version bump is a separate, deliberate change that wants a staging smoke test
 * (IG DM + IG publish) behind it.
 *
 * To bump: change one constant here, run that smoke test, ship it on its own.
 */
export const GRAPH_API_VERSION = 'v21.0';
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';

/** Media read paths: `fetch-page-media`, `get-post-engagement`. */
export const INSTAGRAM_GRAPH_API_VERSION = 'v21.0';
export const INSTAGRAM_GRAPH_API_BASE = `${INSTAGRAM_GRAPH_HOST}/${INSTAGRAM_GRAPH_API_VERSION}`;

/** Messaging + publish paths: `fetch-sender-profile`, `publish-social-post`. */
export const INSTAGRAM_MESSAGING_API_VERSION = 'v22.0';
export const INSTAGRAM_MESSAGING_API_BASE = `${INSTAGRAM_GRAPH_HOST}/${INSTAGRAM_MESSAGING_API_VERSION}`;

/** The Instagram Login (OAuth) flow — already on v24 before this change. */
export const INSTAGRAM_OAUTH_API_VERSION = 'v24.0';
export const INSTAGRAM_OAUTH_API_BASE = `${INSTAGRAM_GRAPH_HOST}/${INSTAGRAM_OAUTH_API_VERSION}`;
