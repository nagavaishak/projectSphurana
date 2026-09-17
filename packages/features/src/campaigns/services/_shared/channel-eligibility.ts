import type { CampaignChannel } from '@borradh-workspace/database';

/**
 * Per-channel send-eligibility — the consent + suppression gate that backs the
 * "consent-aware sending" promise. Pure functions so they're trivially testable
 * and reused at both segment-preview and recipient-materialization time.
 */

/** The minimal lead shape eligibility needs (a subset of the lead row). */
export interface EligibilityLead {
  id: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  consentEmail: boolean;
  consentSms: boolean;
}

/**
 * Suppressed contacts, per channel — normalized (see `normalizeContact`).
 * A contact present here has opted out / hard-bounced / complained and must
 * never be sent to, regardless of the lead's consent flags.
 */
export interface SuppressionIndex {
  email: Set<string>;
  sms: Set<string>;
  whatsapp: Set<string>;
}

export const emptySuppressionIndex = (): SuppressionIndex => ({
  email: new Set(),
  sms: new Set(),
  whatsapp: new Set(),
});

/**
 * Normalize a contact so suppression matching is robust to formatting:
 * emails are lower-cased/trimmed; phone/WhatsApp numbers are reduced to digits
 * (keeping a leading `+`), so `+1 (555) 010-1234` and `+15550101234` match.
 */
export function normalizeContact(
  channel: CampaignChannel,
  value: string
): string {
  if (channel === 'email') return value.trim().toLowerCase();
  // sms / whatsapp → phone-ish
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * The contact value a given channel sends to (or null if the lead has none).
 *
 * WhatsApp falls back to `phone`: a Meta lead form returns one number under the
 * standard `phone_number` field, which is what the webhook writes to `phone` —
 * `whatsapp` is only ever populated when a lead messages us there first. Without
 * this fallback WhatsApp is ineligible for every real lead-form lead. WhatsApp
 * is a channel on a number, not a separate identity.
 */
export function contactForChannel(
  lead: EligibilityLead,
  channel: CampaignChannel
): string | null {
  switch (channel) {
    case 'email':
      return lead.email;
    case 'sms':
      return lead.phone;
    case 'whatsapp':
      return lead.whatsapp ?? lead.phone;
    default:
      return null;
  }
}

/**
 * Is this lead eligible to receive on this channel?
 *
 * - email   → consentEmail + has email + not suppressed
 * - sms     → consentSms + has phone + not suppressed
 * - whatsapp→ has a WhatsApp or phone number + not suppressed (24h-window /
 *             opt-in is enforced at send time against the live conversation
 *             state)
 */
export function isChannelEligible(
  lead: EligibilityLead,
  channel: CampaignChannel,
  suppression: SuppressionIndex = emptySuppressionIndex()
): boolean {
  const contact = contactForChannel(lead, channel);
  if (!contact) return false;

  if (channel === 'email' && !lead.consentEmail) return false;
  if (channel === 'sms' && !lead.consentSms) return false;

  const suppressed = suppression[channel];
  if (suppressed.has(normalizeContact(channel, contact))) return false;

  return true;
}

/** The subset of `channels` this lead can actually be reached on. */
export function eligibleChannels(
  lead: EligibilityLead,
  channels: CampaignChannel[],
  suppression: SuppressionIndex = emptySuppressionIndex()
): CampaignChannel[] {
  return channels.filter((c) => isChannelEligible(lead, c, suppression));
}

/** Build a {@link SuppressionIndex} from raw suppression rows. */
export function buildSuppressionIndex(
  rows: Array<{ channel: CampaignChannel; contact: string }>
): SuppressionIndex {
  const idx = emptySuppressionIndex();
  for (const row of rows) {
    idx[row.channel].add(normalizeContact(row.channel, row.contact));
  }
  return idx;
}
