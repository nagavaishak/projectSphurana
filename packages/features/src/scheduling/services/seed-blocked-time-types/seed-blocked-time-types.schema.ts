import { z } from 'zod';

export const seedBlockedTimeTypesSchema = z.object({
  organizationId: z.string().min(1),
});

export type SeedBlockedTimeTypesInput = z.infer<
  typeof seedBlockedTimeTypesSchema
>;

/**
 * Preset blocked-time types seeded for every org (contract §1.1.1).
 */
export const BLOCKED_TIME_TYPE_PRESETS = [
  { name: 'Lunch', durationMinutes: 30, paid: false },
  { name: 'Training', durationMinutes: 60, paid: true },
  { name: 'Meeting', durationMinutes: 60, paid: true },
] as const;
