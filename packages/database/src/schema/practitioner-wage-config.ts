import {
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
  wageOvertimeTypeLabels,
  wageOvertimeTypeValues,
  wageRegularHoursPerLabels,
  wageRegularHoursPerValues,
} from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';

// Re-export labels and types for consumers
export {
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
  wageRegularHoursPerLabels,
  wageRegularHoursPerValues,
  wageOvertimeTypeLabels,
  wageOvertimeTypeValues,
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
};
export type {
  WageCompensationType,
  WageRegularHoursPer,
  WageOvertimeType,
  WageAutomationSetting,
} from '@borradh-workspace/labels';

// Database enums
export const wageCompensationTypeEnum = pgEnum(
  'wage_compensation_type',
  wageCompensationTypeValues
);
export const wageRegularHoursPerEnum = pgEnum(
  'wage_regular_hours_per',
  wageRegularHoursPerValues
);
export const wageOvertimeTypeEnum = pgEnum(
  'wage_overtime_type',
  wageOvertimeTypeValues
);
export const wageAutomationSettingEnum = pgEnum(
  'wage_automation_setting',
  wageAutomationSettingValues
);

/**
 * Per-practitioner wage & auto-clock configuration.
 * 1:1 with practitioner — `practitioner_id` is the primary key (mirrors
 * `org_defaults` where `organization_id` is the PK); the table still carries
 * `organization_id` so `orgRlsPolicy` applies.
 */
export const practitionerWageConfig = pgTable(
  'practitioner_wage_config',
  {
    practitionerId: text('practitioner_id')
      .primaryKey()
      .references(() => practitioner.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    compensationType: wageCompensationTypeEnum('compensation_type')
      .notNull()
      .default('none'),
    hourlyRateCents: integer('hourly_rate_cents'),
    overtimeEnabled: boolean('overtime_enabled').notNull().default(false),
    // e.g. 37.5
    regularWorkHours: real('regular_work_hours'),
    regularWorkHoursPer: wageRegularHoursPerEnum('regular_work_hours_per')
      .notNull()
      .default('week'),
    overtimeType: wageOvertimeTypeEnum('overtime_type'),
    // e.g. 1.5
    overtimeMultiplier: real('overtime_multiplier'),
    overtimeHourlyRateCents: integer('overtime_hourly_rate_cents'),
    autoClockIn: wageAutomationSettingEnum('auto_clock_in')
      .notNull()
      .default('workspace_default'),
    autoClockOut: wageAutomationSettingEnum('auto_clock_out')
      .notNull()
      .default('workspace_default'),
    automatedBreaks: wageAutomationSettingEnum('automated_breaks')
      .notNull()
      .default('workspace_default'),
    // Proximity/location restriction (50m) — stored now, enforced later (P3).
    locationRestriction: wageAutomationSettingEnum('location_restriction')
      .notNull()
      .default('workspace_default'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_practitioner_wage_config_org_id').on(table.organizationId),
  ]
);

export const practitionerWageConfigRlsPolicy = orgRlsPolicy(
  practitionerWageConfig
);

export const practitionerWageConfigRelations = relations(
  practitionerWageConfig,
  ({ one }) => ({
    practitioner: one(practitioner, {
      fields: [practitionerWageConfig.practitionerId],
      references: [practitioner.id],
    }),
    organization: one(organization, {
      fields: [practitionerWageConfig.organizationId],
      references: [organization.id],
    }),
  })
);

export type PractitionerWageConfig = typeof practitionerWageConfig.$inferSelect;
export type NewPractitionerWageConfig =
  typeof practitionerWageConfig.$inferInsert;
