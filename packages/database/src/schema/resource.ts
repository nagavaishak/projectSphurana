import {
  appointmentResourceSourceValues,
  resourceCategoryKindValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { appointment } from './appointments.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import type { WorkingHours } from './practitioners.js';
import { userColorEnum } from './user.js';

// Re-export labels/types for consumers (api-client derives from these).
export {
  appointmentResourceSourceLabels,
  appointmentResourceSourceValues,
  resourceAssignmentModeLabels,
  resourceAssignmentModeValues,
  resourceCategoryKindLabels,
  resourceCategoryKindSingularLabels,
  resourceCategoryKindValues,
} from '@borradh-workspace/labels';
export type {
  AppointmentResourceSource,
  ResourceAssignmentMode,
  ResourceCategoryKind,
} from '@borradh-workspace/labels';

export const resourceCategoryKindEnum = pgEnum(
  'resource_category_kind',
  resourceCategoryKindValues
);

export const appointmentResourceSourceEnum = pgEnum(
  'appointment_resource_source',
  appointmentResourceSourceValues
);

/**
 * A clinic-defined grouping of bookable non-human things: "Rooms", "Lasers",
 * "Hydrafacial machines". Requirements bind at the CATEGORY level — a service
 * says "I need one resource from Rooms", never "I need Room 2" (that's
 * eligibility, below).
 *
 * `kind` only drives UI copy/defaults. Keeping rooms and each device type in
 * separate categories is the documented best practice across Boulevard/Zenoti:
 * a service that needs a room AND a laser needs one from each.
 */
export const resourceCategory = pgTable(
  'resource_category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: resourceCategoryKindEnum('kind').notNull().default('room'),
    description: text('description'),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    // Partial unique: a soft-deleted category frees its name for reuse.
    uniqueIndex('resource_category_org_name_unique')
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_resource_category_org').on(table.organizationId),
  ]
);

export const resourceCategoryRlsPolicy = orgRlsPolicy(resourceCategory);

/**
 * The physical thing itself: "Room 2", "Laser A".
 *
 * - `capacity` > 1 models Zenoti-style parallel services in one space (a
 *   double treatment room, a nail bar with 4 stations). Capacity-1 resources
 *   (the overwhelming majority) additionally get the `resource_no_overlap`
 *   exclusion constraint as a DB backstop; capacity > 1 is enforced in the
 *   service layer by counting concurrent allocations.
 * - `workingHours` is OPTIONAL and null means "always available" — deliberately
 *   unlike Boulevard, where forgetting to give a resource a schedule silently
 *   makes every slot unbookable. Most clinics want the room open whenever the
 *   clinic is; only rented/shared rooms need their own hours.
 * - `specs` is a clinic-defined free-form record ("Size": "3.5 x 4m",
 *   "Device": "Lumenis M22"). Display-only; never affects scheduling.
 */
export const resource = pgTable(
  'resource',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => resourceCategory.id, { onDelete: 'cascade' }),
    // Null = available at every location (e.g. a trolley-mounted device).
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),

    name: text('name').notNull(),
    description: text('description'),
    // Same palette as practitioners so the rooms calendar reads consistently.
    color: userColorEnum('color'),
    photo: text('photo'),

    /** How many appointments can occupy this resource at once. */
    capacity: integer('capacity').notNull().default(1),

    /** Clinic-defined display-only key/values. */
    specs: jsonb('specs').$type<Record<string, string>>(),

    /** Null = always available (inherits the clinic's own opening hours). */
    workingHours: jsonb('working_hours').$type<WorkingHours>(),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_resource_org_category').on(
      table.organizationId,
      table.categoryId
    ),
    index('idx_resource_location').on(table.locationId),
  ]
);

export const resourceRlsPolicy = orgRlsPolicy(resource);

/**
 * "Service X requires one resource from category Y."
 *
 * Absence of a row is the zero-cost path: a service with no requirements
 * behaves exactly as it did before this feature existed. That is what makes
 * rollout safe for every org that never sets a room up.
 */
export const serviceResourceRequirement = pgTable(
  'service_resource_requirement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => resourceCategory.id, { onDelete: 'cascade' }),

    /** Reserved for "needs 2 chairs"; v1 always writes 1. */
    quantity: integer('quantity').notNull().default(1),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('service_resource_requirement_unique').on(
      table.serviceId,
      table.categoryId
    ),
    index('idx_service_resource_requirement_service').on(table.serviceId),
  ]
);

export const serviceResourceRequirementRlsPolicy = orgRlsPolicy(
  serviceResourceRequirement
);

/**
 * Narrows a requirement to specific resources: "IPL Facial can only run on
 * Laser A". ZERO rows for a (service, category) pair means EVERY active
 * resource in that category qualifies — the same org-wide-by-default
 * convention `blocked_time` uses for its practitioner joins.
 */
