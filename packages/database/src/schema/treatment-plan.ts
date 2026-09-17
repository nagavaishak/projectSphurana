/**
 * Treatment plans — the patient-facing half of a clinical encounter.
 *
 * ## Why this is NOT a fourth kind of `form`
 *
 * A form template is a LIST OF FIELDS that someone answers. A treatment-plan
 * template is a DOCUMENT — prose with placeholders that fill from a note. Same
 * domain, genuinely different shape, so it gets its own tables. Unifying the
 * form engine was right; unifying this into it would be pattern-matching on
 * the word "template".
 *
 * ## The separation is the safety property
 *
 * A clinical note is never patient-visible (`form_note_never_patient_visible`).
 * The clinician writes the record in their own language — differential
 * diagnoses, uncertainty, things a patient would misread — and then decides
 * separately what the patient is told. One artefact serving both audiences is
 * what produces notes that are either useless as a record or alarming to read.
 *
 * So the plan is GENERATED from a note, edited, and only then published. It is
 * a derived document, and it carries its own delivery record because "we sent
 * you aftercare instructions on the 14th" is itself evidence.
 */

import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { orgRlsPolicy, patientSelfRlsPolicy } from '../rls-policy.js';
import { form, formSubmission } from './form.js';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { user } from './user.js';

/* -------------------------------------------------------------- template -- */

export const treatmentPlanTemplate = pgTable(
  'treatment_plan_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Rich text carrying `{{placeholder}}` tokens resolved from the note. */
    body: text('body').notNull().default(''),
    /**
     * Attach to a note template and "Generate treatment plan" uses this one
     * without anybody choosing. The common case should need no decision.
     */
    formId: text('form_id').references(() => form.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_treatment_plan_template_org').on(table.organizationId)]
);

export const treatmentPlanTemplateRlsPolicy = orgRlsPolicy(
  treatmentPlanTemplate
);

/* ------------------------------------------------------------------ plan -- */

export const treatmentPlanStatusEnum = pgEnum('treatment_plan_status', [
  'draft',
  'published',
]);

export const treatmentPlan = pgTable(
  'treatment_plan',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /**
     * The note this was generated from. `restrict`, not `cascade`: a plan the
     * patient has already been sent must not vanish because the source note
     * was tidied up.
     */
    submissionId: text('submission_id')
      .notNull()
      .references(() => formSubmission.id, { onDelete: 'restrict' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Placeholders already resolved — what the patient actually reads. */
    body: text('body').notNull().default(''),
    status: treatmentPlanStatusEnum('status').notNull().default('draft'),
    publishedAt: timestamp('published_at'),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_treatment_plan_lead').on(table.leadId),
    index('idx_treatment_plan_submission').on(table.submissionId),
  ]
);

export const treatmentPlanRlsPolicy = orgRlsPolicy(treatmentPlan);

/**
 * The portal read. Narrowed to PUBLISHED: a draft is the clinician still
 * deciding what to say, and a patient reading it mid-edit is the same class of
 * mistake as letting them read the note.
 */
export const treatmentPlanPatientSelfPolicy = patientSelfRlsPolicy(
  treatmentPlan,
  { andSql: sql`treatment_plan.status = 'published'` }
);

/* -------------------------------------------------------------- delivery -- */

/**
 * Email and portal are the obvious two and the wrong default. Measured against
 * the production customer base: Instagram and WhatsApp ARE the front desk —
 * 61 of 84 live sites embed Instagram, 20 orgs carry a WhatsApp number, and
 * WhatsApp is specifically where aftercare happens (the bruise photo at 22:00,
 * the "is this normal?" on day three).
 *
 * A plan that can only be emailed is a plan most of these clinics will not
 * send, because it is not where they talk to their patients.
 */
export const treatmentPlanChannelEnum = pgEnum('treatment_plan_channel', [
  'email',
  'portal',
  'whatsapp',
  'sms',
]);

/**
 * What was sent, to whom, when. Its own table rather than `audit_log` because
 * it is not diagnostic history — it is the answer to "was the patient given
 * aftercare instructions", which is a question asked in complaints.
 */
export const treatmentPlanDelivery = pgTable(
  'treatment_plan_delivery',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    treatmentPlanId: text('treatment_plan_id')
      .notNull()
      .references(() => treatmentPlan.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channel: treatmentPlanChannelEnum('channel').notNull(),
    /** Null for portal — the portal recipient is the lead on the plan. */
    recipientEmail: text('recipient_email'),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    sentById: text('sent_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('idx_treatment_plan_delivery_plan').on(table.treatmentPlanId),
  ]
);

export const treatmentPlanDeliveryRlsPolicy = orgRlsPolicy(
  treatmentPlanDelivery
);

/* ------------------------------------------------------------- relations -- */

export const treatmentPlanRelations = relations(
  treatmentPlan,
  ({ one, many }) => ({
    submission: one(formSubmission, {
      fields: [treatmentPlan.submissionId],
      references: [formSubmission.id],
    }),
    lead: one(lead, {
      fields: [treatmentPlan.leadId],
      references: [lead.id],
    }),
    deliveries: many(treatmentPlanDelivery),
  })
);

export const treatmentPlanDeliveryRelations = relations(
  treatmentPlanDelivery,
  ({ one }) => ({
    plan: one(treatmentPlan, {
      fields: [treatmentPlanDelivery.treatmentPlanId],
      references: [treatmentPlan.id],
    }),
  })
);

export type TreatmentPlan = typeof treatmentPlan.$inferSelect;
export type TreatmentPlanTemplate = typeof treatmentPlanTemplate.$inferSelect;
