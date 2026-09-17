import { createHash, randomBytes } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';

/**
 * Access primitives for an intake submission's fill-in link — the same bearer
 * pattern as the appointment manage-token: the raw token lives only in the
 * email/SMS and the URL, never in the database, which stores its SHA-256.
 */

export const generateIntakeToken = (): string =>
  randomBytes(32).toString('base64url');

export const hashIntakeToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken).digest('hex');

/**
 * The link the patient clicks to fill in a form. Built on the same host as the
 * booking page so a clinic's patients never see two different domains.
 *
 * Built on the app host (`APP_URL`), NOT the marketing site (`WEB_URL`,
 * www.borradh.io): this route is served only by `apps/app`, so a WEB_URL link
 * lands every recipient on the marketing 404. Same resolution and preview-only
 * fallback as `buildManageBookingUrl` (ENG-770).
 */
export const buildIntakeFormUrl = (
  organizationSlug: string,
  rawToken: string
): string =>
  `${apiEnv.APP_URL ?? apiEnv.WEB_URL}/forms/${organizationSlug}/${encodeURIComponent(rawToken)}`;
