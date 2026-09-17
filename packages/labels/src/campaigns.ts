/**
 * Messaging Campaign enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports (safe for frontend use)
 */

// Campaign type / preset
export const campaignTypeLabels = {
  intro_offer: 'Intro Offer',
  gmb_review: 'Google Review Request',
  custom: 'Custom',
} as const;

export const campaignTypeValues = Object.keys(campaignTypeLabels) as [
  keyof typeof campaignTypeLabels,
  ...(keyof typeof campaignTypeLabels)[],
];

export type CampaignType = keyof typeof campaignTypeLabels;

// Campaign lifecycle status
export const campaignStatusLabels = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  paused: 'Paused',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

export const campaignStatusValues = Object.keys(campaignStatusLabels) as [
  keyof typeof campaignStatusLabels,
  ...(keyof typeof campaignStatusLabels)[],
];

export type CampaignStatus = keyof typeof campaignStatusLabels;

// Channels a campaign can send through
export const campaignChannelLabels = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
} as const;

export const campaignChannelValues = Object.keys(campaignChannelLabels) as [
  keyof typeof campaignChannelLabels,
  ...(keyof typeof campaignChannelLabels)[],
];

export type CampaignChannel = keyof typeof campaignChannelLabels;

// Per-recipient send status
export const campaignRecipientStatusLabels = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  bounced: 'Bounced',
  opted_out: 'Opted Out',
  skipped: 'Skipped',
} as const;

export const campaignRecipientStatusValues = Object.keys(
  campaignRecipientStatusLabels
) as [
  keyof typeof campaignRecipientStatusLabels,
  ...(keyof typeof campaignRecipientStatusLabels)[],
];

export type CampaignRecipientStatus =
  keyof typeof campaignRecipientStatusLabels;

// Append-only tracking event types
export const campaignEventTypeLabels = {
  sent: 'Sent',
  delivered: 'Delivered',
  open: 'Opened',
  click: 'Clicked',
  unsubscribe: 'Unsubscribed',
  conversion: 'Converted',
  paused: 'Paused',
  resumed: 'Resumed',
} as const;

export const campaignEventTypeValues = Object.keys(campaignEventTypeLabels) as [
  keyof typeof campaignEventTypeLabels,
  ...(keyof typeof campaignEventTypeLabels)[],
];

export type CampaignEventType = keyof typeof campaignEventTypeLabels;

// Why a contact was suppressed (org-level opt-out list)
export const suppressionReasonLabels = {
  unsubscribe: 'Unsubscribed',
  stop: 'Replied STOP',
  bounce: 'Hard Bounce',
  complaint: 'Spam Complaint',
} as const;

export const suppressionReasonValues = Object.keys(suppressionReasonLabels) as [
  keyof typeof suppressionReasonLabels,
  ...(keyof typeof suppressionReasonLabels)[],
];

export type SuppressionReason = keyof typeof suppressionReasonLabels;

// WhatsApp template approval lifecycle (mirrors Meta status)
export const whatsappTemplateStatusLabels = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  paused: 'Paused',
  disabled: 'Disabled',
} as const;

export const whatsappTemplateStatusValues = Object.keys(
  whatsappTemplateStatusLabels
) as [
  keyof typeof whatsappTemplateStatusLabels,
  ...(keyof typeof whatsappTemplateStatusLabels)[],
];

export type WhatsappTemplateStatus = keyof typeof whatsappTemplateStatusLabels;

// Per-org Twilio number provisioning status
export const smsNumberStatusLabels = {
  provisioning: 'Provisioning',
  active: 'Active',
  failed: 'Failed',
  released: 'Released',
} as const;

export const smsNumberStatusValues = Object.keys(smsNumberStatusLabels) as [
  keyof typeof smsNumberStatusLabels,
  ...(keyof typeof smsNumberStatusLabels)[],
];

export type SmsNumberStatus = keyof typeof smsNumberStatusLabels;

// How an org sends campaign SMS. `alpha` = a branded alphanumeric sender ID
// (outbound only, no number bought, no regulatory bundle — the marketing v1
// default). `number` = a dedicated provisioned number (two-way, for the future
// receptionist path). See docs/plans/sms-alphanumeric-v1.md.
export const smsSenderModeLabels = {
  alpha: 'Alphanumeric Sender ID',
  number: 'Dedicated Number',
} as const;

export const smsSenderModeValues = Object.keys(smsSenderModeLabels) as [
  keyof typeof smsSenderModeLabels,
  ...(keyof typeof smsSenderModeLabels)[],
];

export type SmsSenderMode = keyof typeof smsSenderModeLabels;
