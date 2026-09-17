import type { CampaignChannel } from './api/types';

/**
 * Channels bulk messaging currently offers.
 *
 * Email and WhatsApp are live. SMS is **paused, not removed** — every backend
 * path still works (Twilio senders, webhooks, number provisioning, the
 * `campaign_channel` enum), and campaigns already sent on SMS keep rendering
 * their history. Re-enabling SMS is this one list (blocked on Twilio/10DLC).
 *
 * WhatsApp is business-initiated: the composer sends a pre-approved Meta
 * template outside the 24-hour window (templates are registered + managed in
 * Settings → Message templates). Free-form WhatsApp only reaches contacts
 * inside the 24h customer-service window.
 *
 * Deliberately a UI-side gate: the API still accepts every channel, so an
 * in-flight or scheduled SMS send is not broken by this change.
 */
export const ENABLED_CHANNELS: CampaignChannel[] = ['email', 'whatsapp'];

export const isChannelEnabled = (channel: CampaignChannel): boolean =>
  ENABLED_CHANNELS.includes(channel);
