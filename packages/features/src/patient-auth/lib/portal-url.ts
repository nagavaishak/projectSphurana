import {
  type MicrositeLinkTarget,
  micrositePortalBase,
} from '../../shared/index.js';

/**
 * Links into a clinic's customer portal.
 *
 * THE PORTAL MOVED. It used to be a route in `apps/app`
 * (`app.borradh.io/portal/{slug}/…`); it is now part of the tenant's MICROSITE,
 * served by the marketing app.
 *
 * The host is no longer decided here. It arrives as a `MicrositeLinkTarget` the
 * caller resolved once (`resolveMicrositeLinkTarget` /
 * `resolveMicrositeLinkTargets`), and `micrositePortalBase` in
 * `shared/microsite-links.ts` turns it into `https://{their-host}/portal/…` for
 * a tenant with a live primary custom domain, or the path tier
 * `{WEB_URL}/sites/{slug}/portal/…` for everyone else.
 *
 * This file used to carry its OWN copy of `micrositePortalBase` — exactly the
 * per-context duplication ENG-770 was about. It now delegates, so the tier
 * decision lives in one place.
 *
 * NOTE for whoever rebases this branch: PR #854 (ENG-770) moved this builder to
 * `APP_URL ?? WEB_URL`, because at that time `/portal` existed only in the app
 * and a WEB_URL link 404'd. That fix was correct then and is superseded here —
 * the route genuinely moved to the marketing host. Expect a conflict and keep
 * THIS version.
 */

/** The portal home — the "your patient portal" link in emails. */
export const buildPortalHomeUrl = (target: MicrositeLinkTarget): string =>
  micrositePortalBase(target);

/**
 * Direct sign-in (magic link) URL — the `/access` route consumes the raw
 * `magic_link` token and exchanges it for a session.
 */
export const buildPortalAccessUrl = (
  target: MicrositeLinkTarget,
  rawToken: string
): string =>
  `${micrositePortalBase(target)}/access?token=${encodeURIComponent(rawToken)}`;
