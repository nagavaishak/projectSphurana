import {
  wageCompensationTypeValues,
  wageOvertimeTypeValues,
  wageRegularHoursPerValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Wage-config slice per contract §1.1.8 (practitioner_wage_config).
 * Structurally assignable from the real row. Enums are the `...Values` arrays
 * from `@borradh-workspace/labels` (the single source of truth).
 */
export const overtimeWageConfigSchema = z.object({
  compensationType: z.enum(wageCompensationTypeValues),
  hourlyRateCents: z.number().int().nonnegative().nullable(),
  overtimeEnabled: z.boolean(),
  regularWorkHours: z.number().positive().nullable(),
  regularWorkHoursPer: z.enum(wageRegularHoursPerValues),
  overtimeType: z.enum(wageOvertimeTypeValues).nullable(),
  overtimeMultiplier: z.number().positive().nullable(),
  overtimeHourlyRateCents: z.number().int().nonnegative().nullable(),
});

export const calculateOvertimePaySchema = z.object({
  wageConfig: overtimeWageConfigSchema,
  entries: z.array(
    z.object({
      clockIn: z.coerce.date(),
      // Open entries (null clockOut) are skipped — nothing settled to pay yet
      clockOut: z.coerce.date().nullable(),
      breaks: z
        .array(
          z.object({
            breakStart: z.coerce.date(),
            // Open breaks are clamped to the entry's clockOut
            breakEnd: z.coerce.date().nullable(),
          })
        )
        .default([]),
    })
  ),
  /**
   * IANA timezone used to bucket entries into days/weeks (weeks start
   * Monday). Defaults to UTC.
   */
  timezone: z.string().default('UTC'),
});

export type CalculateOvertimePayInput = z.input<
  typeof calculateOvertimePaySchema
>;
export type OvertimeWageConfigInput = z.input<typeof overtimeWageConfigSchema>;
