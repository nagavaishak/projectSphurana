/**
 * Integration enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Integration type labels
export const integrationTypeLabels = {
  facebook_leads: 'Facebook Leads',
  facebook_ads: 'Facebook Ads',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  voice: 'Voice',
  gmail: 'Gmail',
  outlook: 'Outlook',
  google_calendar: 'Google Calendar',
  meta_ads: 'Meta Ads',
} as const;

export const integrationTypeValues = Object.keys(integrationTypeLabels) as [
  keyof typeof integrationTypeLabels,
  ...(keyof typeof integrationTypeLabels)[],
];

export type IntegrationType = keyof typeof integrationTypeLabels;
