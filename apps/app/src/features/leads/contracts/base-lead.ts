import {
  type Lead,
  type LeadListItem,
  defineFixture,
  leadListItemSchema,
  leadSchema,
} from '@borradh-workspace/contracts';

/**
 * A valid `lead` atom, on the wire (dates as ISO strings). Built through
 * `defineFixture(leadSchema, …)` so the base itself is validated by the SAME
 * schema the runtime parses responses with — if a DB column changes and the
 * atom regenerates, an out-of-date base fails to construct here.
 */
export const aLead: (overrides?: Partial<Lead>) => Lead = defineFixture(
  leadSchema,
  {
    id: 'lead_1',
    organizationId: 'org_1',
    // Added by the location-focused redesign (Phase 1): a lead's home branch,
    // nullable — a lead is not owned by a location.
    primaryLocationId: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    whatsapp: null,
    source: 'manual',
    status: 'new',
    facebookLeadId: null,
    psid: null,
    formData: null,
    sequenceId: null,
    sequenceStatus: null,
    currentStepId: null,
    sequenceStartedAt: null,
    nextActionAt: null,
    assignedToId: null,
    tags: ['vip'],
    notes: null,
    portalNote: null,
    metadata: null,
    humanTakeoverRequested: false,
    humanTakeoverReason: null,
    humanTakeoverAt: null,
    consentEmail: true,
    consentSms: false,
    consentVoice: false,
    consentSource: null,
    consentedAt: null,
    lastContactedAt: null,
    convertedAt: null,
    lastVisitAt: null,
    lifetimeSpendCents: 0,
    listRank: 0,
    // Microsite attribution. `micrositeId` and NOT a host — a tenant moving
    // from salon.borradh.io to salon.com must not split their own attribution
    // history in two.
    micrositeId: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
  }
);

/**
 * A lead as the LIST returns it — the atom plus the server-derived `stage`.
 * List fixtures must go through this, not `aLead`: `stage` is required on the
 * list projection and absent from the atom, so building a list response out of
 * atoms is exactly the drift this fixture exists to catch.
 */
export const aLeadListItem: (
  overrides?: Partial<LeadListItem>
) => LeadListItem = defineFixture(leadListItemSchema, {
  ...aLead(),
  stage: 'new',
});