export const serviceResourceEligibility = pgTable(
  'service_resource_eligibility',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('service_resource_eligibility_unique').on(
      table.serviceId,
      table.resourceId
    ),
    index('idx_service_resource_eligibility_service').on(table.serviceId),
    index('idx_service_resource_eligibility_resource').on(table.resourceId),
  ]
);

export const serviceResourceEligibilityRlsPolicy = orgRlsPolicy(
  serviceResourceEligibility
);

/**
 * A resource held for an appointment.
 *
 * Carries its OWN [startDate, endDate) rather than reading the appointment's,
 * because the hold extends past the appointment by the service's turnaround
 * minutes (cleanup). That is the whole reason this is a table and not two
 * columns on `appointment`.
 *
 * Lifecycle: rows exist only while the appointment is active. Cancel / no-show /
 * delete / deposit-expiry release them (`releaseAppointmentResources`). That
 * invariant is what lets the availability query skip a join back to
 * `appointment.status`.
 *
 * `allowOverlap` mirrors `appointment.allow_double_booking`: it opts a row out
 * of the `resource_no_overlap` exclusion constraint. Set for (a) staff
 * force-overrides and (b) every allocation against a capacity > 1 resource,
 * where a plain exclusion constraint cannot count to N.
 */
export const appointmentResource = pgTable(
  'appointment_resource',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'cascade' }),
    // RESTRICT: a resource with live allocations must be deactivated, not
    // deleted. The service layer turns this into a helpful 409 before it ever
    // reaches the DB.
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'restrict' }),

    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    /** Appointment end + the service's turnaround minutes. */
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    /** Minutes of the range that are turnaround, for calendar rendering. */
    turnaroundMinutes: integer('turnaround_minutes').notNull().default(0),

    source: appointmentResourceSourceEnum('source').notNull().default('auto'),

    /** Opt out of the `resource_no_overlap` exclusion constraint. */
    allowOverlap: boolean('allow_overlap').notNull().default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('appointment_resource_unique').on(
      table.appointmentId,
      table.resourceId
    ),
    index('idx_appointment_resource_appointment').on(table.appointmentId),
    // The hot path: "what is busy for these resources in this window?"
    index('idx_appointment_resource_window').on(
      table.resourceId,
      table.startDate,
      table.endDate
    ),
  ]
);

export const appointmentResourceRlsPolicy = orgRlsPolicy(appointmentResource);

// ── Relations ───────────────────────────────────────────────────────────────

export const resourceCategoryRelations = relations(
  resourceCategory,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [resourceCategory.organizationId],
      references: [organization.id],
    }),
    resources: many(resource),
    requirements: many(serviceResourceRequirement),
  })
);

export const resourceRelations = relations(resource, ({ one, many }) => ({
  organization: one(organization, {
    fields: [resource.organizationId],
    references: [organization.id],
  }),
  category: one(resourceCategory, {
    fields: [resource.categoryId],
    references: [resourceCategory.id],
  }),
  location: one(organizationLocation, {
    fields: [resource.locationId],
    references: [organizationLocation.id],
  }),
  eligibility: many(serviceResourceEligibility),
  allocations: many(appointmentResource),
}));

export const serviceResourceRequirementRelations = relations(
  serviceResourceRequirement,
  ({ one }) => ({
    service: one(organizationService, {
      fields: [serviceResourceRequirement.serviceId],
      references: [organizationService.id],
    }),
    category: one(resourceCategory, {
      fields: [serviceResourceRequirement.categoryId],
      references: [resourceCategory.id],
    }),
  })
);

export const serviceResourceEligibilityRelations = relations(
  serviceResourceEligibility,
  ({ one }) => ({
    service: one(organizationService, {
      fields: [serviceResourceEligibility.serviceId],
      references: [organizationService.id],
    }),
    resource: one(resource, {
      fields: [serviceResourceEligibility.resourceId],
      references: [resource.id],
    }),
  })
);

export const appointmentResourceRelations = relations(
  appointmentResource,
  ({ one }) => ({
    appointment: one(appointment, {
      fields: [appointmentResource.appointmentId],
      references: [appointment.id],
    }),
    resource: one(resource, {
      fields: [appointmentResource.resourceId],
      references: [resource.id],
    }),
  })
);

// ── Types ───────────────────────────────────────────────────────────────────

export type ResourceCategory = typeof resourceCategory.$inferSelect;
export type NewResourceCategory = typeof resourceCategory.$inferInsert;
export type Resource = typeof resource.$inferSelect;
export type NewResource = typeof resource.$inferInsert;
export type ServiceResourceRequirement =
  typeof serviceResourceRequirement.$inferSelect;
export type ServiceResourceEligibility =
  typeof serviceResourceEligibility.$inferSelect;
export type AppointmentResource = typeof appointmentResource.$inferSelect;
export type NewAppointmentResource = typeof appointmentResource.$inferInsert;
