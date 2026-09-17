/**
 * Shared secret + URL helpers for the public unsubscribe/tracking surface.
 * Sign (send side) and verify (public route) MUST use the same secret.
 */

export function getTrackingSecret(): string {
  const configured = process.env.CAMPAIGN_TRACKING_SECRET;
  if (configured) return configured;

  // The dev fallback is committed to the repo, so a token signed with it is
  // forgeable by anyone — an attacker could unsubscribe (or fabricate opens
  // and clicks for) any recipient. Fail closed rather than sign with it in
  // production; same policy as the Twilio/Resend webhook secrets.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CAMPAIGN_TRACKING_SECRET is not set — refusing to sign tracking tokens with the public dev fallback'
    );
  }
  return 'borradh-campaign-tracking-dev-secret-change-me';
}

/** Public base URL the unsubscribe/tracking routes are served from. */
export function getTrackingBaseUrl(): string {
  const configured =
    process.env.CAMPAIGN_PUBLIC_BASE_URL ?? process.env.API_URL;
  if (configured) return configured.replace(/\/$/, '');

  // Without this the unsubscribe link in a real campaign points at localhost,
  // which is both useless to the recipient and a CAN-SPAM/GDPR failure.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CAMPAIGN_PUBLIC_BASE_URL / API_URL is not set — refusing to build unsubscribe links pointing at localhost'
    );
  }
  return 'http://localhost:3000';
}

export function buildUnsubscribeUrl(token: string): string {
  return `${getTrackingBaseUrl()}/c/u/${token}`;
}
