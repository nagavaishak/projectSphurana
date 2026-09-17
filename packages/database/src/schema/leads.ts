import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { user } from './user.js';

import { orgRlsPolicy, patientSelfRlsPolicy } from '../rls-policy.js';

// Import labels from enums (pure TypeScript)
import {
  allLeadStatusValues,
  consentSourceLabels,
  consentSourceValues,
  leadSourceLabels,
  leadSourceValues,
  leadStatusLabels,
  leadStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  leadStatusLabels,
  leadStatusValues,
  leadSourceLabels,
  leadSourceValues,
  consentSourceLabels,
  consentSourceValues,
};
export type {
  LeadStatus,
  LeadSource,
  ConsentSource,
} from '@borradh-workspace/labels';

// Database enums.
// `lead_status` keeps the FULL historical membership (`allLeadStatusValues`, 9
// values in original creation order) even though the active UI/write vocabulary
// (`leadStatusValues`) is now only 4. Dropping a pg enum value forces a type
// rewrite, so the retired values stay in the type; validation rejects them.
export const leadStatusEnum = pgEnum('lead_status', allLeadStatusValues);
export const leadSourceEnum = pgEnum('lead_source', leadSourceValues);
export const consentSourceEnum = pgEnum('consent_source', consentSourceValues);

