import type {
  ClinicAreaType,
  GiftCardExpiry,
  ResourceAssignmentMode,
} from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

/**
 * Per-organization defaults consumed by Claire skills (ads, videos, etc.).
 *
 * 1:1 with `organization` — the org id is the primary key. All value
 * columns are nullable so the resolver layer (`getOrgDefaults`) can fall
 * back to system-wide defaults when a column is unset.
 */
export const orgDefaults = pgTable('org_defaults', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),

  // Ad defaults
  adDailyBudgetCents: integer('ad_daily_budget_cents'),
  adObjective: text('ad_objective'),
  // Geographic catchment — drives the default ad-targeting radius. Plain text
  // (matching sibling ad-default columns); the resolver validates against
  // `clinicAreaTypeValues`. Claire sets this once during the first campaign.
  adAreaType: text('ad_area_type').$type<ClinicAreaType>(),

  // Video defaults
  videoOrientation: text('video_orientation'),
  videoLengthSecs: integer('video_length_secs'),
  videoTemplateEngineV2: boolean('video_template_engine_v2')
    .notNull()
    .default(false),

  // Brand
  brandVoice: text('brand_voice'),

  // Wage / auto-clock workspace defaults (resolver falls back to `false`).
  // Practitioner-level `workspace_default` settings resolve through these.
  wageAutoClockIn: boolean('wage_auto_clock_in'),
  wageAutoClockOut: boolean('wage_auto_clock_out'),
  wageAutomatedBreaks: boolean('wage_automated_breaks'),
  // Workspace default for proximity/location restriction (resolver falls back
  // to `false`). Practitioner-level `workspace_default` resolves through this.
  wageLocationRestriction: boolean('wage_location_restriction'),

  // Gift card org settings (resolver defaults: preset amounts
  // [2500, 5000, 7500, 10000, 15000] cents; expiry 'never'). Plain text +
  // $type matches the `adAreaType` precedent — no pgEnum on this table; the
  // resolver validates against `giftCardExpiryValues`.
  giftCardPresetAmounts: jsonb('gift_card_preset_amounts').$type<number[]>(),
  giftCardExpiry: text('gift_card_expiry').$type<GiftCardExpiry>(),

  // How appointments get their rooms/equipment. Plain text + $type matches the
  // `adAreaType` / `giftCardExpiry` precedent on this table; the resolver
  // validates against `resourceAssignmentModeValues` and defaults to 'auto'.
  // NOTE: online bookings are ALWAYS auto-assigned regardless — a client can't
  // pick a room, and manual mode there would leave online slots ungated.
  resourceAssignmentMode: text(
    'resource_assignment_mode'
  ).$type<ResourceAssignmentMode>(),

  // Pointer to the org's preferred service for ads (optional)
  defaultServiceIdForAds: text('default_service_id_for_ads').references(
    () => organizationService.id,
    { onDelete: 'set null' }
  ),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const orgDefaultsRelations = relations(orgDefaults, ({ one }) => ({
  organization: one(organization, {
    fields: [orgDefaults.organizationId],
    references: [organization.id],
  }),
  defaultServiceForAds: one(organizationService, {
    fields: [orgDefaults.defaultServiceIdForAds],
    references: [organizationService.id],
  }),
}));

export const orgDefaultsRlsPolicy = orgRlsPolicy(orgDefaults);

export type OrgDefaultsRow = typeof orgDefaults.$inferSelect;
export type NewOrgDefaultsRow = typeof orgDefaults.$inferInsert;
