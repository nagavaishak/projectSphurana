import {
  type EligibilityLead,
  type SuppressionIndex,
  contactForChannel,
  isChannelEligible,
} from './channel-eligibility.js';
import {
  type MergeData,
  interpolateCampaignBody,
} from './interpolate-campaign-body.js';

/**
 * The pure decision core of the per-recipient send primitive. The IO wrapper
 * (status claim, provider call, credit debit, event write) calls this to decide
 * WHAT to do; keeping it pure makes the gating logic unit-testable without a DB
 * or any provider.
 */

export type SendChannel = 'email' | 'sms' | 'whatsapp';

export type SendAction =
  | 'send'
  | 'skip_not_queued' // already claimed/sent (idempotency)
  | 'skip_ineligible'; // consent missing, no contact, or suppressed

export interface PlanSendInput {
  recipientStatus: string;
  channel: SendChannel;
  lead: EligibilityLead;
  suppression: SuppressionIndex;
  bodyTemplate: string;
  subjectTemplate?: string;
  mergeData: MergeData;
  /**
   * WhatsApp template send (business-initiated). `params` are the raw
   * {{1}}..{{n}} values as authored — each may contain campaign merge tags
   * ({{firstName|there}}) that this plan interpolates per lead.
   */
  whatsappTemplate?: {
    name: string;
    languageCode: string;
    params: string[];
  };
}

export interface SendPlan {
  action: SendAction;
  contact?: string;
  body?: string;
  subject?: string;
  /** Interpolated template dispatch args (WhatsApp template sends only). */
  whatsappTemplate?: {
    name: string;
    languageCode: string;
    parameters: string[];
  };
}

/** Map a lead row to the merge fields available to campaign copy. */
export function buildLeadMergeData(lead: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): MergeData {
  return {
    firstName: lead.firstName ?? undefined,
    lastName: lead.lastName ?? undefined,
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
  };
}

export function planSend(input: PlanSendInput): SendPlan {
  // Idempotency: only act on a freshly-queued recipient. Anything else means
  // another worker already claimed/sent it.
  if (input.recipientStatus !== 'queued') {
    return { action: 'skip_not_queued' };
  }

  if (!isChannelEligible(input.lead, input.channel, input.suppression)) {
    return { action: 'skip_ineligible' };
  }

  const contact = contactForChannel(input.lead, input.channel);
  if (!contact) return { action: 'skip_ineligible' };

  return {
    action: 'send',
    contact,
    body: interpolateCampaignBody(input.bodyTemplate, input.mergeData),
    subject: input.subjectTemplate
      ? interpolateCampaignBody(input.subjectTemplate, input.mergeData)
      : undefined,
    whatsappTemplate: input.whatsappTemplate
      ? {
          name: input.whatsappTemplate.name,
          languageCode: input.whatsappTemplate.languageCode,
          parameters: input.whatsappTemplate.params.map((p) =>
            interpolateCampaignBody(p, input.mergeData)
          ),
        }
      : undefined,
  };
}