export const lead = pgTable(
  'lead',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    source: leadSourceEnum('source').notNull().default('manual'),
    status: leadStatusEnum('status').notNull().default('new'),
    facebookLeadId: text('facebook_lead_id'),
    // Messenger/Instagram PSID/IGSID for conversation-originated leads.
    // Kept distinct from facebookLeadId (which holds the Meta leadgen_id for
    // lead-form leads) — overloading one column made follow-up conversations
    // fail to link back to their originating lead-form lead.
    psid: text('psid'),
    formData: jsonb('form_data'),
    sequenceId: text('sequence_id'),
    sequenceStatus: text('sequence_status'),
    currentStepId: text('current_step_id'),
    sequenceStartedAt: timestamp('sequence_started_at'),
    nextActionAt: timestamp('next_action_at'),
    assignedToId: text('assigned_to_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /**
     * "Home branch" — NOT ownership. A person is not owned by a branch; actual
     * attendance is derived from their appointments. This exists so the
     * Customers list can rank/filter by branch, and the list filter is
     * deliberately "home branch OR has an appointment at this branch" so a
     * customer seen at two branches is never hidden (plan §2.2.1).
     *
     * Stays nullable: a lead with no bookings has no home branch yet.
     */
    primaryLocationId: text('primary_location_id').references(
      () => organizationLocation.id,
      { onDelete: 'set null' }
    ),
    tags: text('tags').array(),
    // STAFF-INTERNAL. Never expose this to the customer portal: every existing
    // row was written on the assumption no customer would read it.
    notes: text('notes'),
    // Customer-facing note, shown to the customer in their portal (ENG-647).
    // Deliberately a separate column from `notes` rather than a visibility flag
    // on it, so internal commentary can never leak by a query or filter slip.
    portalNote: text('portal_note'),
    metadata: jsonb('metadata'),
    // Human takeover fields
    humanTakeoverRequested: boolean('human_takeover_requested').default(false),
    humanTakeoverReason: text('human_takeover_reason'),
    humanTakeoverAt: timestamp('human_takeover_at'),
    // Consent tracking fields
    consentEmail: boolean('consent_email').default(false).notNull(),
    consentSms: boolean('consent_sms').default(false).notNull(),
    consentVoice: boolean('consent_voice').default(false).notNull(),
    consentSource: consentSourceEnum('consent_source'),
    consentedAt: timestamp('consented_at'),
    /**
     * MICROSITE ATTRIBUTION (plan §9, §11).
     *
     * `micrositeId` — NOT the host. A tenant moving from `salon.borradh.io` to
     * `salon.com` keeps one attribution history; keying on the host would split
     * it in two at the exact moment they start spending on their own brand.
     * The host is derived at read time from `microsite_domain`.
     */
    micrositeId: text('microsite_id'),
    /**
     * UTMs as they arrived on the landing URL. `utmCampaign` carries the META
     * CAMPAIGN ID, not the campaign's display name — the name is editable and a
     * rename would silently orphan every lead booked before it. The id is the
     * join key into `meta_campaign_daily_insights.meta_campaign_id`, which is
     * what makes CAC computable without asking Meta.
     */
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    // Last time any outbound campaign/sequence message was sent to this lead.
    // Powers segment recency filters (re-engagement windows) and is set by the
    // campaign send pipeline.
    lastContactedAt: timestamp('last_contacted_at'),
    // Customer lifecycle (Customers surface). Denormalised onto the lead so tab
    // filters and the Booked/Customers views stay indexable — joining to sale /
    // appointment on every list request would not stay fast.
    // Stamped once, on the FIRST booking of any kind OR the first paid sale
    // (whichever is earlier), and never re-stamped. Maintained by the
    // appointment + sale write paths (Phase 2) and by the Phase 1 backfill.
    convertedAt: timestamp('converted_at'),
    lastVisitAt: timestamp('last_visit_at'),
    lifetimeSpendCents: integer('lifetime_spend_cents').notNull().default(0),
    // Message-only ranking. Rank 0 = a real record (converted, imported, hand-
    // entered, left a contact detail, or from a non-message source); rank 1 =
    // a PSID-only Messenger/Instagram/WhatsApp contact with no email/phone.
    // GENERATED so it needs no write-path maintenance — every input already
    // sits on the row, and `converted_at` (the one time-varying input) is
    // maintained by the conversion hooks, so a message-only contact who later
    // books climbs out of the tail automatically.
    // Physical column names in the expression on purpose — a generated column
    // may reference other columns of its own row, and `lead` is not yet bound
    // while this table literal is being constructed.
    listRank: smallint('list_rank').generatedAlwaysAs(
      sql`(CASE WHEN converted_at IS NOT NULL OR source NOT IN ('facebook','instagram','whatsapp') OR (email IS NOT NULL AND email <> '') OR (phone IS NOT NULL AND phone <> '') THEN 0 ELSE 1 END)`
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_lead_org_id').on(table.organizationId),
    index('idx_lead_assigned_to_id').on(table.assignedToId),
    index('idx_lead_psid').on(table.psid),
    // Tab / stage filtering.
    index('idx_lead_org_status').on(table.organizationId, table.status),
    // Customers-tab and segment recency, partial to skip soft-deleted rows.
    index('idx_lead_org_converted_at')
      .on(table.organizationId, table.convertedAt)
      .where(sql`deleted_at IS NULL`),
    // The default list ordering: real records first (list_rank 0), newest first;
    // message-only contacts (list_rank 1) fall to the tail.
    index('idx_lead_org_list_rank')
      .on(table.organizationId, table.listRank, table.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    // The CAC join: leads for one org in one window, bucketed by campaign.
    index('idx_lead_utm_campaign').on(table.organizationId, table.utmCampaign),
    index('idx_lead_microsite_id').on(table.micrositeId),
    index('idx_lead_org_primary_location').on(
      table.organizationId,
      table.primaryLocationId
    ),
    // Meta's leadgen_id is unique per organization. This is the ONLY thing that
    // actually stops a duplicate: both Meta ingestion paths (the leadgen
    // webhook and the reconciliation poll) dedupe with a SELECT before the
    // INSERT, and at a 5-minute poll interval the two can race for the same
    // lead — both passing the check before either writes. That produces two
    // lead rows AND two Claire openers to the same person, because the
    // first-touch job id is derived from the lead id.
    //
    // Partial on `deleted_at IS NULL` so a soft-deleted lead does not block
    // re-importing the same Meta lead later.
    uniqueIndex('uq_lead_org_facebook_lead_id')
      .on(table.organizationId, table.facebookLeadId)
      .where(sql`facebook_lead_id IS NOT NULL AND deleted_at IS NULL`),
  ]
);

export const leadRlsPolicy = orgRlsPolicy(lead);
/** Patient portal (ENG-647): a signed-in patient may read their OWN lead row
 * only. Auxiliary policy, TO app_patient — invisible to staff/public roles. */
export const leadPatientSelfPolicy = patientSelfRlsPolicy(lead, { fk: 'id' });

export type Lead = typeof lead.$inferSelect;
export type NewLead = typeof lead.$inferInsert;
