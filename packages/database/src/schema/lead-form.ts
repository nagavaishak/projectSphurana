import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelLabels,
  leadFormFollowUpChannelValues,
  leadFormStatusLabels,
  leadFormStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  leadFormStatusLabels,
  leadFormStatusValues,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelLabels,
  leadFormFollowUpChannelValues,
};
export type {
  LeadFormStatus,
  LeadFormFieldType,
  LeadFormFollowUpChannel,
} from '@borradh-workspace/labels';

// Import type for local use in interfaces
import type {
  LeadFormFieldType,
  LeadFormFollowUpChannel,
} from '@borradh-workspace/labels';

// Database enums
export const leadFormStatusEnum = pgEnum(
  'lead_form_status',
  leadFormStatusValues
);

// ==================== TYPE INTERFACES ====================

/**
 * Single question in a lead form
 */
export interface LeadFormQuestion {
  /** Field type from Meta API */
  type: LeadFormFieldType;
  /** Custom label (optional, uses type label if not provided) */
  label?: string;
  /** For CUSTOM type only - unique key for the field */
  key?: string;
  /** Options for select/dropdown fields */
  options?: Array<{ value: string; key?: string }>;
  /** Whether the field is required */
  required?: boolean;
}

// ==================== LEAD FORM TABLE ====================

/**
 * Lead Form - stores lead generation forms that sync to Meta
 * Each form belongs to an organization and can be linked to ads
 */
export const leadForm = pgTable(
  'lead_form',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Form details
    name: text('name').notNull(),
    status: leadFormStatusEnum('status').notNull().default('draft'),
    questions: jsonb('questions').$type<LeadFormQuestion[]>().notNull(),

    // Privacy policy (required by Meta)
    privacyPolicyUrl: text('privacy_policy_url').notNull(),
    privacyPolicyLinkText: text('privacy_policy_link_text'),

    // Thank you page (optional)
    thankYouTitle: text('thank_you_title'),
    thankYouBody: text('thank_you_body'),
    thankYouButtonText: text('thank_you_button_text'),
    thankYouButtonUrl: text('thank_you_button_url'),

    // Instant-form lead nurturing: chat CTA on the post-submission screen.
    // Maps to Meta's thank_you_page button_type when synced.
    followUpChannel: text('follow_up_channel')
      .$type<LeadFormFollowUpChannel>()
      .notNull()
      .default('none'),
    // Business WhatsApp number (E.164) used when followUpChannel is 'whatsapp'
    whatsappNumber: text('whatsapp_number'),

    // Meta sync fields
    metaFormId: text('meta_form_id'),
    metaPageId: text('meta_page_id').references(() => metaAdsPage.id, {
      onDelete: 'set null',
    }),
    lastSyncAt: timestamp('last_sync_at'),
    syncError: text('sync_error'),

    // Service this form is about. Lets the chatbot tell which service a
    // lead-form lead enquired about (Meta-native forms carry no service link
    // and their ads aren't service-tagged). Auto-suggested at sync time by
    // matching form name/questions to org services; a future UI can confirm.
    organizationServiceId: text('organization_service_id').references(
      () => organizationService.id,
      { onDelete: 'set null' }
    ),
    // 'suggested' (auto-matched) or 'confirmed' (set by a human). Null when no
    // service is linked.
    serviceLinkSource: text('service_link_source').$type<
      'suggested' | 'confirmed'
    >(),

    // Ownership
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_lead_form_org_id').on(table.organizationId),
    index('idx_lead_form_meta_page_id').on(table.metaPageId),
    index('idx_lead_form_created_by_id').on(table.createdById),
    index('idx_lead_form_meta_form_id').on(table.metaFormId),
    index('idx_lead_form_org_service_id').on(table.organizationServiceId),
  ]
);

export const leadFormRlsPolicy = orgRlsPolicy(leadForm);

// ==================== RELATIONS ====================

export const leadFormRelations = relations(leadForm, ({ one }) => ({
  organization: one(organization, {
    fields: [leadForm.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [leadForm.createdById],
    references: [user.id],
  }),
  metaPage: one(metaAdsPage, {
    fields: [leadForm.metaPageId],
    references: [metaAdsPage.id],
  }),
  service: one(organizationService, {
    fields: [leadForm.organizationServiceId],
    references: [organizationService.id],
  }),
}));

// ==================== TYPE EXPORTS ====================

export type LeadForm = typeof leadForm.$inferSelect;
export type NewLeadForm = typeof leadForm.$inferInsert;
