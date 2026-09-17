import { createHash, randomBytes } from 'node:crypto';
import {
  type MicrositeLinkTarget,
  micrositeBookingBase,
} from '../../shared/index.js';

/**
 * Primitives for the patient-facing manage-booking capability.
 *
 * The raw token exists exactly twice: once in the email we send, and once in
 * the URL the patient clicks. It is never stored. What we persist is
 * `hashManageToken(raw)`, so a dump of `appointment_manage_token` yields no
 * working links.
 */

/** 256 bits of entropy, URL-safe. Not guessable, not enumerable. */
export const generateManageToken = (): string =>
  randomBytes(32).toString('base64url');

/**
 * SHA-256, hex. No salt and no KDF on purpose: the input is 256 bits of CSPRNG
 * output, so there is no dictionary to attack and nothing for a slow hash to
 * buy us. A salt would also break the point-lookup by hash that this exists to
 * enable.
 */
export const hashManageToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken).digest('hex');

/**
 * How long a link stays alive, measured from the appointment's END.
 *
 * Deliberately positive rather than zero: a patient who no-showed, or who opens
 * the link on the drive home, should see "this appointment has passed" rather
 * than a dead 404 that reads like we lost their booking.
 */
export const MANAGE_TOKEN_GRACE_DAYS = 30;

export const manageTokenExpiryFor = (appointmentEnd: Date): Date =>
  new Date(
    appointmentEnd.getTime() + MANAGE_TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000
  );

/**
 * The link that goes in the patient's email.
 *
 * BOOKING MOVED onto the tenant's microsite, served by the marketing app, so
 * this is `{WEB_URL}/sites/{slug}/book/manage/{token}`. It shares
 * `micrositeBookingBase` with the booking page Claire sends, so a clinic's
 * patients never see two different hosts for the same booking — the property
 * the previous comment claimed and which is now enforced by sharing the
 * builder rather than by both sides spelling the same string.
 *
 * The tenant's host comes in as a `MicrositeLinkTarget` the caller resolved
 * (`resolveMicrositeLinkTarget`), so a clinic with a live custom domain sends
 * its patients to THEIR host and everyone else keeps the path tier.
 *
 * NOTE for whoever rebases: PR #854 (ENG-770) moved this to
 * `APP_URL ?? WEB_URL`, because at that time `/book/:slug/manage/:token`
 * existed ONLY in apps/app and a WEB_URL link silently 404'd. That fix is
 * superseded here — the route moved to the marketing host. Expect a conflict
 * and keep THIS version; taking #854's would 404 every manage link again.
 */
export const buildManageBookingUrl = (
  target: MicrositeLinkTarget,
  rawToken: string
): string =>
  `${micrositeBookingBase(target)}/manage/${encodeURIComponent(rawToken)}`;
