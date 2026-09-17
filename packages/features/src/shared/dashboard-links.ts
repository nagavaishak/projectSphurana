/**
 * Links from the SERVER back into the dashboard — the ones that ride in emails
 * and notifications.
 *
 * WHY THESE CANNOT BE BRANCH-SCOPED, which is the whole reason this file exists.
 *
 * Every branch-scoped page now lives at `/dashboard/l/:branch/…`. A server
 * building a link would therefore need to know which branch to name — and for a
 * conversation it cannot, because `conversation` has no `location_id` column.
 * There is no branch to resolve. So the server emits the UN-PREFIXED path and
 * the client resolves the branch on arrival (remembered branch, else the org's
 * primary) before forwarding.
 *
 * That makes the un-prefixed shape a PERMANENT contract for email links, not a
 * migration crutch. Anything that catches these paths — `dashboard/$.tsx` and
 * `dashboard/conversations.tsx` — is load-bearing for mail we have already sent
 * and cannot recall, and must outlive the rest of the compatibility shims.
 *
 * WHAT WAS WRONG. Five call sites independently built
 * `/dashboard/conversations/{id}` — the conversation id as a PATH SEGMENT. No
 * route has ever matched that shape since the move: `conversations.tsx` takes
 * the id as a SEARCH param, so the path fell through to the splat, which
 * forwarded it to `/dashboard/l/{branch}/conversations/{id}`, and nothing
 * serves that either. Every escalation alert, follow-up-required email and
 * stuck-conversation digest linked to a dead page, silently, for anyone who
 * clicked one.
 *
 * That is the same failure `microsite-links.ts` documents: several builders of
 * the same URL drift onto a route nobody serves, and each one fails quietly.
 * One builder, one shape, one place to change it when conversations do learn
 * which branch they belong to.
 */

/** Where the app serves a single conversation, as a root-relative path. */
export function conversationInboxPath(conversationId: string): string {
  // `?id=` — a SEARCH param, which is what `dashboard/conversations.tsx`
  // validates and forwards to the branch-scoped inbox. A path segment here is
  // the bug this module exists to prevent.
  return `/dashboard/conversations?id=${encodeURIComponent(conversationId)}`;
}

/**
 * The same destination, absolute, for use in email.
 *
 * `appBaseUrl` is the dashboard origin the caller already resolved
 * (`APP_URL ?? WEB_URL`); a trailing slash on it is tolerated so callers do not
 * each have to normalise one.
 */
export function conversationInboxUrl(
  appBaseUrl: string,
  conversationId: string
): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${conversationInboxPath(conversationId)}`;
}
