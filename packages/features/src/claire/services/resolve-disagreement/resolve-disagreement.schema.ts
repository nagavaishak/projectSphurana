import { z } from 'zod';

// Owner picks one of two outcomes when the classifier disagrees with their
// override (Decision #4 + #5 in the master plan).
//
//   owner_held    — owner is right, keep overrides as-is
//   owner_changed — owner concedes, clear overrides and reclassify
//
// 'ignored' is set automatically by a sweep job after 30 days (not from this
// endpoint), so we don't accept it here.
export const resolveDisagreementSchema = z.object({
  organizationId: z.string().min(1),
  resolution: z.enum(['owner_held', 'owner_changed']),
  // Optional source attribution for telemetry. Defaults to 'ads_new' (the
  // widget POST endpoint); chat tools pass 'chat'. Not persisted.
  surface: z.enum(['ads_new', 'chat']).optional(),
});

export type ResolveDisagreementInput = z.infer<
  typeof resolveDisagreementSchema
>;
