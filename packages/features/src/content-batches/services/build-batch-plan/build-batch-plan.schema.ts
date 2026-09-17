import { z } from 'zod';

/**
 * Input for buildBatchPlan.
 *
 * The planner is pure / deterministic — given the same input it must produce
 * the same slot layout. Defaults match the v1 spec:
 *   - cadence: 6 posts
 *   - periodDays: 14
 *   - timeOfDayMinutes: 600 (= 10:00 UTC)
 */
export const buildBatchPlanSchema = z.object({
  cadence: z.number().int().min(1, 'Cadence must be >= 1').default(6),
  periodDays: z.number().int().min(1, 'periodDays must be >= 1').default(14),
  startFromDate: z.date(),
  timeOfDayMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 - 1)
    .default(10 * 60),
  templateIds: z
    .array(z.string().min(1, 'Template ID must not be empty'))
    .min(1, 'At least one template ID required'),
  serviceIds: z
    .array(z.string().min(1, 'Service ID must not be empty'))
    .min(1, 'At least one service ID required'),
});

export type BuildBatchPlanInput = z.input<typeof buildBatchPlanSchema>;
export type ResolvedBuildBatchPlanInput = z.output<typeof buildBatchPlanSchema>;

/**
 * A planned post slot. Pure data — no DB references, no LLM output yet.
 * The filler (Phase P4) hydrates each slot with a VideoIdea + caption + render.
 */
export interface Slot {
  scheduledAt: Date;
  templateId: string;
  variationId: string;
  serviceId: string;
}
