import { getCreditCost } from '../../../billing/models/billing.types.js';

/**
 * Campaign cost estimation — reuses the billing credit meter's `getCreditCost`
 * so the pre-send estimate can never drift from the actual per-send debit.
 *
 * Pricing decision (locked): email + WhatsApp are FREE for campaigns; only SMS
 * is metered. Which channels are paid is a parameter (not hardcoded into the
 * debit) so a channel can be moved free↔paid by config without code changes.
 */

export type CampaignChannel = 'email' | 'sms' | 'whatsapp';

export interface ChannelCounts {
  email: number;
  sms: number;
  whatsapp: number;
}

/** Channels that consume credits for campaigns. */
export const CAMPAIGN_PAID_CHANNELS: readonly CampaignChannel[] = ['sms'];

export interface ChannelCostLine {
  recipients: number;
  /** internal 1/100-credit units (matches the credit meter) */
  rawUnits: number;
  /** human-facing credits (rawUnits / 100) */
  credits: number;
  metered: boolean;
}

export interface CostEstimate {
  totalRawUnits: number;
  totalCredits: number;
  perChannel: Record<CampaignChannel, ChannelCostLine>;
}

const CHANNELS: CampaignChannel[] = ['email', 'sms', 'whatsapp'];

export function estimateCampaignCost(
  counts: ChannelCounts,
  paidChannels: readonly CampaignChannel[] = CAMPAIGN_PAID_CHANNELS
): CostEstimate {
  const perChannel = {} as Record<CampaignChannel, ChannelCostLine>;
  let totalRawUnits = 0;

  for (const channel of CHANNELS) {
    const recipients = counts[channel] ?? 0;
    const metered = paidChannels.includes(channel);
    const rawUnits = metered ? getCreditCost(channel, recipients) : 0;
    totalRawUnits += rawUnits;
    perChannel[channel] = {
      recipients,
      rawUnits,
      credits: rawUnits / 100,
      metered,
    };
  }

  return {
    totalRawUnits,
    totalCredits: totalRawUnits / 100,
    perChannel,
  };
}
