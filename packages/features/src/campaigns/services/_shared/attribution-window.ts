/**
 * Conversion attribution for campaigns (v1: bookings + deposits).
 *
 * A conversion (a booking/deposit on a lead) is attributed to the most recent
 * campaign send to that lead that occurred WITHIN the attribution window before
 * the conversion. Pure functions so the windowing is unit-testable without a DB.
 */

export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14;

const dayMs = 24 * 60 * 60 * 1000;

/** Is `convertedAt` within `windowDays` after `sentAt` (and not before it)? */
export function isWithinAttributionWindow(
  sentAt: Date,
  convertedAt: Date,
  windowDays: number = DEFAULT_ATTRIBUTION_WINDOW_DAYS
): boolean {
  const delta = convertedAt.getTime() - sentAt.getTime();
  if (delta < 0) return false;
  return delta <= windowDays * dayMs;
}

export interface CampaignSend {
  campaignId: string;
  sentAt: Date;
}

/**
 * Last-touch attribution: of all sends to a lead, pick the campaign whose send
 * is the latest one that still falls within the window before the conversion.
 * Returns null if no send qualifies.
 */
export function attributeConversion(
  sends: CampaignSend[],
  convertedAt: Date,
  windowDays: number = DEFAULT_ATTRIBUTION_WINDOW_DAYS
): string | null {
  let best: CampaignSend | null = null;
  for (const send of sends) {
    if (!isWithinAttributionWindow(send.sentAt, convertedAt, windowDays)) {
      continue;
    }
    if (!best || send.sentAt.getTime() > best.sentAt.getTime()) {
      best = send;
    }
  }
  return best?.campaignId ?? null;
}
