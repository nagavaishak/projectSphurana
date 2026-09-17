/**
 * Lead enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Lead pipeline stages — SOURCE OF TRUTH for the UI vocabulary and for write
// validation. The ordered funnel behind the Clients surface tabs:
//   new (Leads) → contacted → qualified → booked | lost
// A lead is `contacted` once we reach out, `qualified` once they reply, and
// `booked` once they book or pay (see `converted_at`). `lost` stays a valid
// status for display, but the stage dropdown only offers the four pipeline
// stages (see `pipelineLeadStatusValues`) and `lost` has no tab of its own.
export const leadStatusLabels = {
  new: 'Incoming Lead',
  contacted: 'Contacted',
  qualified: 'Qualified',
  booked: 'Booked',
  lost: 'Lost',
} as const;

export const leadStatusValues = Object.keys(leadStatusLabels) as [
  keyof typeof leadStatusLabels,
  ...(keyof typeof leadStatusLabels)[],
];

export type LeadStatus = keyof typeof leadStatusLabels;

// The stages the Clients stage dropdown offers, in funnel order. Excludes
// `lost` — a lead is marked lost from the row menu, not this picker — so the
// picker reads as a clean four-step pipeline.
export const pipelineLeadStatusValues = [
  'new',
  'contacted',
  'qualified',
  'booked',
] as const satisfies readonly LeadStatus[];

// Retired stage values from the old sales-funnel vocabulary. Retained ONLY so
// the pg `lead_status` enum keeps them — dropping a pg enum value forces a type
// rewrite (see .claude/rules/database/drizzle-orm.md). They are never shown,
// never a valid write target (update-lead rejects them), and the Phase 1
// backfill migration maps every existing row off them:
//   proposal | negotiation → contacted,  won → booked,  cold → lost
export const retiredLeadStatusValues = [
  'proposal',
  'negotiation',
  'won',
  'cold',
] as const;

// The FULL enum membership in the EXACT order the pg `lead_status` enum was
// originally created. The Drizzle pgEnum MUST derive from this, not from
// `leadStatusValues`, or a `drizzle-kit generate` would try to drop the retired
// values and fail. Order = original creation order — do not reorder.
export const allLeadStatusValues = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'booked',
  'cold',
] as const;

export type AllLeadStatus = (typeof allLeadStatusValues)[number];

// Tab → the active stages it shows. The "All" tab applies no stage filter and
// is handled separately by the list service (it must show `lost` too), so it is
// intentionally absent from this record. Tabs never surface retired values.
export const leadStageGroups = {
  leads: ['new'],
  contacted: ['contacted', 'qualified'],
  booked: ['booked'],
} as const satisfies Record<string, readonly LeadStatus[]>;

export const leadStageGroupValues = [
  'all',
  'leads',
  'contacted',
  'booked',
] as const;

export type LeadStageGroup = (typeof leadStageGroupValues)[number];

// Collapse any stored status (including retired sales-funnel values still in
// the pg enum) onto an active stage. proposal/negotiation are retired synonyms
// for contacted, won for booked, cold for lost; every current stage — including
// the revived `qualified` — passes straight through.
export function normalizeLeadStage(status: AllLeadStatus): LeadStatus {
  switch (status) {
    case 'proposal':
    case 'negotiation':
      return 'contacted';
    case 'won':
      return 'booked';
    case 'cold':
      return 'lost';
    default:
      return status;
  }
}

/** Display label for any stored status, retired values included. */
export function leadStatusLabel(status: AllLeadStatus): string {
  return leadStatusLabels[normalizeLeadStage(status)];
}

// Lead source labels
export const leadSourceLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  website: 'Website',
  manual: 'Manual',
  referral: 'Referral',
  other: 'Other',
  meta_lead_form: 'Meta Lead Form',
} as const;

export const leadSourceValues = Object.keys(leadSourceLabels) as [
  keyof typeof leadSourceLabels,
  ...(keyof typeof leadSourceLabels)[],
];

export type LeadSource = keyof typeof leadSourceLabels;

// Consent source labels
export const consentSourceLabels = {
  meta_form: 'Meta Lead Form',
  manual_entry: 'Manual Entry',
  csv_import: 'CSV Import',
  grandfathered: 'Grandfathered',
  user_update: 'User Update',
  booking_form: 'Booking Form',
  incoming_message: 'Incoming Message',
} as const;

export const consentSourceValues = Object.keys(consentSourceLabels) as [
  keyof typeof consentSourceLabels,
  ...(keyof typeof consentSourceLabels)[],
];

export type ConsentSource = keyof typeof consentSourceLabels;
