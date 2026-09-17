import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  leadMembershipStatusLabels,
  leadMembershipStatusValues,
  membershipPricingTypeLabels,
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  membershipPricingTypeLabels,
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
  leadMembershipStatusLabels,
  leadMembershipStatusValues,
};
export type {
  MembershipPricingType,
  MembershipValidFor,
  LeadMembershipStatus,
} from '@borradh-workspace/labels';

// Database enums
export const membershipPricingTypeEnum = pgEnum(
  'membership_pricing_type',
  membershipPricingTypeValues
);
export const membershipValidForEnum = pgEnum(
  'membership_valid_for',
  membershipValidForValues
);
export const leadMembershipStatusEnum = pgEnum(
  'lead_membership_status',
  leadMembershipStatusValues
);

/**
 * Membership plan — a sellable membership product (catalog entry).
 *
 * `sessionCount` NULL = unlimited sessions. `pricingType='recurring'` plans
 * are backed by a Stripe Product/Price on the org's connected account
 * (`stripeProductId` / `stripePriceId`, created lazily on first sale).
 */
export const membershipPlan = pgTable(
  'membership_plan',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    // NULL = unlimited (no separate limited/unlimited enum)
    sessionCount: integer('session_count'),

    pricingType: membershipPricingTypeEnum('pricing_type')
      .notNull()
      .default('one_time'),
    validFor: membershipValidForEnum('valid_for').notNull().default('1m'),

    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('eur'),

    // Stripe (recurring plans only, created lazily on the connected account)
    stripeProductId: text('stripe_product_id'),
    stripePriceId: text('stripe_price_id'),

    isActive: boolean('is_active').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('membership_plan_org_name_unique').on(
      table.organizationId,
      table.name
    ),
  ]
);

export const membershipPlanRlsPolicy = orgRlsPolicy(membershipPlan);

/**
 * membership_plan_location — which branches sell a plan.
 *
 * Join table (a plan is sold at N branches from one catalogue entry), mirroring
 * `offer_location`. ZERO rows = sold everywhere, so this lands without a
 * backfill.
 */
export const membershipPlanLocation = pgTable(
  'membership_plan_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlan.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('membership_plan_location_unique').on(
      table.planId,
      table.locationId
    ),
    index('idx_membership_plan_location_location_id').on(table.locationId),
  ]
);

// Join table: route org isolation via membership_plan (has organization_id).
export const membershipPlanLocationRlsPolicy = joinRlsPolicy(
  membershipPlanLocation,
  {
    parent: 'membership_plan',
    fk: 'plan_id',
  }
);

export const membershipPlanLocationRelations = relations(
  membershipPlanLocation,
  ({ one }) => ({
    plan: one(membershipPlan, {
      fields: [membershipPlanLocation.planId],
      references: [membershipPlan.id],
    }),
    location: one(organizationLocation, {
      fields: [membershipPlanLocation.locationId],
      references: [organizationLocation.id],
    }),
  })
);

export type MembershipPlanLocation = typeof membershipPlanLocation.$inferSelect;
export type NewMembershipPlanLocation =
  typeof membershipPlanLocation.$inferInsert;

// Membership plan ↔ service junction table
export const membershipPlanService = pgTable(
  'membership_plan_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlan.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('membership_plan_service_unique').on(table.planId, table.serviceId),
    index('idx_membership_plan_service_service_id').on(table.serviceId),
  ]
);

// Join table: route org isolation via membership_plan (has organization_id).
export const membershipPlanServiceRlsPolicy = joinRlsPolicy(
  membershipPlanService,
  {
    parent: 'membership_plan',
    fk: 'plan_id',
  }
);

/**
 * Lead membership — a membership sold/assigned to a client (lead).
 *
 * `sessionsRemaining` NULL = unlimited. `validUntil` is computed from the
 * plan's `validFor` at sale time for one_time plans; for recurring plans it
 * mirrors the Stripe subscription's `current_period_end` (updated by
 * subscription lifecycle webhooks).
 */
export const leadMembership = pgTable(
  'lead_membership',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    // restrict: deleting a plan with live memberships must fail — deactivate instead
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlan.id, { onDelete: 'restrict' }),

    sessionsRemaining: integer('sessions_remaining'),
    validUntil: timestamp('valid_until'),

    // Recurring only
    stripeSubscriptionId: text('stripe_subscription_id'),

    status: leadMembershipStatusEnum('status').notNull().default('active'),

    // Provenance: the sale line that sold this membership.
    // NOTE: FK → sale_item.id (onDelete: set null) is added at integration —
    // the `sale_item` table is owned by the sales agent (contract §1.2.2) and
    // does not exist in this workstream's tree yet.
    saleItemId: text('sale_item_id'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_lead_membership_org_id').on(table.organizationId),
    index('idx_lead_membership_lead_id').on(table.leadId),
  ]
);

export const leadMembershipRlsPolicy = orgRlsPolicy(leadMembership);

// Relations
export const membershipPlanRelations = relations(
  membershipPlan,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [membershipPlan.organizationId],
      references: [organization.id],
    }),
    services: many(membershipPlanService),
    planLocations: many(membershipPlanLocation),
    leadMemberships: many(leadMembership),
  })
);

export const membershipPlanServiceRelations = relations(
  membershipPlanService,
  ({ one }) => ({
    plan: one(membershipPlan, {
      fields: [membershipPlanService.planId],
      references: [membershipPlan.id],
    }),
    service: one(organizationService, {
      fields: [membershipPlanService.serviceId],
      references: [organizationService.id],
    }),
  })
);

export const leadMembershipRelations = relations(leadMembership, ({ one }) => ({
  organization: one(organization, {
    fields: [leadMembership.organizationId],
    references: [organization.id],
  }),
  lead: one(lead, {
    fields: [leadMembership.leadId],
    references: [lead.id],
  }),
  plan: one(membershipPlan, {
    fields: [leadMembership.planId],
    references: [membershipPlan.id],
  }),
}));

// Types
export type MembershipPlan = typeof membershipPlan.$inferSelect;
export type NewMembershipPlan = typeof membershipPlan.$inferInsert;
export type MembershipPlanService = typeof membershipPlanService.$inferSelect;
export type NewMembershipPlanService =
  typeof membershipPlanService.$inferInsert;
export type LeadMembership = typeof leadMembership.$inferSelect;
export type NewLeadMembership = typeof leadMembership.$inferInsert;
