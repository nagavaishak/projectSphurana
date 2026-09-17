/**
 * Meta Ads enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Meta campaign status labels
export const metaCampaignStatusLabels = {
  draft: 'Draft',
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  error: 'Error',
} as const;

export const metaCampaignStatusValues = Object.keys(
  metaCampaignStatusLabels
) as [
  keyof typeof metaCampaignStatusLabels,
  ...(keyof typeof metaCampaignStatusLabels)[],
];

export type MetaCampaignStatus = keyof typeof metaCampaignStatusLabels;

// Meta campaign objective labels
export const metaCampaignObjectiveLabels = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic',
} as const;

export const metaCampaignObjectiveValues = Object.keys(
  metaCampaignObjectiveLabels
) as [
  keyof typeof metaCampaignObjectiveLabels,
  ...(keyof typeof metaCampaignObjectiveLabels)[],
];

export type MetaCampaignObjective = keyof typeof metaCampaignObjectiveLabels;

// Meta ad status labels
export const metaAdStatusLabels = {
  draft: 'Draft',
  launching: 'Launching',
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  rejected: 'Rejected',
  error: 'Error',
} as const;

export const metaAdStatusValues = Object.keys(metaAdStatusLabels) as [
  keyof typeof metaAdStatusLabels,
  ...(keyof typeof metaAdStatusLabels)[],
];

export type MetaAdStatus = keyof typeof metaAdStatusLabels;

// Meta call to action labels
export const metaCallToActionLabels = {
  LEARN_MORE: 'Learn More',
  SHOP_NOW: 'Shop Now',
  SIGN_UP: 'Sign Up',
  CONTACT_US: 'Contact Us',
  WATCH_MORE: 'Watch More',
  BOOK_NOW: 'Book Now',
  GET_QUOTE: 'Get Quote',
  SUBSCRIBE: 'Subscribe',
  DOWNLOAD: 'Download',
  GET_OFFER: 'Get Offer',
  WHATSAPP_MESSAGE: 'Send WhatsApp Message',
} as const;

export const metaCallToActionValues = Object.keys(metaCallToActionLabels) as [
  keyof typeof metaCallToActionLabels,
  ...(keyof typeof metaCallToActionLabels)[],
];

export type MetaCallToAction = keyof typeof metaCallToActionLabels;

// Follow-up type labels
export const followUpTypeLabels = {
  sequence: 'Sequence',
  chatbot: 'Chatbot',
  email_only: 'Email Only',
  lead_form: 'Lead Form',
} as const;

export const followUpTypeValues = Object.keys(followUpTypeLabels) as [
  keyof typeof followUpTypeLabels,
  ...(keyof typeof followUpTypeLabels)[],
];

export type FollowUpType = keyof typeof followUpTypeLabels;

// Ad placement labels
export const adPlacementLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  both: 'Facebook & Instagram',
} as const;

export const adPlacementValues = Object.keys(adPlacementLabels) as [
  keyof typeof adPlacementLabels,
  ...(keyof typeof adPlacementLabels)[],
];

export type AdPlacement = keyof typeof adPlacementLabels;

// Conversion destination labels (active destinations only)
export const conversionDestinationLabels = {
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
} as const;

export const conversionDestinationValues = Object.keys(
  conversionDestinationLabels
) as [
  keyof typeof conversionDestinationLabels,
  ...(keyof typeof conversionDestinationLabels)[],
];

export type ConversionDestination = keyof typeof conversionDestinationLabels;

// All conversion destination values including deprecated ones (for DB enum backward compatibility)
export const conversionDestinationAllValues = [
  'messenger',
  'whatsapp',
  'instagram_direct',
] as const satisfies readonly [string, ...string[]];

export type ConversionDestinationAll =
  (typeof conversionDestinationAllValues)[number];

/**
 * Messaging destinations that can be selected for an ad. A campaign can
 * target any non-empty subset of these; the feature layer resolves the set
 * to Meta's combo `destination_type` at launch time (e.g. all three →
 * `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP`, `['whatsapp']` →
 * `WHATSAPP`).
 *
 * Non-messaging destinations (website, lead form, phone call) are out of
 * scope for the current project.
 */
export const messagingDestinationLabels = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram_dm: 'Instagram DM',
} as const;

export const messagingDestinationValues = Object.keys(
  messagingDestinationLabels
) as [
  keyof typeof messagingDestinationLabels,
  ...(keyof typeof messagingDestinationLabels)[],
];

export type MessagingDestination = keyof typeof messagingDestinationLabels;

// Meta integration status labels
export const metaIntegrationStatusLabels = {
  pending_selection: 'Pending Selection',
  configured: 'Configured',
} as const;

// Token status labels (shared by meta_ads_integration and instagram_integration)
export const tokenStatusLabels = {
  valid: 'Valid',
  needs_reconnect: 'Needs Reconnect',
} as const;

export const tokenStatusValues = Object.keys(tokenStatusLabels) as [
  keyof typeof tokenStatusLabels,
  ...(keyof typeof tokenStatusLabels)[],
];

export type TokenStatus = keyof typeof tokenStatusLabels;

export const metaIntegrationStatusValues = Object.keys(
  metaIntegrationStatusLabels
) as [
  keyof typeof metaIntegrationStatusLabels,
  ...(keyof typeof metaIntegrationStatusLabels)[],
];

export type MetaIntegrationStatus = keyof typeof metaIntegrationStatusLabels;

// Meta page platform labels
export const metaPagePlatformLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
} as const;

export const metaPagePlatformValues = Object.keys(metaPagePlatformLabels) as [
  keyof typeof metaPagePlatformLabels,
  ...(keyof typeof metaPagePlatformLabels)[],
];

export type MetaPagePlatform = keyof typeof metaPagePlatformLabels;
