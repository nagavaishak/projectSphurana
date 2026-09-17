import { apiEnv } from '@borradh-workspace/env/api';
import { logError } from '@borradh-workspace/observability';
import { branchBookingPath } from '@borradh-workspace/web-shared';
import type { MicrositeLinkTarget } from './microsite-host.js';

/**
 * Links into a tenant's MICROSITE — the booking flow and the customer portal.
 *
 * Both moved out of `apps/app` and onto the microsite, which the marketing app
 * serves, so every server-built link to them changed shape at once: Claire's
 * booking links, appointment manage links, confirmation and consent emails,
 * and the native-calendar link.
 *
 * They live in `shared/` rather than in whichever domain first needed them
 * because four different contexts build these URLs. A copy per context is how
 * ENG-770 happened — several builders drifted onto a host that did not serve
 * the route, and every one of them failed silently (a 404, or a page that
 * rendered and then could not reach the API).
 *
 * TWO TIERS, one builder (plan §9; Phase 4 contract §5.2):
 *
 * - A tenant with a LIVE primary custom domain gets `https://{their-host}/book/…`
 *   and `https://{their-host}/portal/…`. There is NO `/sites/{slug}` prefix on
 *   their own host — the organization is implied by the hostname, and a slug
 *   segment there would 404. Sending that tenant's customers to OUR domain
 *   would defeat the entire feature: they are paying for their brand to be the
 *   destination.
 * - Everyone else gets the PATH tier, `{MARKETING_URL}/sites/{slug}/…`.
 *
 * Which tier applies is decided ONCE, in `microsite-host.ts`, and handed in as
 * a `MicrositeLinkTarget`. These builders stay pure and synchronous on purpose:
 * they run on email-send and chatbot paths, and a builder that resolved its own
 * host would hide a database query per recipient behind a string
 * concatenation. A caller with a list resolves `resolveMicrositeLinkTargets`
 * once and reuses the map.
 */

/**
 * The ORIGIN every customer-facing link is built on.
 *
 * NOT `WEB_URL` by preference. That name means different things in different
 * environments — in production it is the marketing host, but CI points it at
 * the DASHBOARD preview — and microsites, booking and the portal are served by
 * marketing alone. Building on it is how the venue page shipped a "Book now"
 * pointing at `{dashboard-host}/sites/{slug}/book`, wrong twice over.
 *
 * WHY THIS FALLS BACK RATHER THAN THROWING
 * This is on the path of `submitGeneralBooking`, every confirmation and
 * consent email, patient magic links and every chatbot reply. An unset
 * variable throwing here does not degrade those — it takes public booking
 * DOWN with a 500. That is a strictly worse failure than the one the throw was
 * guarding against, and it would land during a deploy, which is exactly when
 * nobody is reading logs for a config error.
 *
 * So: prefer MARKETING_URL, fall back to WEB_URL, and make the fallback LOUD.
 * In production the fallback is also *correct* (WEB_URL is www.borradh.io
 * there), so the realistic bad case is a preview building dashboard-host links
 * — visible, recoverable, and now alarmed rather than silent.
 *
 * Returns '' only if neither is set, which yields a relative URL: broken, but
 * broken in a way that still delivers the email and still books the
 * appointment.
 */
const micrositeOrigin = (target: MicrositeLinkTarget): string => {
  if (target.primaryDomain) return `https://${target.primaryDomain}`;
  if (apiEnv.MARKETING_URL) return apiEnv.MARKETING_URL;

  logError('microsites.micrositeOrigin', new Error('MARKETING_URL is unset'), {
    feature: 'microsites',
    extra: {
      fellBackTo: apiEnv.WEB_URL ?? null,
      why: 'Customer-facing links are being composed from WEB_URL. That is correct only where WEB_URL happens to be the marketing host; set MARKETING_URL.',
    },
  });
  return apiEnv.WEB_URL ?? '';
};

/**
 * The root of a tenant's SITE — the tier decision, in one place.
 *
 * On the tenant's own host the organization is implied by the hostname, so
 * there is no slug segment. On the path tier it is carried in the path.
 */
const micrositeBase = (target: MicrositeLinkTarget): string =>
  target.primaryDomain
    ? micrositeOrigin(target)
    : `${micrositeOrigin(target)}/sites/${encodeURIComponent(target.organizationSlug)}`;

/**
 * A clinic's booking flow.
 *
 * Hangs off the base like every other surface, so the tier decision is made
 * exactly once. Booking used to sit at a top-level `/book/{slug}` — inherited
 * from when it lived in the dashboard app — which meant one surface composed
 * its URL differently from the rest and the builders had to special-case it.
 * The old shape now 301s here.
 */
export const micrositeBookingBase = (target: MicrositeLinkTarget): string =>
  `${micrositeBase(target)}/book`;

/**
 * The booking URL to SEND someone, naming the BRANCH when one is known.
 *
 * Distinct from `micrositeBookingBase`, which is the un-branched root other
 * paths are composed onto (`/manage/{token}`, a service id). This one is the
 * finished link, so it is the one every "here is where you book" caller wants.
 *
 * `branchSegment` is `slug ?? id`, via `branchSegmentFor` in web-shared, the
 * same helper the microsite builds its own links with.
 *
 * OMITTING IT IS SAFE, NOT WRONG, on the same terms as
 * `micrositeServiceBookingUrl`: a branch-less URL lands on the entry rules, so
 * a multi-branch org gets the chooser and a single-branch org 302s to its one
 * branch. Nobody is booked into a branch nobody named. But when the caller DOES
 * know the branch, sending the un-branched shape spends a redirect the customer
 * did not need, and on a multi-branch clinic asks them a question the sender
 * already had the answer to.
 */
export const micrositeBookingUrl = (
  target: MicrositeLinkTarget,
  branchSegment?: string | null
): string =>
  branchSegment
    ? `${micrositeBase(target)}${branchBookingPath(branchSegment)}`
    : micrositeBookingBase(target);

/**
 * Booking a specific service, at a specific BRANCH when one is known.
 *
 * `branchSegment` is `slug ?? id` — see `branchSegmentFor` in web-shared, which
 * is the same helper the microsite's own pages build their links with.
 *
 * OMITTING IT IS SAFE, NOT WRONG. A branch-less URL lands on the entry rules:
 * a multi-branch org gets the chooser with the service carried through, and a
 * single-branch org 302s to its one branch. Nobody is silently booked into the
 * primary branch. But it is the right shape only when the caller genuinely does
 * not know — for Claire, who has already quoted THIS branch's price, sending it
 * means asking the customer a question she has the answer to.
 */
export const micrositeServiceBookingUrl = (
  target: MicrositeLinkTarget,
  serviceId: string,
  branchSegment?: string | null
): string =>
  branchSegment
    ? `${micrositeBase(target)}${branchBookingPath(branchSegment, serviceId)}`
    : `${micrositeBookingBase(target)}/${encodeURIComponent(serviceId)}`;

/** A clinic's customer portal home. */
export const micrositePortalBase = (target: MicrositeLinkTarget): string =>
  `${micrositeBase(target)}/portal`;
