import { z } from 'zod';

export const runHealthAlertsSchema = z.object({
  /** Scope to a single organization (runs all if omitted) */
  organizationId: z.string().min(1).optional(),
  /** Override the default 2-hour dedup window (in seconds) */
  dedupTtlSeconds: z.number().int().positive().optional().default(86400),
});

/** Input type (before Zod defaults are applied) */
export type RunHealthAlertsInput = z.input<typeof runHealthAlertsSchema>;

/** Parsed type (after Zod defaults are applied) */
export type RunHealthAlertsParsed = z.infer<typeof runHealthAlertsSchema>;
