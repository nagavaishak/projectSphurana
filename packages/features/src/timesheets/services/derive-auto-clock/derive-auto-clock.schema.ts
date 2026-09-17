import { z } from 'zod';

const automationSettingSchema = z.enum([
  'workspace_default',
  'enabled',
  'disabled',
]);

/**
 * Input for the pure auto-clock derivation (contract §1.5).
 *
 * `shiftWindows` are the practitioner's RESOLVED shift windows for the
 * evaluation day (weekly rows with overrides applied per contract §1.1.6),
 * already converted to absolute instants by the caller.
 */
export const deriveAutoClockSchema = z.object({
  now: z.coerce.date(),
  flags: z.object({
    autoClockIn: z.boolean(),
    autoClockOut: z.boolean(),
  }),
  shiftWindows: z.array(
    z
      .object({
        start: z.coerce.date(),
        end: z.coerce.date(),
      })
      .refine((w) => w.end.getTime() > w.start.getTime(), {
        message: 'Shift window end must be after start',
      })
  ),
  openEntry: z
    .object({
      id: z.string().min(1),
      clockIn: z.coerce.date(),
    })
    .nullable(),
});

export type DeriveAutoClockInput = z.input<typeof deriveAutoClockSchema>;

/**
 * Input for resolving a wage-config automation flag against org defaults.
 */
export const resolveAutomationFlagsSchema = z.object({
  // null = no practitioner_wage_config row → all workspace_default
  wageConfig: z
    .object({
      autoClockIn: automationSettingSchema,
      autoClockOut: automationSettingSchema,
      automatedBreaks: automationSettingSchema,
    })
    .nullable(),
  // null = no org_defaults row / null columns → system default false
  orgDefaults: z
    .object({
      wageAutoClockIn: z.boolean().nullable(),
      wageAutoClockOut: z.boolean().nullable(),
      wageAutomatedBreaks: z.boolean().nullable(),
    })
    .nullable(),
});

export type ResolveAutomationFlagsInput = z.input<
  typeof resolveAutomationFlagsSchema
>;
